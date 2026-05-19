// Tooltip copy for the integrator-residual UI. Shared between
// TopStatusStrip (ΔE/E₀ cell) and BodyCard's Integrator residual
// section header so the two surfaces don't drift. The DP853-specific
// strings render only on the body card (those rows hide when the
// active integrator is fixed-step).
//
// Tone follows .claude/rules/presentation-layer-copy.md: plain English
// for a mixed-audience portfolio, no jargon names (DP853, RK4, Euler,
// dt, ΔE, etc.) in the body, no em-dashes.

export const RESIDUAL_CONCEPT_COPY = `In real gravity, a planet's total energy stays exactly the same forever. Our simulation does the math one tiny step at a time, and small rounding errors stack up. This number is how far off we've drifted. Closer to zero is better. If it grows, the orbits on screen are slowly bending away from what real physics would do. Try different integrators (in Sim Setup) and watch how much this number changes; that's the trade-off between speed and accuracy made visible.`;

export const AVG_STEP_COPY = `The smart integrator decides for itself how big each step should be. Big leaps when things are easy, small careful ones when planets get close. This is the average leap size for the most recent slice of the simulation. Smaller leaps mean the math is working harder right now.`;

export const ACCEPT_RATE_COPY = `After each step, the simulation double-checks its own work by doing the calculation two ways and comparing. If the two answers don't agree closely enough, it throws the step away and tries again with a smaller one. This is how often the first try passed the check. Usually near 100%. It drops when planets get close and the math gets tricky.`;
