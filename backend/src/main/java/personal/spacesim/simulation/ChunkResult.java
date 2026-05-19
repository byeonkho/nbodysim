package personal.spacesim.simulation;

import org.orekit.time.AbsoluteDate;
import personal.spacesim.simulation.body.CelestialBodySnapshot;

import java.util.List;
import java.util.Map;

/**
 * Aggregate return type from {@link Simulation#run()}. Bundles the
 * per-emission state snapshots with the parallel ΔE/E₀ values and the
 * optional DP853 chunk-aggregate telemetry, so the serializer takes
 * one cohesive input rather than three parallel collections.
 *
 * <p>The {@code snapshots} and {@code deltaERelative} maps share keys
 * by construction: every emission writes both. Order is insertion
 * (LinkedHashMap) so the serializer can iterate either map and trust
 * the iteration order matches.
 *
 * @param snapshots        per-emission body state (positions, velocities), keyed by sim date
 * @param deltaERelative   per-emission (E - E₀) / |E₀|, keyed by the same dates
 * @param telemetry        DP853 chunk-aggregate values; null for Euler/RK4 chunks
 */
public record ChunkResult(
        Map<AbsoluteDate, List<CelestialBodySnapshot>> snapshots,
        Map<AbsoluteDate, Double> deltaERelative,
        Dp853Telemetry telemetry
) {}
