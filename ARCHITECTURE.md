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

**Wire format** — custom little-endian binary layout: body names + µ in a one-time header, then per-timestep `int64` timestamp + 6 `float64` per body (position + velocity). Zstd-compressed with a 4-byte little-endian uncompressed-size prefix. The Web Worker decodes directly into the `Float64Array` + `BigInt64Array` shape the buffer expects and transfers both underlying buffers back to the main thread — no intermediate JS-object hops, no copy at the worker boundary.

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

## Resolved design decisions (UI redesign)

Decisions made during the Tailwind + Radix + shadcn migration that shape what's on screen now:

1. **Body selector composition.** Keep all 10 (Sun + 8 planets + Moon). N-body framing is a feature, not a footnote.
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
- Per-chunk bandwidth optimisation — Float32 instead of Float64 for positions/velocities (halves raw size to ~2.4 MB; ~7-decimal-digit precision is fine for visualisation). Goal: <1 MB per chunk compressed.

> Already in place: orbital trails, planet rotation, decoupled render loop (R3F `useFrame` + refs), Sun unlit material, web-worker zstd decompression, custom binary wire format, fully imperative scene graph, frame switching (helio/geo) with honest geocentric trail reprojection, Keplerian elements display, hot-path allocation discipline.

### Architectural cleanup

- Use μ (gravitational parameter) directly throughout the simulation; drop the imprecise `mass = body.getGM() / G` conversion in `CelestialBodyWrapper`. (µ is already exposed via `getMu()`; the broader refactor of acceleration calculations remains.)
- Coalesce overlapping Redux middleware that both intercept `setCurrentTimeStepIndex`.
- Reset frontend state cleanly on sim resubmit (currently the chunk buffer + time state can carry stale values across resubmits).

### Quality plumbing

- OpenAPI generation with shared types between backend and frontend (eliminates DTO drift, which we've already paid for once via Redux-key typos).
- Mobile responsive review — touch interactions for camera, sheet behaviour on narrow viewports.

> Already in place: ESLint + Prettier on CI; test architecture rule documented in `CLAUDE.md` (silent-failure modes, two-sided boundaries); Vitest + JUnit running in both CIs; force model, all three integrators, and binary wire-format round-trip pinned by tests.

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
| Backend framework | Spring Boot 3 (Java 21) | Familiar, batteries-included; HTTP/2 chunk delivery scales naturally and stays cacheable |
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
