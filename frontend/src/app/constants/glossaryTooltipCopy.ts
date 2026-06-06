// Plain-English tooltip copy for the general UI glossary: the labels and
// readouts scattered across the chrome that a non-technical visitor would
// otherwise have to guess at. Tone matches residualTooltipCopy /
// driftTooltipCopy: ELI5 for a mixed-audience portfolio, no algorithm
// names, no math symbols in the body, no em-dashes.

// ── Sim Setup fields ──────────────────────────────────────────────────

export const EPOCH_COPY =
  "The date and time the simulation starts from. Every body is placed where it really was at that moment, using real space-agency data, and the math takes over from there.";

export const REFERENCE_FRAME_COPY =
  "What the math treats as the fixed center while it works out everyone's motion. Sun-centered is the natural choice for the planets. The barycenter is the true balance point of the whole solar system, which the Sun itself wobbles around a little. Earth-centered pins Earth in place. This is the math's anchor; what you see on screen can be changed separately with the frame dial.";

// Full story for the chip beside the Integrator label.
export const INTEGRATOR_COPY =
  "The math engine that works out where each body goes next, one tiny step at a time. The choices trade speed for accuracy. The first is fast but lets small errors pile up, so its orbits slowly drift. The last double-checks its own work after every step and stays closest to real physics, at the cost of more computation. Switching this and watching the drift numbers is the whole demo.";

// Short inline hint shown under the Integrator field (replaces the old
// jargon-named help string).
export const INTEGRATOR_HELP =
  "The math engine that moves the bodies forward. The choices run from fast-but-drifts to slower-but-stays-accurate.";

export const TIME_STEP_COPY =
  "How big a jump the math engine takes each step. Smaller jumps follow the curves more faithfully but take more of them to cover the same stretch of time. This sets that jump size.";

export const PLAYBACK_QUALITY_COPY =
  "How many snapshots of the motion the server sends. Fewer snapshots download faster and the gaps are filled in smoothly for you. More snapshots capture every wiggle but weigh more. It does not change the physics, only how finely the motion is sampled for playback.";

// ── Top status strip ──────────────────────────────────────────────────

export const UTC_COPY =
  "The simulation's own clock, shown in the worldwide standard time zone so it does not depend on where you happen to be.";

export const JD_COPY =
  "A way astronomers count time as one long, ever-increasing day number instead of resetting it every month and year. It makes measuring long spans between dates simple. This is the same instant as the clock to its left, just written that way.";

export const BUFFER_COPY =
  "How many future moments are already downloaded and waiting, so playback stays smooth. It fills up ahead of you and ticks down as you watch or scrub forward.";

export const FPS_COPY =
  "How many times per second the picture is redrawn. Higher means smoother motion. It reflects your device, not the simulation.";

// ── Timeline ──────────────────────────────────────────────────────────

export const TIMELINE_STEPS_COPY =
  "The whole stretch of time the simulation has worked out, divided into evenly spaced moments you can jump between. Click or drag anywhere on the bar to leap to that moment.";

export const TPLUS_COPY =
  "How much time has passed inside the simulation since its start, counted in days. The start itself is a fixed reference moment astronomers use, at the very beginning of the year 2000.";

// ── Body card sections ────────────────────────────────────────────────

export const STATE_VECTOR_COPY =
  "The raw here-and-now: exactly where this body is and how fast it is moving at this instant, measured against the body it orbits. Position and speed are broken out as plain numbers along each direction.";

export const KEPLERIAN_COPY =
  "The shape and tilt of this body's orbit, boiled down to a few numbers: how stretched the loop is, how big it is, how tilted, where the body currently sits along it, and how long one lap takes. If no other body's gravity ever nudged it, these would never change.";

// ── Frame compass (scene widget) ──────────────────────────────────────

export const FRAME_COMPASS_COPY =
  "Pick what sits still at the center of the view. Sun-centered shows the planets sweeping their orbits around the Sun. Earth-centered pins Earth in place, so you watch everything as if from home, including the strange backward loop Mars appears to make. Click to switch.";

// ── Event log ─────────────────────────────────────────────────────────

export const EVENT_LOG_COPY =
  "A running list of notable moments. The filters let you show everything, just the things the simulation itself reports, or just the actions you have taken.";

// ── View toggles (timeline) ───────────────────────────────────────────

export const GRID_COPY =
  "A flat reference grid through the middle of the scene, to give the empty space a sense of scale and orientation.";

export const LABELS_COPY =
  "Floating name tags above each body, with its current distance, so you can tell what you are looking at without clicking.";

export const AXES_COPY =
  "Three colored reference lines through the center marking the main directions, to help you stay oriented as the camera moves.";

export const SCALE_COPY =
  "Switches between true-to-life proportions, where the planets are realistically tiny and far apart, and a stylized view that squeezes the distances and enlarges the bodies so the whole system fits on screen with every planet clearly visible.";
