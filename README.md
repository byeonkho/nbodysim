# spacesim

> Real-time N-body simulation of the solar system.

Pick bodies, reference frame, integrator, and time step. The backend computes trajectories from JPL initial conditions using a pluggable N-body integrator; the frontend tape-plays them in 3D at adjustable speed. Trajectories stream over a compressed WebSocket so you can scrub, pause, and rewind without the simulation needing to keep up with the camera.

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
- `WS /ws` — run the simulation and stream timesteps

### Frontend

In a second terminal:

```bash
cd frontend
npm install   # first run only
npm run dev
```

Open <http://localhost:3000>. The frontend defaults to talking to `http://localhost:8080/api/simulation`; override with `NEXT_PUBLIC_BACKEND_URL` if needed.

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
┌──────────────────┐                              ┌──────────────────────┐
│  Next.js + R3F   │  ◄── zstd-compressed JSON ──┤  Spring Boot + Orekit │
│  Redux + WS      │  ──► sessionID + commands ──►│  WebSocket handler    │
│  3D scene        │                              │  Sim session store    │
│                  │                              │  N-body integrator    │
└──────────────────┘                              └──────────────────────┘
```

- **Initial conditions** come from JPL ephemerides via Orekit. Pick a date and bodies; their starting positions and velocities are exact.
- **N-body integration** advances all bodies together as a single 6N-dimensional state vector. Pluggable integrators (Euler, RK4, adaptive Dormand–Prince) trade accuracy for cost.
- **Wire format** is JSON keyed by timestep, zstd-compressed with a 4-byte little-endian uncompressed-size prefix; decoded client-side via WASM.
- **Frontend** buffers the timestep map and tape-plays it at 60fps via `requestAnimationFrame`. When the buffer dips below threshold, middleware prefetches the next 10k-step chunk; old chunks are evicted at a cap.
- **Two scale presets** — Realistic uses true positions and radii (planets are tiny dots at solar-system distance); Semi-Realistic compresses the system for a more compact view, with per-body exception scaling for tightly-coupled pairs (e.g. Earth–Moon).

For a deeper architectural discussion, planned work, and known tradeoffs, see **[ROADMAP.md](ROADMAP.md)**.

---

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Spring Boot 3.5, Java 21 |
| Astrodynamics | [Orekit](https://www.orekit.org/) 12 + [Hipparchus](https://hipparchus.org/) (JPL ephemerides, ICRF/GCRF reference frames) |
| Wire format | Zstd-compressed JSON over WebSocket |
| Frontend | Next.js 14, React 18, [React Three Fiber](https://docs.pmnd.rs/react-three-fiber), Redux Toolkit, MUI |

---

## Status

Active development. The simulation runs end-to-end; current focus is hardening the integrator architecture and preparing for hosted deployment. Planned work, known tradeoffs, and tech-choice rationale are tracked in [ROADMAP.md](ROADMAP.md).

---

## Credits

- Earth icon: [Global icons](https://www.flaticon.com/free-icons/global) by Freepik — Flaticon
- Planet textures: pending attribution audit before public deploy
- Astrodynamics: [Orekit](https://www.orekit.org/) by CS GROUP / CNES, built on [Hipparchus](https://hipparchus.org/)
