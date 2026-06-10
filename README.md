# nbodysim

> Real-time N-body simulation of the solar system, computed from real astronomy data and played back in 3D in your browser.

**Live demo: [nbodysim.com](https://nbodysim.com)**

<!-- TODO: add a hero GIF of the orbiting scene + trails above this line -->

Pick the bodies, a reference frame, an integrator, and a time step. The backend computes trajectories from JPL initial conditions using a pluggable, hand-written N-body integrator; the frontend tape-plays them in 3D at adjustable speed. Trajectories arrive as zstd-compressed binary chunks over HTTP/2, decoded in a Web Worker, so you can scrub, pause, and rewind without the simulation needing to keep up with the camera.

## What's interesting here

- **A hand-written N-body integrator, not a black box.** Euler, RK4, and adaptive Dormand–Prince 853 propagate every body together as one 6N-dimensional state vector with mutual gravitation. A live `ΔE/E₀` energy readout ticks visibly past `1e-2` on Euler at a daily step, then sits at machine precision on DP853.
- **A custom binary wire format.** Positions ship as float32 per-step deltas off a float64 reference, byte-plane-shuffled so zstd compresses the stable high-order bytes hard, and reconstructed by prefix-sum on the client. The Web Worker decodes straight into the typed-array layout Redux holds, so the hand-off is zero-copy.
- **A reality-drift overlay.** The integrator's predicted position is drawn next to the *true* position from JPL's DE-440 ephemeris at the same date, with an "off by" readout. Euler visibly diverges; RK4 stays glued. It turns the accuracy trade-off into something you can see.

## Run locally

You'll need:

- **Java 21** ([Temurin](https://adoptium.net/) recommended)
- **Node.js 22+** and npm

### Backend

```bash
cd backend && ./mvnw spring-boot:run
```

> First time only, if you get "permission denied": `chmod +x backend/mvnw` (from the repo root), then retry.

Serves on `http://localhost:8080`:

- `POST /api/simulation/initialize` — build a session, returns a sessionID
- `POST /api/simulation/chunk` — body `{sessionID}`, returns the next computed chunk as a zstd-compressed binary stream

### Frontend

In a second terminal:

```bash
cd frontend
npm install   # first run only
npm run dev
```

Open the local URL the dev server prints. The frontend defaults to a backend at `http://localhost:8080`; override with `NEXT_PUBLIC_BACKEND_URL` (origin only, e.g. `https://api.nbodysim.com`).

### Using it

1. Click **Sim setup** in the top bar (or the Configuration chip beside it) to open the setup drawer.
2. Pick celestial bodies from the catalog (Sun, 8 planets, 22 moons, and named dwarf planets and near-Earth asteroids), a date, an integrator (Euler / RK4 / Dormand–Prince 853), and a time-step unit.
3. Hit **Run simulation**. The 3D scene populates.
4. Use the bottom controls to play/pause and adjust speed (negative speeds rewind).
5. Click any body to track it with the camera. Click the background to release.
6. The bottom view-toggles: grid, trails, orbits, the scale preset (**Real** ↔ **Stylized**), per-body labels, and the reality-drift overlay.

## How it works

```
┌──────────────────┐                                  ┌──────────────────────┐
│  Next.js + R3F   │  ◄── zstd-compressed binary ─────┤  Spring Boot + Orekit │
│  Redux + thunk   │  ──► POST /chunk {sessionID} ───►│  Chunk endpoint       │
│  3D scene        │                                  │  Sim session store    │
│                  │                                  │  N-body integrator    │
└──────────────────┘                                  └──────────────────────┘
```

- **Initial conditions** come from JPL ephemerides via Orekit. Pick a date and bodies; their starting positions and velocities are exact. Bodies outside Orekit's bundled data (dwarf planets, named asteroids, the major moons) are sourced from JPL Horizons at submit time and cached.
- **N-body integration** advances all bodies together as a single 6N-dimensional state vector. Pluggable integrators (Euler, RK4, adaptive Dormand–Prince) trade accuracy for cost.
- **Wire format** is a custom little-endian binary layout: body names + µ in a one-time header, a single `(startMillis, gapMillis)` timestamp pair (emissions are uniformly spaced), a per-body float64 position reference, then per-step float32 position and velocity deltas. Both float32 planes are byte-plane-shuffled so zstd compresses their stable high-order bytes; the whole body is zstd-compressed. The client un-shuffles and prefix-sums back to absolute positions in a Web Worker, decoding directly into the typed-array buffer the main thread reads — no copy at the worker boundary.
- **Transport** is plain HTTP/2: `POST /api/simulation/chunk` per chunk. No persistent connection; chunks are independently retryable and cacheable per session.
- **Frontend** buffers the chunks in a flat typed array and tape-plays them via R3F's `useFrame`, interpolating between keyframes with cubic Hermite splines (using the integrator's exact velocities). When the buffer dips below a speed-aware threshold the next chunk is prefetched; old chunks are evicted at a byte-budgeted cap.
- **Two scale presets** — **Real** uses true positions and radii (planets are tiny dots at solar-system distance, the honest reference); **Stylized** compresses radial distance with a log curve and enlarges bodies with a power law so the whole system fits one view, with a minimum-separation rule that keeps any moon visible next to its parent.

For a deeper architectural discussion, planned work, and known tradeoffs, see **[ARCHITECTURE.md](ARCHITECTURE.md)**.

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Spring Boot 3.5, Java 21 |
| Astrodynamics | [Orekit](https://www.orekit.org/) 12 + [Hipparchus](https://hipparchus.org/) (JPL ephemerides, ICRF/GCRF reference frames) |
| Wire format | Custom binary over HTTP/2, zstd-compressed |
| Frontend | Next.js 16, React 19, [React Three Fiber](https://docs.pmnd.rs/react-three-fiber), Redux Toolkit, Tailwind v4, Radix |
| Hosting | Railway (backend) + Cloudflare Pages (frontend), behind Cloudflare |

## Status

Active development; first hosted deployment in progress. The simulation runs end-to-end: three integrators, real JPL initial conditions, orbital trails, geocentric/heliocentric frame switching, Keplerian-element readouts, and the integrator-residual and reality-drift overlays. Planned work, known tradeoffs, and tech-choice rationale are tracked in [ARCHITECTURE.md](ARCHITECTURE.md).

## Credits

- Earth icon: [Global icons](https://www.flaticon.com/free-icons/global) by Freepik — Flaticon
- Planet textures: [Solar System Scope](https://www.solarsystemscope.com/textures/) — used under [CC Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)
- Astrodynamics: [Orekit](https://www.orekit.org/) by CS GROUP / CNES, built on [Hipparchus](https://hipparchus.org/)
