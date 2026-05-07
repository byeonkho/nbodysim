# spacesim — roadmap

A solar-system n-body simulator with a Java/Spring Boot backend (Orekit, JPL ephemerides, Zstd compression) and a Next.js + React Three Fiber frontend, communicating over WebSockets. This roadmap tracks the project's evolution from local prototype to hosted portfolio piece.

## Vision

End-to-end hosted simulation. A user picks bodies, frame, integrator, and time scale; the backend computes trajectories using real astrodynamics (JPL ephemerides via Orekit); the browser plays them back smoothly with trails, scaled views, and per-body inspection. Compute is server-side and streamed; the frontend is a thin, performant viewport.

## Architecture

```
┌──────────────────┐                              ┌─────────────────────┐
│  Next.js + R3F   │  ◄── zstd-compressed JSON ──┤  Spring Boot + Orekit│
│  Redux + WS      │  ──► sessionID + commands ──►│  WebSocket handler   │
│  React Three     │                              │  Sim session store   │
│  Fiber scene     │                              │  Pluggable integrator│
└──────────────────┘                              └─────────────────────┘
        │                                                   │
   Vercel (planned)                                  Fly.io (planned)
```

**Backend** — Spring Boot 3 + Orekit 12. REST `/api/simulation/initialize` builds a session with bodies, frame, integrator, and start date; subsequent WebSocket calls run simulation chunks of N steps and stream results back as zstd-compressed JSON. The integrator boundary will be redesigned to delegate force-model evaluation to Orekit's `NumericalPropagator` so high-order propagators (Dormand–Prince) work correctly.

**Frontend** — Next.js + React Three Fiber. Redux Toolkit holds the buffered timestep map; middleware prefetches the next chunk when the buffer dips below threshold and discards old chunks at a configured cap. The render loop tape-plays the buffer at a target frame rate; the scene supports two scale presets (semi-realistic, realistic) and per-body exception scaling for tightly-coupled pairs (e.g., Earth–Moon).

**Wire format** — JSON over WebSocket, zstd-compressed with a 4-byte little-endian uncompressed-size prefix. Decoded client-side via WASM. Delta-encoding planned to further shrink payloads.

## Status

Currently a working local prototype. The simulation runs end-to-end, multiple integrators are wired in, the frontend renders bodies with scaled distances and per-body textures, and time controls (play/pause, speed, scrubbing) function. Several silent bugs and rough edges remain — see "in flight" below.

## In flight

- Silent correctness bugs: chunk-key collision in batched simulation runs, broken Redux selectors, `RungeKuttaIntegrator` not actually using N-body forces.
- Integrator boundary redesign — adopt Orekit's `ThirdBodyAttraction` force models so high-order propagators integrate the real N-body problem rather than receiving a single pre-computed force.

## Planned

### Production hosting

- Backend deployment to **Fly.io** (Dockerfile, `fly.toml`, env-driven config, `/health` endpoint).
- Frontend deployment to **Vercel** with backend URL injected at build time.
- Auth or rate limiting on the public REST/WebSocket surface (currently open compute oracle).
- Tightened CORS — env-driven allowlist, no wildcard.
- Bound WebSocket session lifecycle (sim cleaned up on disconnect).
- Graceful WebSocket reconnect on transient drops.
- README with screenshots, architecture diagram, and live demo link.
- GitHub Actions CI: build, lint, type-check, run tests on PR.

### Frontend showcase

- Orbital trails rendered from the buffered timestep map.
- Planet rotation.
- Render loop decoupled from React rerenders (R3F `useFrame` + refs; commit to Redux only at chunk boundaries).
- Catmull-Rom client-side interpolation between keyframes.
- Delta-encoded wire format.
- Web worker for zstd decompression to keep the main thread idle.
- Sun rendered with non-self-illuminating material; correct light source separation.
- Visible frame-rate counter.

### Architectural cleanup

- "Sun is fixed" represented as a body property, not a name-equality check.
- Use μ (gravitational parameter) directly throughout the simulation; drop the imprecise mass conversion.
- Coalesce overlapping Redux middleware that both react to the same action.
- Remove unused Spring Data JPA dependency.
- Drop or fold in the size-logging serializer that doubles serialization work.
- Encapsulate the module-level WebSocket reference in middleware closure.

### Quality plumbing

- ESLint + Prettier configuration; enforced on CI.
- OpenAPI generation with shared types between backend and frontend.
- Targeted tests: gravitational force calculation, two-body circular-orbit convergence per integrator, serialize → zstd → deserialize round-trip.
- Mobile responsive review.

## Known tradeoffs

- **Backend is stateful** — simulation sessions live in JVM memory. Single-instance deployment only; server restart resets all in-flight sessions. This is intentional. The project's portfolio angle is end-to-end systems plus frontend performance, not horizontal scaling. If multi-instance ever matters, the in-memory `ConcurrentHashMap` becomes a Redis-backed store.
- **Compute is server-side** in Java rather than browser-side WASM. This trades client autonomy for accuracy and access to Orekit's astrodynamics tooling (JPL ephemerides, real reference frames, validated integrators).
- **Wire format is JSON** before compression rather than a binary protocol like MessagePack or protobuf. Delta-encoded JSON + zstd compresses competitively for the trajectory data shape; keeping JSON keeps the system debuggable.

## Tech choices

| Layer | Choice | Why |
|---|---|---|
| Backend framework | Spring Boot 3 (Java 21) | Familiar, batteries-included, great WebSocket support |
| Astrodynamics | Orekit 12 | JPL ephemerides, ICRF/GCRF reference frames, validated propagators — avoids reinventing physics |
| Wire compression | Zstd | Excellent ratio on repetitive numeric JSON; small WASM decoder client-side |
| Frontend framework | Next.js 14 (CSR) | Project is interactive; SSR not relevant here |
| 3D rendering | React Three Fiber | Three.js wrapped in React's declarative model |
| State | Redux Toolkit | Middleware-driven pipeline maps cleanly to "fetch → decode → buffer → tick" |

## Credits

- Earth icon: [Global icons](https://www.flaticon.com/free-icons/global) by Freepik – Flaticon.
- Planet textures: TBD — to be audited and credited before public deployment.
- Astrodynamics: [Orekit](https://www.orekit.org/) (CS GROUP / CNES).
