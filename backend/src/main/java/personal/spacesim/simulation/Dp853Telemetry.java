package personal.spacesim.simulation;

/**
 * Per-chunk telemetry for the DP853 adaptive integrator. Populated only
 * when the integrator was DP853; null otherwise.
 *
 * @param avgStepSeconds mean accepted-step duration over the chunk, in sim seconds
 * @param acceptRate     fraction of attempted steps that were accepted, in [0, 1]
 */
public record Dp853Telemetry(double avgStepSeconds, double acceptRate) {}
