# nbodysim architecture

> The product is **nbodysim** ([nbodysim.com](https://nbodysim.com)); the codebase and repository are named `spacesim`. Same project.

A solar-system n-body simulator with a Java/Spring Boot backend (Orekit, JPL ephemerides, Zstd compression) and a Next.js + React Three Fiber frontend, communicating over HTTP/2. This document covers what the system is, how it's shaped, the decisions behind that shape, and what's planned.

## Vision

End-to-end hosted simulation. A user picks bodies, frame, integrator, and time scale; the backend computes trajectories using real astrodynamics (JPL ephemerides via Orekit); the browser plays them back smoothly with trails, scaled views, and per-body inspection. Compute is server-side and streamed; the frontend is a thin, performant viewport.

## System overview

```
┌──────────────────┐                                  ┌─────────────────────┐
│  Next.js + R3F   │  ◄── zstd-compressed binary ─────┤  Spring Boot + Orekit│
│  Redux + thunk   │  ──► POST /chunk {sessionID} ───►│  REST controller     │
│  React Three     │                                  │  Sim session store   │
│  Fiber scene     │                                  │  Pluggable integrator│
└──────────────────┘                                  └─────────────────────┘
        │                                                       │
   Cloudflare Pages                                      Railway
```

**Backend.** Spring Boot 3 + Orekit 12. `POST /api/simulation/initialize` builds a session with bodies, frame, integrator, and start date; subsequent `POST /api/simulation/chunk` calls return zstd-compressed binary trajectories. After each chunk is served, the next 10k-step block is speculatively pre-computed on a daemon executor so subsequent requests hit cache. Sessions are tracked by sessionID and evicted by a periodic idle-timeout sweeper.

**Frontend.** Next.js + React Three Fiber. Redux Toolkit holds a typed-array-backed chunk buffer (`Float64Array` positions + `BigInt64Array` timestamps) laid out in the same row-major shape as the wire format, giving O(1) lookup by timestep index and a zero-copy hand-off from the decode worker. An async thunk fetches the next chunk when the buffer dips below a speed-aware threshold (`max(1000, speedMultiplier × FPS × rolling-fetch-latency × 1.5)`), and `copyWithin`-shifts the oldest entries left when capacity is reached. Capacity is byte-budget-derived at session start (12 MB mobile / 48 MB desktop) so it scales inversely with body count. The render loop tape-plays the buffer at a target frame rate via R3F's `useFrame`; the scene supports two scale presets (semi-realistic, realistic) and per-body exception scaling for tightly-coupled pairs (e.g., Earth–Moon).

**Wire format (v3).** Custom little-endian binary layout. A one-time header carries body names + µ, DP853 telemetry, and the timestep count. Timestamps are uniform-cadence: a single `(startMillis, gapMillis)` pair, not a per-timestep value, since the emission schedule is equally spaced by construction. Positions ride as a per-body `float64` reference (timestep 0) plus per-step `float32` deltas; the client reconstructs absolute positions by prefix sum, and accumulated drift stays sub-kilometre over a chunk. Velocities are `float32` temporal-deltas (row 0 absolute, the rest per-step deltas), reconstructed the same way with ~0.02 m/s error, invisible to their downstream uses. Both `float32` planes (position deltas and velocities) are laid out structure-of-arrays *and* byte-plane shuffled: each value's 4 bytes are split into 4 contiguous runs, so zstd sees long stretches of stable high-order bytes and compresses them hard. The whole body is zstd-compressed (level 3) with a 4-byte little-endian uncompressed-size prefix. The Web Worker un-shuffles and decodes directly into the typed-array buffer shape the main thread expects (positions/velocities into a `Float64Array`, timestamps reconstructed into a `BigInt64Array` from the `(start, gap)` pair) and transfers the underlying buffers back, with no intermediate JS-object hops and no copy at the worker boundary.

## Architecture decisions

The shape of the system reflects a handful of pivotal calls. Listed roughly in the order they were made.

### N-body integration via a global state vector

Trajectories are computed by an in-house pluggable integrator (Euler / RK4 / Dormand–Prince 853) operating on a flat 6N-dimensional state vector (`[r₀, v₀, r₁, v₁, …]`) with mutual gravitational accelerations summed across all body pairs each step. Earlier the codebase propagated each body independently using Orekit's per-body APIs; the rewrite introduced `GlobalState`, `NBodyDerivatives`, and a sealed `Integrator` interface. **Trade-off:** trajectories now come from our integrator's accuracy budget rather than JPL's; JPL ephemerides only seed t=0. This is intentional: the project's portfolio angle is "I built the integrator," not "I read JPL's tables." The reality-drift overlay makes this trade-off visible by showing live divergence vs. the JPL ground truth.

### Chunk delivery over HTTP/2, not WebSocket

Simulation results stream as zstd-compressed binary chunks via `POST /api/simulation/chunk`. The original implementation used WebSocket; this was migrated out (~390 lines deleted, including WebSocketHandler, WS serializers, grace-period machinery, reconnect/replay middleware). HTTP/2 is the right tool here: chunks are independently retryable, per-session cacheable at the CDN edge, and the client doesn't need a persistent connection or reconnect logic. Session lifecycle moved to a `@Scheduled` idle-timeout sweeper (15 min) instead of WS-disconnect cleanup. This call also unblocks the multi-viewer collaborative direction described below.

### Sun-relative emission at the snapshot boundary

Backend snapshots are always emitted Sun-relative: `Simulation.snapshotFromState` subtracts the Sun's position/velocity from every body before serializing. The Sun does move physically during integration (planets pull on it), but the wobble is sub-Sun-radius and visually meaningless; pinning the Sun at origin in the wire format simplifies every downstream consumer. As a side effect, this makes display-frame switching (helio ↔ geo) a pure render-time pivot subtraction on the client (see `framePivot.ts`) instead of a re-emission from the backend.

### Imperative scene graph, no per-tick React rerenders

The 3D scene's R3F components (`Sphere`, `Trail`, `Reticle`, `GhostLabel`, `Camera`) update positions imperatively inside `useFrame` by reading from the chunk buffer at the current timestep via `useStore.getState()`; they never subscribe to per-frame state. Per-frame Redux subscriptions would force React to reconcile the entire scene on every animation tick, which dominated the cost in earlier profiles. Pattern documented in the project's hot-path engineering notes. Active body identity carries as a string (`activeBodyName`), not a buffer reference, so identity changes don't cascade.

### Hot-path mutating-output pattern

Anything in the frontend render loop or backend integrator step uses pre-allocated buffers and mutating-output APIs (`scaleDistanceInto`, `subtractInto`, `derivativesInto`, `stepInto`, etc.) to avoid per-frame allocation. Documented in the project's hot-path engineering notes. The Trail.tsx perf bug (closures plus per-frame `Array.find()` summing to ~45 000 closure allocations per frame at trail length 5000) was the motivating incident.

### Typed-array buffer mirrors the wire format end-to-end

The chunk buffer is a flat `Float64Array` of position+velocity (`idx × bodyCount × 6` doubles per timestep, components `[px, py, pz, vx, vy, vz]`) paired with a `BigInt64Array` of millis-since-epoch timestamps. The wire encodes this compactly (delta-encoded, byte-shuffled, see "Wire format" above), but the decode worker un-shuffles and reconstructs straight into this exact layout, so the worker output and Redux state are byte-identical and the hand-off is zero-copy. Consumers (`Sphere`, `Trail`, `Reticle`, etc.) resolve `bodyName → index` once per session via a `Map` and read state at `(timestep, body)` via mutating accessors (`readBodyPositionInto`, `readBodyStateInto`) into pre-allocated scratch `THREE.Vector3` refs. The previous architecture was a date-keyed `Record<string, CelestialBody[]>`: every per-frame lookup paid `Object.keys()` (O(N) in buffer size) and every body access paid `.find()` (O(N) in body count), so buffer-size and consumer-count both fed the per-frame cost. The typed-array layout decouples them; per-frame cost is now O(1) regardless of buffer depth. **Trade-offs:** Immer doesn't draft typed arrays (so the slice keeps the same wrapper object reference across appends, and `appendChunk` mutates in place); selectors that need to fire on chunk-arrival depend on `totalTimesteps` rather than buffer-reference identity. Chunk transitions are silent: no auto-unpause on arrival, no "Fetching data" modal flash between chunks.

### Speculative precompute + speed-aware prefetch

Backend kicks off the next 10k-step compute the moment it ships a chunk, holding the result in a per-session `CompletableFuture<byte[]>` cache. Client-side, the prefetch trigger scales with `speedMultiplier × FPS × rolling-fetch-latency × safety_factor`, so at `speedMultiplier=128` the threshold becomes ~11 520 steps and a fetch is essentially always in flight. The two pieces work together: the server-side cache cuts perceived chunk-fetch latency to near-network-only, and the speed-aware threshold ensures the client requests early enough that the cache hit lands before the buffer empties. Buffer eviction is `Float64Array.copyWithin` (single memmove), one-shot on overflow.

### Buffer capacity is byte-budgeted, not step-counted

Two device-class tiers picked at session start: 12 MB (mobile / `deviceMemory ≤ 4` / viewport `< 768px`) and 48 MB (everything else). Capacity falls out as `floor(byteBudget / (bodyCount × 48))`, so a 3-body sim gets a much deeper buffer than a 12-body sim under the same budget. Decoupling the cap from a fixed timestep count means user-driven body-count changes don't accidentally exceed the memory budget; decoupling from device class means mobile won't try to allocate ~43 MB on a phone. Heuristic ceilings, not measured. The validation path, not yet run: profile baseline non-buffer heap on a mid-tier phone via Safari Web Inspector / Chrome remote devtools to learn the fixed footprint, raise the cap until iOS Safari reloads the tab to find the real ceiling, and add `performance.memory.usedJSHeapSize` telemetry (Chromium-only) to refine post-launch.

### Cubic Hermite interpolation + per-integrator emission

The user picks a "Playback quality" bucket in SimSetupDrawer (4 buckets, per-integrator landing default of Euler→High, RK4→Medium, DP853→Med-Low, auto-resets on integrator change). The defaults sit one bucket below the middle on purpose: client-side Hermite interpolation keeps positions sub-pixel even at coarse keyframe density, so the lower defaults cut chunk size ~34–47% with no visible difference, and users who want denser trails or finer residual resolution move the slider up. Wire format is a single `fidelityBucket` string on `/initialize`; backend resolves to per-integrator emission settings via the `FidelityBucket` enum (one source of truth, mirrored on both sides).

**Fixed-step integrators (Euler, RK4)** thin the external-step grid by K: the backend emits every Kth integration step, with cross-chunk continuity preserved by a monotonic `globalStepCount` cursor inside `Simulation` so chunk N+1's first kept frame lands exactly K steps after chunk N's last. Bucket→K table: Med-Low/20, Medium/10, Med-High/5, High/2.

**DP853 (adaptive)** runs Mode C time-gap thinning instead. Emissions land at exact schedule timestamps (`simStart + k × gap` for k = 0..N-1) via Hipparchus's per-substep interpolator: the substep handler computes interpolated state at the precise target time rather than emitting at whichever substep first crosses the target. Produces uniformly-time-spaced samples by construction, which is load-bearing for any consumer that iterates the chunk buffer by integer index (Trail.tsx, etc.): those treat adjacent buffer entries as equally spaced in time, so non-uniform timestamps would render visible wobble between vertices. Cross-chunk continuity via a per-session `adaptiveEmitCount` cursor; bucket→N table: Med-Low/3000, Medium/5000, Med-High/7500, High/10000. The DP853 tier is heavier on opt-in (up to ~4.5 MB compressed at the highest bucket vs the ~3 MB default-tier ceiling). Discoverable accuracy for users who opt in; default flows land on the fixed-step integrators.

**Frontend** uses cubic Hermite interpolation between samples: analytic-tangent form using the integrator's exact velocities (already on the wire), no estimation. Emission is uniform-cadence, so the wire ships a single `(startMillis, gapMillis)` pair and the read path reconstructs each keyframe timestamp as `start + i × gap`; the Hermite read path keys off that reconstructed spacing. Hermite at integer keyframe indices short-circuits to a direct typed-array read, so existing integer-index callers (Trail tail loop) keep the no-allocation fast path.

**Wire compactness.** The encoding history matters here. Absolute `float32` positions were the original Phase 1 lever but caused visible orbit-plane jitter on outer planets at high fidelity (float32's ~540 km quantization at Neptune's 4.5×10¹² m radius dominated per-sample Z motion), so positions reverted to `float64`. v2 then clawed the size back without the jitter by shipping `float32` per-step deltas off a `float64` reference (timestep 0) and prefix-summing on the client; absolute positions stay bit-identical to full float64. v3 added byte-plane shuffling to *both* `float32` planes (position deltas and velocities) so zstd compresses their stable high-order bytes, and moved velocities to temporal-deltas. The shuffle is 16–31% smaller losslessly at zstd-3, rising to ~48% once velocities are also temporal-delta encoded (which adds ~0.02 m/s of reconstruction error). Velocities stay quantization-safe regardless: their downstream uses (Hermite tangent over one gap-interval; Keplerian v² → semi-major axis) damp precision loss far below visible. Combined with Mode C, DP853 default chunks dropped from ~16 MB compressed (the old "emit every accepted substep + throw at MAX_SNAPSHOTS_PER_CHUNK" model) to the low-MB range.

### Minor-body initial state via JPL Horizons HTTP (cached, serialized)

Bodies outside Orekit's bundled DE-440 (dwarf planets like Ceres, named near-Earth asteroids like Eros / Apophis / Bennu / Ryugu) source their initial state vectors from JPL Horizons at sim-submit time, keyed by SPK ID and the user's chosen epoch. The factory wraps the HTTP call in a process-local `ConcurrentHashMap` cache keyed by `(SPK_ID, epochSecondsFromJ2000)`: state vectors at any (body, epoch) are deterministic from JPL's orbit fits, so once fetched they never need to re-query in the same process. All outbound HTTP serializes through a single global fair `Semaphore` to honor JPL's published "one API request at a time" rule, which the per-key cache locks don't enforce across distinct bodies. Horizons returns Sun-relative positions in ICRF orientation; the factory adds Orekit's Sun PV in the user's chosen frame so the resulting state is consistent with Orekit-sourced major-planet states whether the frame is Heliocentric, ICRF (SSB-centered), or GCRF. **Trade-offs:** adds a network dependency at sim-submit time (~500 ms per cold body, ≤9 minor bodies → ~4.5 s worst case for a fully-cold submission). Cache has an on-disk warm-load layer; on Railway it survives redeploys when mounted on a volume, otherwise the first sim after each deploy pays the full latency. JPL's query syntax has a quirk worth flagging: SPK IDs for IAU-numbered small bodies (range 2_000_001+) need the `COMMAND='DES=<spkId>;'` form because bare numeric values are interpreted as IAU asteroid numbers (max 887103); major-body codes 1..999 (future moons) use the bare form. Orekit doesn't natively read SPICE SPK kernels, so HTTP was the only path without reimplementing kernel readers.

### Massive / test-particle dispatch in NBodyDerivatives

The N-body force kernel partitions bodies into a `[massive | test]` prefix layout and bounds every body's force sum to the massive prefix. Massive bodies feel gravity from other massives; test particles feel gravity from the massive prefix but exert none. State buffer layout `[massive | test]` lets `NBodyDerivatives` take a single `massiveCount` and switch the inner-loop bound with one hoisted local read, with no per-pair branch in the hot path. Cost is `M·(M−1) + T·M` per integrator substep instead of `(M+T)·(M+T−1)` for a full N². At the current catalog scale this is modest, but the scaling matters once the catalog grows: a future asteroid-belt expansion at T=1000 test particles would cost ~9k ops/step instead of ~1.0M. Asteroid masses are 10⁻⁴ to 10⁻⁹ Earth, so their pull on planets is well below numerical noise, and the test-particle approximation is physically faithful at the current scale. **Trade-offs:** test particles exert no force on the system, so the `ΔE/E₀` energy readout has to be computed over the massive subsystem only; otherwise test-particle kinetic + potential terms would couple the integrator-quality metric to noise. Test particles also can't form bound pairs with each other (e.g. the Pluto-Charon barycenter dance needs both bodies massive). Newton's 3rd law is preserved on the massive subsystem; the asymmetric "massive feels test but test doesn't feel massive" variant would non-conserve momentum.

### Major moons: Horizons bare-NAIF routing, classification, per-parent scale

The catalog gained 21 named major moons (Mars: Phobos, Deimos; Jupiter's four Galileans; Saturn's seven biggest including Titan; all five Uranus majors; Triton + Nereid; Charon), taking it from 19 to 40 bodies. Three decisions shape how they work.

**Sourcing.** Moons live in a dedicated `MoonCatalog`, kept separate from the minor-body catalog because they query JPL Horizons differently: major-body NAIF codes in the 1..999 range (`501` Io, `606` Titan, `901` Charon) resolve with a bare `COMMAND='<id>'`, whereas IAU-numbered asteroids need the `COMMAND='DES=<id>;'` designation wrapper (a bare numeric there is read as an IAU asteroid number, max 887103, and fails out of range). `HorizonsClient` exposes two methods over a shared URL-build path (`fetchByMajorBodyId` for moons, `fetchByDesignation` for asteroids), and the body factory's dispatch order is MoonCatalog → MinorBodyCatalog → Orekit. Each moon carries a non-Sun `orbitingBody` (its parent planet) so the renderer can position it relative to the parent. Earth's Moon stays on the Orekit DE-440 path it always used and is deliberately not in MoonCatalog.

**Classification.** Eight bodies are massive (feel and exert mutual gravity): Earth's Moon, the four Galileans (so the Io-Europa-Ganymede 4:2:1 Laplace resonance simulates faithfully), Titan, Triton, and Charon. Charon is massive despite being ~10× lighter than Triton because it's ~12% of Pluto's mass, the largest moon-to-planet ratio in the solar system, and the Pluto-Charon barycenter only dances if both bodies are massive. The other 14 are test particles (their pull on the parent is below numerical noise on portfolio timescales), sorted into the test suffix of the `[massive | test]` state layout by the same `SimulationFactory` partition that handles minor bodies.

**Per-parent render scale.** Heliocentric log compression (the Stylized preset's `A=60`, `r_ref=1 AU`) crushes parent-relative moon distances to a tiny fraction of a world unit, so every moon would clamp to the min-separation floor and pile on top of its parent. The scale pipeline now consults a `MOON_LOG_SCALE` map keyed by parent planet; when a body's parent isn't the Sun, `worldDistanceFromParent` applies that parent's own log curve (`A=5`, `r_ref` = the parent's innermost-moon real distance) instead of the heliocentric one, so each planet system spreads into its own readable cluster rather than collapsing to a ring. The per-parent anchors (all `A=5`, `r_ref` = innermost-moon real distance in metres): Earth 3.84e8 (Moon), Mars 9.38e6 (Phobos), Jupiter 4.218e8 (Io), Saturn 1.855e8 (Mimas), Uranus 1.297e8 (Miranda), Neptune 3.5476e8 (Triton), Pluto 1.96e7 (Charon). The parent name is resolved once per scene component (memoized, with a cached body index) so the per-frame render path stays allocation-free.

### Reality-drift overlay: independent truth, visible-window fetching, model-vs-method drift

The drift overlay renders the integrator's **predicted** position for the focused body next to its **true** position at the same simulated date, with a ghost marker, a true trail, a connector line, and an "off by" km/angle readout. Three decisions shape it.

**Truth is independent of the integrator.** True positions come from Orekit's bundled DE-440 ephemeris (`CelestialBodyFactory.getPVCoordinates`), sampled Sun-relative in the session frame to match `snapshotFromState`, and seeded from the same t=0 state the integrator starts from. Because the true track is a genuinely separate source, the overlay's correctness is self-evident: Euler visibly diverges while RK4 stays glued, which couldn't happen if "true" and "predicted" were the same data. Truth is sourced for planets + Pluto only (the bodies in DE-440 that orbit the Sun); moons and Horizons-sourced minor bodies are out of v1.

**Ground truth is fetched for the visible window, not a fixed window.** The first design fetched a fixed 1-year window and extended it; this froze the marker because **simulation-time-per-chunk is decoupled from wall-clock**: one 10k-step chunk spans ~1.14 years at the default 1-hour step (and decades at days/weeks steps), so a 1-year window was overrun almost immediately and `buildTrueTrack` clamped the marker to the last anchor. The shipped model instead scopes each fetch to the **visible read window** (the trail keyframes around the playback head plus a lookahead), for the **active body only**, at a cadence sized so the span yields a bounded anchor count (`span / ~400`, floored at the keyframe spacing so it never oversamples), and **replaces** the anchors per fetch (no merge/extension bookkeeping). Coverage therefore tracks whatever is on screen at any time-step, the payload stays ~tens of KB per refetch with zero external (JPL) calls, and the render loop is untouched. User-driven focus/overlay changes bypass the in-flight guard so a focus switch refetches immediately rather than waiting for the next chunk.

**The overlay measures model error, not just method error.** For an accurate integrator the truncation error is negligible (RK4 at a 1-hour step is ~10⁻²² per orbit for an outer planet), so the residual drift it shows is dominated by **model incompleteness**: our Newtonian point-mass N-body omits the general relativity, asteroid perturbations, and oblateness that DE-440 carries. This complements the `ΔE/E₀` energy readout, which measures the integrator's truncation error *within our own model*. So the two surfaces answer different questions: `ΔE/E₀` is "how well does our method conserve our model," the drift overlay is "how far is our model from reality." One consequence for reading the overlay: drift is clearest in **Real** scale and on **inner/closer bodies**; in **Stylized** the log compression squashes a far body's offset (e.g. Saturn's real ~1.5M km / 0.06° drift) to sub-body-size on screen even though the number is large.

### Preset clips: canonical scenarios as static edge assets

Every canonical scenario (the builders' untouched default plus the four catalog quick-selects) is precomputed once and committed as a static binary bundle (`clip-<presetId>-v3.bin`) that Cloudflare Pages serves from the edge: the captured initialize response plus the first several wire-format chunks, played back through the same decode path as a live stream but with no session, so a preset run costs the backend nothing. Both builders intercept Run with an **exact** match (same epoch, frame, integrator, step, fidelity, and a set-equal body selection); anything else runs live, because a false positive would serve the wrong physics while a false negative only costs a live session. A single frontend registry drives the generator's preset table, the loader, and a staleness-guard test that fails CI whenever a committed asset no longer matches the registry, the shared preset constants, or the wire version.

Two sizing rules keep clips inside the playback buffer's byte budget on low-memory clients: the 40-body full-catalog clip ships fewer chunks than the rest, and the generator asserts every clip decodes to at most 80% of the low-memory budget, with a runtime pre-fetch check falling back to the live path as the backstop. Mobile's scenario chips were removed in the same change: with every quick-select playing instantly from the edge, the builder is the single configuration surface on both platforms, and the mobile auto-run just plays the default clip.

Two consequences ride along. Ground truth for the drift overlay became sessionless (`body` + `frame` request params against a static DE-440 allowlist, which also guarantees an arbitrary request can never trigger a JPL Horizons fetch), since clip playback has no session to derive them from. And the ~29 Horizons state vectors the catalog needs at the fixed default epoch are baked into the backend jar as classpath seeds, harvested from the clip generation run itself, so a fresh container serves any default-epoch scenario without touching JPL; the disk cache (wiped on redeploy without a volume) now only matters for non-default epochs.

## Resolved design decisions (UI redesign)

Decisions made during the Tailwind + Radix + shadcn migration that shape what's on screen now:

1. **Body selector composition.** Catalog expanded to 40: Sun + 8 planets + 22 moons (Earth's Moon + the 21 major moons, see the "Major moons" architecture decision and #17 below) + 5 dwarf planets / large main-belt asteroids (Pluto, Ceres, Vesta, Pallas, Hygiea) + 4 named near-Earth asteroids (Eros, Apophis, Bennu, Ryugu). The configure drawer groups bodies into three sections (Planets / Dwarf planets / Near-Earth asteroids), with moons nested under their parent body within each section. Default selection is Sun + 8 planets + Earth's Moon (10 bodies) so a first-run sim doesn't fan out a pile of Horizons fetches on submit; the other moons and all minor bodies are explicitly opt-in via the drawer. N-body framing remains a feature, not a footnote.
2. **Camera.** Free 3D orbit retained; "Top-down" preset is the default for newcomers (and the angle the design's compass / ghost labels assume).
3. **Scale terminology.** The two scale presets are labeled **Real** and **Stylized** (see decision 16); Stylized is backed by real logarithmic distance compression.
4. **Display frame is render-time, not a session parameter.** Backend always emits heliocentric snapshots (see "Sun-relative emission" above); client applies per-frame frame transform before render. Tap-compass-to-switch is free, no buffer drop. Helio + geo currently shipped; bary deferred (needs a shared per-timestep pivot cache to not blow up trail render cost).
5. **Step accept %.** Hide row entirely for fixed-step integrators (Euler, RK4); show only for DP853.
6. **REC indicator dropped.** Replaced with `BUFFER` + `CHUNK` status, which surfaces a real engineering detail rather than mimicking a video recorder.
7. **SimParams "Run" semantics.** Run always re-inits the session. A small set of fields may go live-editable later (Δt, frame, body toggles).
8. **Reality drift overlay placement.** Toggle lives as a chip in the bottom view-toggle panel (alongside Grid / Trails / Orbits / etc.); when on, it opens a small overlay card pinned near the active body. Keeps the right-column body card uncluttered. (Originally planned as a dedicated left-rail icon; the left rail was removed once its only live control, the camera preset, moved to the bottom view-toggle panel; a left rail holding a single working button plus dead stubs wasn't worth a whole surface. All view toggles now group in one place.)
9. **Dev surfaces.** DevMetrics + dev-camera tweaker keep their slot, mounted only under `?dev=1`.
10. **Mobile.** Responsive web only (no React Native / SwiftUI). Mobile flow at <1280px viewport using Radix Sheet for the iOS-style sheets.
11. **Toggleable body graphics.** UI chrome bodies use flat radial-gradient circles per the design's body color tokens. Scene 3D bodies ship realistic textures by default; a live-toggleable "stylized" variant renders flat-shaded matte spheres matching the chrome palette.
12. **Sim setup as primary entrypoint.** Promoted from a left-rail gear icon (modal) to a labeled CTA in the top bar paired with a clickable Configuration chip; both open the same drawer. Pulse-dot on the CTA hints "do this first" until the user has run their first sim (suppressed once `lastRequest` is set).
13. **No keyboard shortcut for opening the SimSetup drawer.** Spacebar is reserved for play/pause (universal media-app reflex). Drawer keeps Esc-to-close (Radix default). If a shortcut is added later, use `S` (not space, not ⌘K).
14. **`Buffer` cell kept in the top status strip** despite not being in the sim-setup handoff. Load-bearing demo telemetry: the buffered-vs-played delta visualizes the chunk fetcher racing ahead of playback.
15. **Integrator residuals on the wire.** Backend computes total mechanical energy `E = T + U` at every emitted snapshot and ships `(E − E₀) / |E₀|` as a float32 per snapshot. DP853 chunks also carry chunk-aggregate `avgStepSeconds` + `acceptRate` in the header (latter approximated as `acceptedSubsteps / (evaluations / 12)`; DP853 is 12-stage with FSAL, so the constant is slightly off at chunk boundaries but well under 1% error at chunk scale). Frontend renders a single always-visible `ΔE/E₀` cell on the top status strip plus an `Integrator residual` subsection on the body card (the DP853 rows hide for fixed-step integrators per #5). Each surface carries plain-English `InfoTooltip` copy; tooltips render via React Portal to escape the strip's `backdrop-filter` stacking context. The point: make the integrator trade-off legible. Pick Euler at daily timesteps and watch the number tick visibly past `1e-2`; pick DP853 and watch it sit at machine precision. Wire overhead: 12 B header + 4 B per snapshot, ~0.4 % of chunk size at default fidelity.
16. **Scale pipeline: Real / Stylized presets via explicit pipeline functions.** Replaced the legacy `positionScale` / `radiusScale` knobs (which had a 40× body-vs-distance distortion in the old "Semi-Realistic" preset and a per-body `×15` Moon hack) with a pipeline of three pure functions: `worldDistance(r, preset)` for radial distance, `worldRadius(R, preset)` for body size, `worldDistanceFromParent(...)` for child-of-parent minimum separation. Two presets. **Real**: linear divide by 1e8, giving physically accurate ratios, bodies are dots at default zoom, the truth reference. **Stylized**: `A · log10(1 + r / r_ref)` radial compression (`A=60`, `r_ref=1 AU`, putting Mercury at 8.8 wu, Neptune at 89.5 wu, full system in one viewport) plus power-law body radii `(R/1e8) ^ k` (`k=0.5`, sqrt-ish, so the Sun dominates, the Moon is visibly half the size of Earth, and every body stays clickable). The Moon `×15` patch generalised into a body-agnostic minimum-separation rule that fires for any body with `orbitingBody` set, computing the threshold from runtime data (parent + child world radii). Works automatically for any future small satellite without per-body hardcoding. Pipeline params live in `devSettingsStore` and are live-tunable via three sliders in the dev panel (`?dev=1`), namely `Log A`, `Log r_ref` (log-mapped slider), and `Body k`, so the values shipped as production defaults could be picked by direct visual comparison rather than from a spreadsheet.
17. **Moons nest under their parent body.** The 21 major moons share the existing `planet` BodyCategory rather than getting their own top-level section. In the configure drawer, every parent body that has moons renders a collapsible "Moons" group directly beneath it (Earth → Moon; Jupiter → the Galileans; Saturn → its seven; and so on), in whatever section the parent lives, so Charon nests under Pluto inside the Dwarf planets section. A section's master toggle and count span its top-level bodies plus the moons nested under them, which means a moon counts under its parent's section even when its own category differs (Charon is category `planet` but counts under Dwarf planets via Pluto). Default first-paint selection stays Sun + 8 planets + Earth's Moon; the other 20 moons are opt-in via their parent's group toggle, so a default Run doesn't fan out 20 Horizons fetches. Collapse is hand-rolled React state (the drawer already hand-rolls its own toggle switch) rather than adding a collapsible dependency.

## Status

Runs end-to-end on `master`: three integrators (Euler / RK4 / Dormand–Prince 853) are wired in; the frontend renders bodies with scaled distances and per-body textures; time controls, body selection, geocentric/heliocentric frame switching, and Keplerian-element readouts function. The headline demo layer, the reality-drift overlay (predicted vs DE-440 truth), has shipped. The project is deployed and live: a Railway backend and Cloudflare Pages frontend behind Cloudflare, at [nbodysim.com](https://nbodysim.com).

## Planned work

### Production hosting

- Sentry uptime monitoring: a dashboard check on the public URL. (A backend `/actuator/health` monitor is intentionally skipped: continuous polling would keep the sleeping Railway dyno awake and fight the spend cap; backend faults surface via Sentry error events instead.)

> Already in place: Railway backend (Dockerfile + `/actuator/health`), Cloudflare Pages frontend, Cloudflare proxy for DDoS protection and bot detection (defends against IP-rotation attacks that per-IP rate limiting alone can't stop), env-driven CORS allowlist, per-IP per-endpoint + global rate limiting (Bucket4j), a Cloudflare origin-lock filter, env-gated Sentry error tracking (backend + frontend), security headers + non-root container, the live demo link + hero GIF in this README, and GitHub Actions CI for both stacks.

### Frontend showcase

- **Interesting-moment timeline markers**: backend scans each computed chunk for events (closest approaches, conjunctions, syzygies, eclipses) and surfaces them as clickable markers on the scrubber.

> Already in place: reality-drift overlay (predicted vs DE-440 truth, with the visible-window ground-truth model, see the architecture decision above), integrator residuals (`ΔE/E₀`) in the body card and top strip, log-compressed distance scaling (the Stylized preset, see decision 16), cubic Hermite client-side interpolation between keyframes using the integrator's exact velocities (which replaced the originally-planned Catmull-Rom approach), orbital trails, planet rotation, decoupled render loop (R3F `useFrame` + refs), Sun unlit material, web-worker zstd decompression, custom binary wire format, fully imperative scene graph, frame switching (helio/geo) with honest geocentric trail reprojection, Keplerian elements display, hot-path allocation discipline.

### Architectural cleanup

- Use μ (gravitational parameter) directly throughout the simulation; drop the imprecise `mass = body.getGM() / G` conversion in `CelestialBodyWrapper`. (µ is already exposed via `getMu()`; the broader refactor of acceleration calculations remains.)
- Coalesce overlapping Redux middleware that both intercept `setCurrentTimeStepIndex`.
- Reset frontend state cleanly on sim resubmit (currently the chunk buffer + time state can carry stale values across resubmits).

### Quality plumbing

- Mobile responsive review: touch interactions for camera, sheet behaviour on narrow viewports.

> Already in place: OpenAPI generation with shared types between backend and frontend (a committed `openapi.json` feeds the frontend's TypeScript codegen, and a contract test fails CI on drift, which we'd already paid for once via Redux-key typos); ESLint + Prettier on CI; test-scope rule followed in both stacks (write tests where failures would be silent, where correctness contracts are non-obvious, or at two-sided boundaries; skip the rest); Vitest + JUnit running in both CIs; force model, all three integrators, and binary wire-format round-trip pinned by tests.

## Beyond v1: collaborative / classroom direction

Once the single-user portfolio piece is shipped, the most interesting direction is **multi-user shared sessions**: one user ("presenter" / "teacher") drives the simulation; others ("audience" / "students") follow in synced lockstep. The economic case is concrete: the same simulation viewed by N people should cost the backend ~1× bandwidth, not N×, because every viewer is watching identical bytes.

**Architectural shape:**

- **Simulation chunks over HTTP/2**: cacheable per-session, can be served from a CDN edge. When student #2 joins teacher's session, chunk N is already in cache.
- **Sync events over WebSocket**: small JSON deltas (`{event:"scrub", index:4521}`, `{event:"pause"}`, `{event:"setActiveBody", name:"Earth"}`). Sub-kilobyte messages, broadcast from presenter to all subscribers.

This split lets each protocol do what it's actually good at: HTTP for bulk + caching, WebSocket for low-latency real-time fan-out. Mirrors how Figma, Google Docs, etc. are structured.

**Features that fall out of this:**

- Shared cursor / camera ghosts so viewers see where others are looking.
- Annotations pinned to (timestep, body): leave a note that other viewers see.
- Quizzes / interactive prompts pushed from teacher to students mid-session.
- Recording + replay of full sessions, including all sync events.
- Teacher dashboard showing student attention / interaction state.
- Streamed LLM narration ("explain what's happening at the current moment"), token-streamed over the same sync channel.

**Why not now:** needs identity (who's the teacher? who's a student?), permissions (can a student take the controls?), persistence (stored sessions, replays). It's a product layer on top of the simulation engine. The relevant *technical* prep work is making chunk delivery cacheable and stateless, which is the v1 protocol-migration step.

## Known tradeoffs

- **Backend is stateful.** Simulation sessions live in JVM memory. Single-instance deployment only; server restart resets all in-flight sessions. This is intentional. The project's portfolio angle is end-to-end systems plus frontend performance, not horizontal scaling. If multi-instance ever matters, the in-memory `ConcurrentHashMap` becomes a Redis-backed store.
- **Compute is server-side** in Java rather than browser-side WASM. This trades client autonomy for accuracy and access to Orekit's astrodynamics tooling (JPL ephemerides, real reference frames, validated integrators).
- **Wire format is custom binary** rather than a schema-driven protocol like MessagePack or protobuf. The shape is uniform numeric data (positions + velocities), so a flat little-endian layout compresses well under zstd and is trivial to write/parse on both ends. Schema-driven formats would add tooling overhead without measurable wins for this payload shape.

## Tech choices

| Layer | Choice | Why |
|---|---|---|
| Backend framework | Spring Boot 3 (Java 21 LTS) | Familiar, batteries-included; HTTP/2 chunk delivery scales naturally and stays cacheable |
| Astrodynamics | Orekit 12 | JPL ephemerides, ICRF/GCRF reference frames, validated propagators; avoids reinventing physics |
| Wire compression | Zstd | Good ratio on the binary trajectory format; small WASM decoder client-side |
| Frontend framework | Next.js (CSR) | Project is interactive; SSR not relevant here |
| 3D rendering | React Three Fiber | Three.js wrapped in React's declarative model |
| State | Redux Toolkit | Async thunks model the "fetch → worker decode → buffer → tick" pipeline cleanly |
| UI primitives | Tailwind v4 + Radix + shadcn | CSS-first design tokens, headless primitives, vendored components |

## Credits

- Earth icon: [Global icons](https://www.flaticon.com/free-icons/global) by Freepik on Flaticon.
- Planet textures: [Solar System Scope](https://www.solarsystemscope.com/textures/), used under [CC Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
- Astrodynamics: [Orekit](https://www.orekit.org/) (CS GROUP / CNES).
