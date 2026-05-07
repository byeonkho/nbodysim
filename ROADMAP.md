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

Currently a working local prototype. The simulation runs end-to-end, multiple integrators are wired in, the frontend renders bodies with scaled distances and per-body textures, and time controls (play/pause, speed, scrubbing) function. Several silent bugs and rough edges remain — see "in flight" below.

## In flight

- Silent correctness bugs: chunk-key collision in batched simulation runs, broken Redux selectors, `RungeKuttaIntegrator` not actually using N-body forces.
- Integrator boundary redesign — adopt Orekit's `ThirdBodyAttraction` force models so high-order propagators integrate the real N-body problem rather than receiving a single pre-computed force.

## Planned

### Production hosting

- Backend deployment to **Fly.io** (Dockerfile, `fly.toml`, env-driven config, `/health` endpoint).
- Frontend deployment to **Vercel** with backend URL injected at build time.
- Auth or rate limiting on the public REST surface (currently open compute oracle).
- Tightened CORS — env-driven allowlist, no wildcard.
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

### Quality plumbing

- ESLint + Prettier configuration; enforced on CI.
- OpenAPI generation with shared types between backend and frontend.
- Targeted tests: gravitational force calculation, two-body circular-orbit convergence per integrator, serialize → zstd → deserialize round-trip.
- Mobile responsive review.

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
- Planet textures: TBD — to be audited and credited before public deployment.
- Astrodynamics: [Orekit](https://www.orekit.org/) (CS GROUP / CNES).
