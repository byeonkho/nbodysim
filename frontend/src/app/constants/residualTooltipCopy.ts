// Tooltip copy for the integrator-residual UI. Shared between
// TopStatusStrip (ΔE/E₀ cell) and BodyCard's Integrator residual
// section header so the two surfaces don't drift. DP853-specific
// strings are used only on the body card (those rows hide for
// fixed-step integrators).

export const RESIDUAL_CONCEPT_COPY = `Gravity conserves total energy — a planet trades kinetic ↔ potential, but the sum stays constant. Each integrator step adds tiny rounding errors that drift the total. This is the lie detector: (E − E₀) ÷ |E₀|. Near zero = trustworthy. Visibly nonzero = orbits silently spiralling out (positive) or in (negative). Typical: Euler ~1e-3, RK4 ~1e-7, DP853 ~1e-12.`;

export const AVG_STEP_COPY = `DP853 picks its own step size — large strides on easy stretches, tiny ones near close approaches. This is the average sim-time per accepted step over the chunk. Smaller = integrator working harder.`;

export const ACCEPT_RATE_COPY = `Each step DP853 also runs a cheaper backup estimate and compares. If they disagree it throws the step away and retries with smaller dt. This is the fraction of attempts that passed. ~95%+ on benign sims; drops near close encounters.`;
