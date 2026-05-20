# spacesim — architecture

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
   Vercel (planned)                                      Fly.io (planned)
```

**Backend** — Spring Boot 3 + Orekit 12. `POST /api/simulation/initialize` builds a session with bodies, frame, integrator, and start date; subsequent `POST /api/simulation/chunk` calls return zstd-compressed binary trajectories. After each chunk is served, the next 10k-step block is speculatively pre-computed on a daemon executor so subsequent requests hit cache. Sessions are tracked by sessionID and evicted by a periodic idle-timeout sweeper.

**Frontend** — Next.js + React Three Fiber. Redux Toolkit holds a typed-array-backed chunk buffer (`Float64Array` positions + `BigInt64Array` timestamps) laid out in the same row-major shape as the wire format — O(1) lookup by timestep index, zero-copy hand-off from the decode worker. An async thunk fetches the next chunk when the buffer dips below a speed-aware threshold (`max(1000, speedMultiplier × FPS × rolling-fetch-latency × 1.5)`), and `copyWithin`-shifts the oldest entries left when capacity is reached. Capacity is byte-budget-derived at session start (12 MB mobile / 48 MB desktop) so it scales inversely with body count. The render loop tape-plays the buffer at a target frame rate via R3F's `useFrame`; the scene supports two scale presets (semi-realistic, realistic) and per-body exception scaling for tightly-coupled pairs (e.g., Earth–Moon).

**Wire format** — custom little-endian binary layout: body names + µ in a one-time header, then per-timestep `int64` timestamp + per body 3 × `float64` position + 3 × `float32` velocity. Mixed precision: positions are rendered directly so they need float64 precision (float32 quantization caused visible orbit-plane jitter on outer planets at high fidelity); velocities feed downstream math that damps precision loss by ~5 orders of magnitude, so float32 is fine. Zstd-compressed with a 4-byte little-endian uncompressed-size prefix. The Web Worker decodes directly into the `Float64Array` + `BigInt64Array` shape the buffer expects (velocities widen on assignment) and transfers both underlying buffers back to the main thread — no intermediate JS-object hops, no copy at the worker boundary.

## Architecture decisions

The shape of the system reflects a handful of pivotal calls. Listed roughly in the order they were made.

### N-body integration via a global state vector

Trajectories are computed by an in-house pluggable integrator (Euler / RK4 / Dormand–Prince 853) operating on a flat 6N-dimensional state vector — `[r₀, v₀, r₁, v₁, …]` — with mutual gravitational accelerations summed across all body pairs each step. Earlier the codebase propagated each body independently using Orekit's per-body APIs; the rewrite introduced `GlobalState`, `NBodyDerivatives`, and a sealed `Integrator` interface. **Trade-off:** trajectories now come from our integrator's accuracy budget rather than JPL's; JPL ephemerides only seed t=0. This is intentional — the project's portfolio angle is "I built the integrator," not "I read JPL's tables." The reality-drift overlay (planned) makes this trade-off visible by showing live divergence vs. the JPL ground truth.

### Chunk delivery over HTTP/2, not WebSocket

Simulation results stream as zstd-compressed binary chunks via `POST /api/simulation/chunk`. The original implementation used WebSocket; this was migrated out (~390 lines deleted, including WebSocketHandler, WS serializers, grace-period machinery, reconnect/replay middleware). HTTP/2 is the right tool here: chunks are independently retryable, per-session cacheable at the CDN edge, and the client doesn't need a persistent connection or reconnect logic. Session lifecycle moved to a `@Scheduled` idle-timeout sweeper (15 min) instead of WS-disconnect cleanup. This call also unblocks the multi-viewer collaborative direction described below.

### Sun-relative emission at the snapshot boundary

Backend snapshots are always emitted Sun-relative — `Simulation.snapshotFromState` subtracts the Sun's position/velocity from every body before serializing. The Sun does move physically during integration (planets pull on it), but the wobble is sub-Sun-radius and visually meaningless; pinning the Sun at origin in the wire format simplifies every downstream consumer. As a side effect, this makes display-frame switching (helio ↔ geo) a pure render-time pivot subtraction on the client — see `framePivot.ts` — instead of a re-emission from the backend.

### Imperative scene graph, no per-tick React rerenders

The 3D scene's R3F components (`Sphere`, `Trail`, `Reticle`, `GhostLabel`, `Camera`) update positions imperatively inside `useFrame` by reading from the chunk buffer at the current timestep via `useStore.getState()` — they never subscribe to per-frame state. Per-frame Redux subscriptions would force React to reconcile the entire scene on every animation tick, which dominated the cost in earlier profiles. Pattern documented in `engineering_patterns_spacesim.md`. Active body identity carries as a string (`activeBodyName`), not a buffer reference, so identity changes don't cascade.

### Hot-path mutating-output pattern

Anything in the frontend render loop or backend integrator step uses pre-allocated buffers and mutating-output APIs (`scaleDistanceInto`, `subtractInto`, `derivativesInto`, `stepInto`, etc.) to avoid per-frame allocation. Documented in `engineering_patterns_spacesim.md`. The Trail.tsx perf bug — closures + per-frame `Array.find()` summing to ~45 000 closure allocations per frame at trail length 5000 — was the motivating incident.

### Typed-array buffer mirrors the wire format end-to-end

The chunk buffer is a flat `Float64Array` of position+velocity (`idx × bodyCount × 6` doubles per timestep, components `[px, py, pz, vx, vy, vz]`) paired with a `BigInt64Array` of millis-since-epoch timestamps. Identical layout on the wire, in the decode worker, and in Redux state. Consumers (`Sphere`, `Trail`, `Reticle`, etc.) resolve `bodyName → index` once per session via a `Map` and read state at `(timestep, body)` via mutating accessors (`readBodyPositionInto`, `readBodyStateInto`) into pre-allocated scratch `THREE.Vector3` refs. The previous architecture was a date-keyed `Record<string, CelestialBody[]>` — every per-frame lookup paid `Object.keys()` (O(N) in buffer size) and every body access paid `.find()` (O(N) in body count), so buffer-size and consumer-count both fed the per-frame cost. The typed-array layout decouples them; per-frame cost is now O(1) regardless of buffer depth. **Trade-offs:** Immer doesn't draft typed arrays (so the slice keeps the same wrapper object reference across appends — `appendChunk` mutates in place); selectors that need to fire on chunk-arrival depend on `totalTimesteps` rather than buffer-reference identity. Chunk transitions are silent — no auto-unpause on arrival, no "Fetching data" modal flash between chunks.

### Speculative precompute + speed-aware prefetch

Backend kicks off the next 10k-step compute the moment it ships a chunk, holding the result in a per-session `CompletableFuture<byte[]>` cache. Client-side, the prefetch trigger scales with `speedMultiplier × FPS × rolling-fetch-latency × safety_factor` — so at `speedMultiplier=128` the threshold becomes ~11 520 steps and a fetch is essentially always in flight. The two pieces work together: the server-side cache cuts perceived chunk-fetch latency to near-network-only, and the speed-aware threshold ensures the client requests early enough that the cache hit lands before the buffer empties. Buffer eviction is `Float64Array.copyWithin` (single memmove), one-shot on overflow.

### Buffer capacity is byte-budgeted, not step-counted

Two device-class tiers picked at session start: 12 MB (mobile / `deviceMemory ≤ 4` / viewport `< 768px`) and 48 MB (everything else). Capacity falls out as `floor(byteBudget / (bodyCount × 48))`, so a 3-body sim gets a much deeper buffer than a 12-body sim under the same budget. Decoupling the cap from a fixed timestep count means user-driven body-count changes don't accidentally exceed the memory budget; decoupling from device class means mobile won't try to allocate ~43 MB on a phone. Heuristic ceilings, not measured — validation path is in the redesign spec.

### Cubic Hermite interpolation + per-integrator emission

The user picks a "Playback quality" bucket in SimSetupDrawer (5 buckets, per-integrator landing default — Euler→Med-High, RK4→Medium, DP853→Med-Low — auto-resets on integrator change). Wire format is a single `fidelityBucket` string on `/initialize`; backend resolves to per-integrator emission settings via the `FidelityBucket` enum (one source of truth, mirrored on both sides).

**Fixed-step integrators (Euler, RK4)** thin the external-step grid by K: the backend emits every Kth integration step, with cross-chunk continuity preserved by a monotonic `globalStepCount` cursor inside `Simulation` so chunk N+1's first kept frame lands exactly K steps after chunk N's last. Bucket→K table: Low/20, Med-Low/10, Medium/5, Med-High/2, High/1.

**DP853 (adaptive)** runs Mode C time-gap thinning instead. Emissions land at exact schedule timestamps (`simStart + k × gap` for k = 0..N-1) via Hipparchus's per-substep interpolator — the substep handler computes interpolated state at the precise target time rather than emitting at whichever substep first crosses the target. Produces uniformly-time-spaced samples by construction, which is load-bearing for any consumer that iterates the chunk buffer by integer index (Trail.tsx, etc.) — those treat adjacent buffer entries as equally spaced in time, so non-uniform timestamps would render visible wobble between vertices. Cross-chunk continuity via a per-session `adaptiveEmitCount` cursor; bucket→N table: Low/3000, Med-Low/5000, Medium/7500, Med-High/10000, High/15000. The DP853 tier is heavier on opt-in (up to ~4.5 MB compressed at the highest bucket vs the ~3 MB default-tier ceiling) — discoverable accuracy for users who opt in, default flows land on the fixed-step integrators.

**Frontend** uses cubic Hermite interpolation between samples — analytic-tangent form using the integrator's exact velocities (already on the wire), no estimation. Per-keyframe timestamps are always shipped, so non-uniform spacing is handled by the read path with no protocol change. Hermite at integer keyframe indices short-circuits to a direct typed-array read, so existing integer-index callers (Trail tail loop) keep the no-allocation fast path.

**Wire compactness.** Positions float64, velocities float32 (timestamp int64, µ float64). Float32 on positions was the original Phase 1 lever but caused visible orbit-plane jitter on outer planets at high fidelity — float32's ~540 km quantization at Neptune's 4.5×10¹² m radius dominated per-sample Z motion. Velocities are quantization-safe: their downstream uses (Hermite tangent over one gap-interval; Keplerian v² → semi-major axis) damp precision loss far below visible. Net wire is 75% of full float64. Combined with Mode C, DP853 default chunks dropped from ~16 MB compressed (the old "emit every accepted substep + throw at MAX_SNAPSHOTS_PER_CHUNK" model) to ~1.5 MB compressed.

### Minor-body initial state via JPL Horizons HTTP (cached, serialized)

Bodies outside Orekit's bundled DE-440 (dwarf planets like Ceres, named near-Earth asteroids like Eros / Apophis / Bennu / Ryugu) source their initial state vectors from JPL Horizons at sim-submit time, keyed by SPK ID and the user's chosen epoch. The factory wraps the HTTP call in a process-local `ConcurrentHashMap` cache keyed by `(SPK_ID, epochSecondsFromJ2000)` — state vectors at any (body, epoch) are deterministic from JPL's orbit fits, so once fetched they never need to re-query in the same process. All outbound HTTP serializes through a single global fair `Semaphore` to honor JPL's published "one API request at a time" rule, which the per-key cache locks don't enforce across distinct bodies. Horizons returns Sun-relative positions in ICRF orientation; the factory adds Orekit's Sun PV in the user's chosen frame so the resulting state is consistent with Orekit-sourced major-planet states whether the frame is Heliocentric, ICRF (SSB-centered), or GCRF. **Trade-offs:** adds a network dependency at sim-submit time (~500 ms per cold body, ≤9 minor bodies → ~4.5 s worst case for a fully-cold submission). Cache is in-process only — Fly.io redeploys wipe it, so the first sim after each deploy pays the full latency. JPL's query syntax has a quirk worth flagging: SPK IDs for IAU-numbered small bodies (range 2_000_001+) need the `COMMAND='DES=<spkId>;'` form because bare numeric values are interpreted as IAU asteroid numbers (max 887103); major-body codes 1..999 (future moons) use the bare form. Orekit doesn't natively read SPICE SPK kernels, so HTTP was the only path without reimplementing kernel readers.

### Massive / test-particle dispatch in NBodyDerivatives

The N-body force kernel partitions bodies into a `[massive | test]` prefix layout and bounds every body's force sum to the massive prefix. Massive bodies feel gravity from other massives; test particles feel gravity from the massive prefix but exert none. State buffer layout `[massive | test]` lets `NBodyDerivatives` take a single `massiveCount` and switch the inner-loop bound with one hoisted local read — no per-pair branch in the hot path. Cost is `M·(M−1) + T·M` per integrator substep instead of `(M+T)·(M+T−1)` for a full N². At the current 19-body catalog this is small (~200 force ops/step vs. ~340), but the scaling matters once the catalog grows: a future asteroid-belt expansion at T=1000 test particles would cost ~9k ops/step instead of ~1.0M. Asteroid masses are 10⁻⁴ to 10⁻⁹ Earth — their pull on planets is well below numerical noise, so the test-particle approximation is physically faithful at the current scale. **Trade-offs:** test particles exert no force on the system, so the `ΔE/E₀` energy readout has to be computed over the massive subsystem only — otherwise test-particle kinetic + potential terms would couple the integrator-quality metric to noise. Test particles also can't form bound pairs with each other (e.g. the Pluto-Charon barycenter dance needs both bodies massive). Newton's 3rd law is preserved on the massive subsystem; the asymmetric "massive feels test but test doesn't feel massive" variant would non-conserve momentum.

## Resolved design decisions (UI redesign)

Decisions made during the Tailwind + Radix + shadcn migration that shape what's on screen now:

1. **Body selector composition.** Catalog expanded to 19 — Sun + 8 planets + Moon + 5 dwarf planets / large main-belt asteroids (Pluto, Ceres, Vesta, Pallas, Hygiea) + 4 named near-Earth asteroids (Eros, Apophis, Bennu, Ryugu). The configure drawer groups bodies into three sections (Planets / Dwarf planets / Near-Earth asteroids). Default selection is planets-only (10 bodies) so a first-run sim doesn't fan out 9 Horizons fetches on submit; minor bodies are explicitly opt-in via the drawer. N-body framing remains a feature, not a footnote.
2. **Camera.** Free 3D orbit retained; "Top-down" preset is the default for newcomers (and the angle the design's compass / ghost labels assume).
3. **Scale terminology.** UI says `LIN / LOG` rather than `SEMI / REAL`. The `LOG` setting will eventually be backed by real logarithmic distance compression.
4. **Display frame is render-time, not a session parameter.** Backend always emits heliocentric snapshots (see "Sun-relative emission" above); client applies per-frame frame transform before render. Tap-compass-to-switch is free, no buffer drop. Helio + geo currently shipped; bary deferred (needs a shared per-timestep pivot cache to not blow up trail render cost).
5. **Step accept %.** Hide row entirely for fixed-step integrators (Euler, RK4); show only for DP853.
6. **REC indicator dropped.** Replaced with `BUFFER` + `CHUNK` status — surfaces a real engineering detail rather than mimicking a video recorder.
7. **SimParams "Run" semantics.** Run always re-inits the session. A small set of fields may go live-editable later (Δt, frame, body toggles).
8. **Reality drift overlay placement.** Dedicated left-rail icon, opens a small overlay card pinned near the active body. Keeps the right-column body card uncluttered.
9. **Dev surfaces.** DevMetrics + dev-camera tweaker keep their slot, mounted only under `?dev=1`.
10. **Mobile.** Responsive web only (no React Native / SwiftUI). Mobile flow at <1280px viewport using Radix Sheet for the iOS-style sheets.
11. **Body graphics — toggleable.** UI chrome bodies use flat radial-gradient circles per the design's body color tokens. Scene 3D bodies ship realistic textures by default; a live-toggleable "stylized" variant renders flat-shaded matte spheres matching the chrome palette.
12. **Sim setup as primary entrypoint.** Promoted from a left-rail gear icon (modal) to a labeled CTA in the top bar paired with a clickable Configuration chip — both open the same drawer. Pulse-dot on the CTA hints "do this first" until the user has run their first sim (suppressed once `lastRequest` is set).
13. **No keyboard shortcut for opening the SimSetup drawer.** Spacebar is reserved for play/pause (universal media-app reflex). Drawer keeps Esc-to-close (Radix default). If a shortcut is added later, use `S` — not space, not ⌘K.
14. **`Buffer` cell kept in the top status strip** despite not being in the sim-setup handoff. Load-bearing demo telemetry — buffered-vs-played delta visualizes the chunk fetcher racing ahead of playback.
15. **Integrator residuals on the wire.** Backend computes total mechanical energy `E = T + U` at every emitted snapshot and ships `(E − E₀) / |E₀|` as a float32 per snapshot. DP853 chunks also carry chunk-aggregate `avgStepSeconds` + `acceptRate` in the header (latter approximated as `acceptedSubsteps / (evaluations / 12)` — DP853 is 12-stage with FSAL, so the constant is slightly off at chunk boundaries but well under 1% error at chunk scale). Frontend renders a single always-visible `ΔE/E₀` cell on the top status strip plus an `Integrator residual` subsection on the body card (the DP853 rows hide for fixed-step integrators per #5). Each surface carries plain-English `InfoTooltip` copy; tooltips render via React Portal to escape the strip's `backdrop-filter` stacking context. The point: make the integrator trade-off legible — pick Euler at daily timesteps and watch the number tick visibly past `1e-2`; pick DP853 and watch it sit at machine precision. Wire overhead: 12 B header + 4 B per snapshot, ~0.4 % of chunk size at default fidelity.
16. **Scale pipeline — Real / Stylized presets via explicit pipeline functions.** Replaced the legacy `positionScale` / `radiusScale` knobs (which had a 40× body-vs-distance distortion in the old "Semi-Realistic" preset and a per-body `×15` Moon hack) with a pipeline of three pure functions: `worldDistance(r, preset)` for radial distance, `worldRadius(R, preset)` for body size, `worldDistanceFromParent(...)` for child-of-parent minimum separation. Two presets. **Real**: linear divide by 1e8 — physically accurate ratios, bodies are dots at default zoom, the truth reference. **Stylized**: `A · log10(1 + r / r_ref)` radial compression (`A=60`, `r_ref=1 AU` — Mercury at 8.8 wu, Neptune at 89.5 wu, full system in one viewport) plus power-law body radii `(R/1e8) ^ k` (`k=0.5`, sqrt-ish — Sun dominant, Moon visibly half the size of Earth, every body clickable). The Moon `×15` patch generalised into a body-agnostic minimum-separation rule that fires for any body with `orbitingBody` set, computing the threshold from runtime data (parent + child world radii). Works automatically for any future small satellite without per-body hardcoding. Pipeline params live in `devSettingsStore` and are live-tunable via three sliders in the dev panel (`?dev=1`) — `Log A`, `Log r_ref` (log-mapped slider), `Body k` — so the values shipped as production defaults could be picked by direct visual comparison rather than from a spreadsheet.

## Status

Currently a working local prototype on the `redesign-ui` branch. The simulation runs end-to-end; three integrators (Euler / RK4 / Dormand–Prince 853) are wired in; the frontend renders bodies with scaled distances and per-body textures; time controls, body selection, geocentric/heliocentric frame switching, and Keplerian-element readouts function. Focus is the demo layer (reality-drift overlay) and pre-deploy polish.

## Planned work

### Production hosting

- Cloudflare proxy in front of Fly.io for DDoS protection and bot detection (defends against IP-rotation attacks that per-IP rate limiting alone can't stop).
- Sentry SDKs (backend + frontend) for error tracking and uptime monitoring.
- Live demo link + hero screenshot/GIF in README once deployed.

> Already in place: Fly.io backend (Dockerfile + `fly.toml` + `/actuator/health`), Vercel frontend, env-driven CORS allowlist, per-IP + global rate limiting (Bucket4j), GitHub Actions CI for both stacks.

### Frontend showcase

- **Reality drift overlay** vs JPL ephemerides — visualise integrator error live (Euler diverges within days; DP853 essentially glued).
- **Interesting-moment timeline markers** — backend scans each computed chunk for events (closest approaches, conjunctions, syzygies, eclipses) and surfaces them as clickable markers on the scrubber.
- **Integrator residuals** in the body card — `ΔE/E₀` per chunk, plus DP853 step-accept rate.
- **Log distance scaling** — true logarithmic compression of radial distances so outer planets are visible at default zoom.
- Catmull-Rom client-side interpolation between keyframes — backend sends every Nth keyframe; client interpolates with `THREE.CatmullRomCurve3`. Cuts payload + smooths playback.

> Already in place: orbital trails, planet rotation, decoupled render loop (R3F `useFrame` + refs), Sun unlit material, web-worker zstd decompression, custom binary wire format, fully imperative scene graph, frame switching (helio/geo) with honest geocentric trail reprojection, Keplerian elements display, hot-path allocation discipline.

### Architectural cleanup

- Use μ (gravitational parameter) directly throughout the simulation; drop the imprecise `mass = body.getGM() / G` conversion in `CelestialBodyWrapper`. (µ is already exposed via `getMu()`; the broader refactor of acceleration calculations remains.)
- Coalesce overlapping Redux middleware that both intercept `setCurrentTimeStepIndex`.
- Reset frontend state cleanly on sim resubmit (currently the chunk buffer + time state can carry stale values across resubmits).

### Quality plumbing

- OpenAPI generation with shared types between backend and frontend (eliminates DTO drift, which we've already paid for once via Redux-key typos).
- Mobile responsive review — touch interactions for camera, sheet behaviour on narrow viewports.

> Already in place: ESLint + Prettier on CI; test-scope rule followed in both stacks (write tests where failures would be silent, where correctness contracts are non-obvious, or at two-sided boundaries; skip the rest); Vitest + JUnit running in both CIs; force model, all three integrators, and binary wire-format round-trip pinned by tests.

## Beyond v1: collaborative / classroom direction

Once the single-user portfolio piece is shipped, the most interesting direction is **multi-user shared sessions** — one user ("presenter" / "teacher") drives the simulation; others ("audience" / "students") follow in synced lockstep. The economic case is concrete: the same simulation viewed by N people should cost the backend ~1× bandwidth, not N×, because every viewer is watching identical bytes.

**Architectural shape:**

- **Simulation chunks over HTTP/2** — cacheable per-session, can be served from a CDN edge. When student #2 joins teacher's session, chunk N is already in cache.
- **Sync events over WebSocket** — small JSON deltas (`{event:"scrub", index:4521}`, `{event:"pause"}`, `{event:"setActiveBody", name:"Earth"}`). Sub-kilobyte messages, broadcast from presenter to all subscribers.

This split lets each protocol do what it's actually good at: HTTP for bulk + caching, WebSocket for low-latency real-time fan-out. Mirrors how Figma, Google Docs, etc. are structured.

**Features that fall out of this:**

- Shared cursor / camera ghosts so viewers see where others are looking.
- Annotations pinned to (timestep, body) — leave a note that other viewers see.
- Quizzes / interactive prompts pushed from teacher to students mid-session.
- Recording + replay of full sessions, including all sync events.
- Teacher dashboard showing student attention / interaction state.
- Streamed LLM narration ("explain what's happening at the current moment") — token-streamed over the same sync channel.

**Why not now:** needs identity (who's the teacher? who's a student?), permissions (can a student take the controls?), persistence (stored sessions, replays). It's a product layer on top of the simulation engine. The relevant *technical* prep work is making chunk delivery cacheable and stateless — which is the v1 protocol-migration step.

## Known tradeoffs

- **Backend is stateful** — simulation sessions live in JVM memory. Single-instance deployment only; server restart resets all in-flight sessions. This is intentional. The project's portfolio angle is end-to-end systems plus frontend performance, not horizontal scaling. If multi-instance ever matters, the in-memory `ConcurrentHashMap` becomes a Redis-backed store.
- **Compute is server-side** in Java rather than browser-side WASM. This trades client autonomy for accuracy and access to Orekit's astrodynamics tooling (JPL ephemerides, real reference frames, validated integrators).
- **Wire format is custom binary** rather than a schema-driven protocol like MessagePack or protobuf. The shape is uniform numeric data (positions + velocities), so a flat little-endian layout compresses well under zstd and is trivial to write/parse on both ends. Schema-driven formats would add tooling overhead without measurable wins for this payload shape.

## Tech choices

| Layer | Choice | Why |
|---|---|---|
| Backend framework | Spring Boot 3 (Java 25 LTS) | Familiar, batteries-included; HTTP/2 chunk delivery scales naturally and stays cacheable |
| Astrodynamics | Orekit 12 | JPL ephemerides, ICRF/GCRF reference frames, validated propagators — avoids reinventing physics |
| Wire compression | Zstd | Good ratio on the binary trajectory format; small WASM decoder client-side |
| Frontend framework | Next.js (CSR) | Project is interactive; SSR not relevant here |
| 3D rendering | React Three Fiber | Three.js wrapped in React's declarative model |
| State | Redux Toolkit | Async thunks model the "fetch → worker decode → buffer → tick" pipeline cleanly |
| UI primitives | Tailwind v4 + Radix + shadcn | CSS-first design tokens, headless primitives, vendored components |

## Credits

- Earth icon: [Global icons](https://www.flaticon.com/free-icons/global) by Freepik – Flaticon.
- Planet textures: [Solar System Scope](https://www.solarsystemscope.com/textures/) — used under [CC Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
- Astrodynamics: [Orekit](https://www.orekit.org/) (CS GROUP / CNES).
