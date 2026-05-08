# spacesim — roadmap

A solar-system n-body simulator with a Java/Spring Boot backend (Orekit, JPL ephemerides, Zstd compression) and a Next.js + React Three Fiber frontend, communicating over HTTP/2. This roadmap tracks the project's evolution from local prototype to hosted portfolio piece.

## Vision

End-to-end hosted simulation. A user picks bodies, frame, integrator, and time scale; the backend computes trajectories using real astrodynamics (JPL ephemerides via Orekit); the browser plays them back smoothly with trails, scaled views, and per-body inspection. Compute is server-side and streamed; the frontend is a thin, performant viewport.

## Architecture

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

**Backend** — Spring Boot 3 + Orekit 12. `POST /api/simulation/initialize` builds a session with bodies, frame, integrator, and start date; subsequent `POST /api/simulation/chunk` calls run simulation chunks of N steps and return results as zstd-compressed binary. Sessions are tracked by sessionID and evicted by a periodic idle-timeout sweeper.

**Frontend** — Next.js + React Three Fiber. Redux Toolkit holds the buffered timestep map; an async thunk fetches the next chunk when the buffer dips below threshold and discards old chunks at a configured cap. The render loop tape-plays the buffer at a target frame rate via R3F's `useFrame`; the scene supports two scale presets (semi-realistic, realistic) and per-body exception scaling for tightly-coupled pairs (e.g., Earth–Moon).

**Wire format** — custom little-endian binary layout: body names in a one-time header, then per-timestep `int64` timestamp + 6 `float64` per body (position + velocity). Zstd-compressed with a 4-byte little-endian uncompressed-size prefix. Decoded client-side in a Web Worker so the main thread stays unblocked during chunk arrivals.

## Status

Currently a working local prototype. The simulation runs end-to-end, three integrators (Euler / RK4 / Dormand–Prince 853) are wired in, the frontend renders bodies with scaled distances and per-body textures, and time controls (play/pause, speed, scrubbing) function. Focus has shifted from correctness/perf hardening to the demo layer (reality-drift overlay) and pre-deploy polish — see "in flight" below.

## In flight

- **Reality drift overlay** — render the integrator's predicted position alongside the actual JPL ephemeris position for the same body at the same date. Switching integrators mid-sim makes the accumulated numerical error visible: Euler diverges within days, RK4 stays close, DP853 essentially glued.
- Pre-deploy polish: UX flow walkthrough, mobile responsive review.
- Deploy: Cloudflare proxy in front of Fly.io for DDoS protection, Sentry for error tracking + uptime.

## Planned

### Production hosting

- Cloudflare proxy in front of Fly.io for DDoS protection and bot detection (defends against IP-rotation attacks that per-IP rate limiting alone can't stop).
- Sentry SDKs (backend + frontend) for error tracking and uptime monitoring (uptime checks on health + frontend URLs).
- Live demo link + hero screenshot/GIF in README once deployed.

> Already in place: Fly.io backend (Dockerfile + `fly.toml` + `/actuator/health`), Vercel frontend, env-driven CORS allowlist, per-IP + global rate limiting (Bucket4j), GitHub Actions CI for both stacks.

### Frontend showcase

- **Reality drift overlay** vs JPL ephemerides — visualise integrator error live (see "In flight").
- **Interesting-moment timeline markers** — backend scans each computed chunk for events (closest approaches, conjunctions, syzygies, eclipses) and surfaces them as clickable markers on the scrubber.
- Catmull-Rom client-side interpolation between keyframes — backend sends every Nth keyframe; client interpolates with `THREE.CatmullRomCurve3`. Cuts payload + smooths playback.
- Per-chunk bandwidth optimisation — Float32 instead of Float64 for positions/velocities (halves raw size to ~2.4 MB; ~7-decimal-digit precision is fine for visualisation). Goal: <1 MB per chunk compressed.

> Already in place: orbital trails, planet rotation, decoupled render loop (R3F `useFrame` + refs), Sun unlit material, FPS counter, web-worker zstd decompression, custom binary wire format (replaces the originally-planned delta-encoded JSON), and a fully imperative scene graph that no longer re-renders on simulation tick.

### Architectural cleanup

- Use μ (gravitational parameter) directly throughout the simulation; drop the imprecise `mass = body.getGM() / G` conversion in `CelestialBodyWrapper`.
- Coalesce overlapping Redux middleware that both intercept `setCurrentTimeStepIndex`.

> Already in place: Sun-relative rendering shifted backend-side in the snapshot pipeline (no more name-equality "Sun is fixed" check); Spring Data JPA dependency removed; size-logging serializer dropped alongside the WS→HTTP migration; chunk delivery migrated from WebSocket to HTTP/2; DTOs converted to records; sealed `Integrator` hierarchy; virtual threads enabled.

### Quality plumbing

- OpenAPI generation with shared types between backend and frontend (eliminates DTO drift, which we've already paid for once via Redux-key typos).
- Mobile responsive review — touch interactions for camera, drawer behaviour on narrow viewports.

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

## Credits

- Earth icon: [Global icons](https://www.flaticon.com/free-icons/global) by Freepik – Flaticon.
- Planet textures: [Solar System Scope](https://www.solarsystemscope.com/textures/) — used under [CC Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
- Astrodynamics: [Orekit](https://www.orekit.org/) (CS GROUP / CNES).
