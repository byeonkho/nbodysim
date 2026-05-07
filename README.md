# spacesim

> Real-time N-body simulation of the solar system.

Pick bodies, reference frame, integrator, and time step. The backend computes trajectories from JPL initial conditions using a pluggable N-body integrator; the frontend tape-plays them in 3D at adjustable speed. Trajectories arrive as zstd-compressed binary chunks over HTTP/2, decoded in a Web Worker, so you can scrub, pause, and rewind without the simulation needing to keep up with the camera.

**Live demo:** _coming soon — see [ROADMAP.md](ROADMAP.md)._

---

## Run locally

You'll need:

- **Java 21** ([Temurin](https://adoptium.net/) recommended)
- **Node.js 22+** and npm

### Backend

```bash
cd backend && ./mvnw spring-boot:run
```

> First time only, if you get "permission denied": `chmod +x backend/mvnw` (run from repo root), then retry.

The backend serves on `http://localhost:8080`:

- `POST /api/simulation/initialize` — build a session, returns a sessionID
- `POST /api/simulation/chunk` — body `{sessionID}`, returns the next computed chunk as a zstd-compressed binary stream

### Frontend

In a second terminal:

```bash
cd frontend
npm install   # first run only
npm run dev
```

Open <http://localhost:3000>. The frontend defaults to a backend at `http://localhost:8080`; override with `NEXT_PUBLIC_BACKEND_URL` (origin only, e.g. `http://localhost:3001` or `https://api.example.com`).

### Using it

1. Open the **Sim Params** drawer (left edge → cog icon).
2. Pick celestial bodies (Sun, Earth, Moon, etc — "Select All" works), a date, an integrator (Euler / RK4 / Dormand–Prince 853), and a time-step unit.
3. Hit **Submit**. The 3D scene populates.
4. Use the bottom controls to play/pause and adjust speed (negative speeds rewind).
5. Click any body to track it with the camera. Click the background to release.
6. Bottom-right buttons: toggle grid, axes, scale preset (Semi-Realistic ↔ Realistic), and per-body labels.

---

## How it works

```
┌──────────────────┐                                  ┌──────────────────────┐
│  Next.js + R3F   │  ◄── zstd-compressed binary ─────┤  Spring Boot + Orekit │
│  Redux + thunk   │  ──► POST /chunk {sessionID} ───►│  Chunk endpoint       │
│  3D scene        │                                  │  Sim session store    │
│                  │                                  │  N-body integrator    │
└──────────────────┘                                  └──────────────────────┘
```

- **Initial conditions** come from JPL ephemerides via Orekit. Pick a date and bodies; their starting positions and velocities are exact.
- **N-body integration** advances all bodies together as a single 6N-dimensional state vector. Pluggable integrators (Euler, RK4, adaptive Dormand–Prince) trade accuracy for cost.
- **Wire format** is a custom little-endian binary layout (body names in a one-time header, then per-timestep `int64` timestamp + 6 `float64` per body), zstd-compressed with a 4-byte uncompressed-size prefix. Decoded client-side in a Web Worker so the main thread stays free.
- **Transport** is plain HTTP/2 — `POST /api/simulation/chunk` per chunk. No persistent connection; chunks are independently retryable and (in future) cacheable per session for multi-viewer scenarios.
- **Frontend** buffers the timestep map and tape-plays it at 60fps via R3F's `useFrame`. When the buffer dips below threshold, the next chunk is prefetched; old chunks are evicted at a cap.
- **Two scale presets** — Realistic uses true positions and radii (planets are tiny dots at solar-system distance); Semi-Realistic compresses the system for a more compact view, with per-body exception scaling for tightly-coupled pairs (e.g. Earth–Moon).

For a deeper architectural discussion, planned work, and known tradeoffs, see **[ROADMAP.md](ROADMAP.md)**.

---

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Spring Boot 3.5, Java 21 |
| Astrodynamics | [Orekit](https://www.orekit.org/) 12 + [Hipparchus](https://hipparchus.org/) (JPL ephemerides, ICRF/GCRF reference frames) |
| Wire format | Custom binary over HTTP/2, zstd-compressed |
| Frontend | Next.js 14, React 18, [React Three Fiber](https://docs.pmnd.rs/react-three-fiber), Redux Toolkit, MUI |

---

## Status

Active development. The simulation runs end-to-end; current focus is hardening the integrator architecture and preparing for hosted deployment. Planned work, known tradeoffs, and tech-choice rationale are tracked in [ROADMAP.md](ROADMAP.md).

---

## Credits

- Earth icon: [Global icons](https://www.flaticon.com/free-icons/global) by Freepik — Flaticon
- Planet textures: [Solar System Scope](https://www.solarsystemscope.com/textures/) — used under [CC Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)
- Astrodynamics: [Orekit](https://www.orekit.org/) by CS GROUP / CNES, built on [Hipparchus](https://hipparchus.org/)
