package personal.spacesim.constants;

/**
 * The five user-facing fidelity buckets surfaced as "Playback quality" in
 * the UI. Each bucket carries both:
 * <ul>
 *   <li>{@code keyframesPerKept} (K) — used by fixed-step integrators
 *       (Euler, RK4) to thin the external-step grid.</li>
 *   <li>{@code targetSnapshotsPerChunk} (N) — used by DP853 (Mode C
 *       time-gap thinning) as the target snapshot count per chunk.</li>
 * </ul>
 *
 * <p>Resolution is intentionally per-bucket-per-integrator: the user
 * picks one bucket, the backend looks up the right value based on the
 * integrator the session is configured with. Wire format uses the
 * {@code wireName} (camelCase, matches the frontend preset keys) rather
 * than the enum constant name so the contract reads cleanly in request
 * bodies.
 *
 * <p>K and N values are sized so the highest bucket lands within the
 * per-tier compressed wire-size ceilings — roughly 3 MB for the
 * fixed-step default tier and 4.5 MB for the DP853 opt-in tier under
 * the mixed-precision wire format (float64 positions, float32
 * velocities). The fixed-step column maps onto the existing K thinning;
 * the DP853 column maps onto Mode C target-snapshots-per-chunk.
 */
public enum FidelityBucket {

    LOW    ("low",     20,  3000),
    MED_LOW("medLow",  10,  5000),
    MEDIUM ("medium",   5,  7500),
    MED_HIGH("medHigh", 2, 10000),
    HIGH   ("high",     1, 15000);

    private final String wireName;
    private final int keyframesPerKept;
    private final int targetSnapshotsPerChunk;

    FidelityBucket(String wireName, int keyframesPerKept, int targetSnapshotsPerChunk) {
        this.wireName = wireName;
        this.keyframesPerKept = keyframesPerKept;
        this.targetSnapshotsPerChunk = targetSnapshotsPerChunk;
    }

    public String wireName() {
        return wireName;
    }

    public int keyframesPerKept() {
        return keyframesPerKept;
    }

    public int targetSnapshotsPerChunk() {
        return targetSnapshotsPerChunk;
    }

    /**
     * Resolves a wire-format bucket string (e.g. {@code "medLow"}) to the
     * corresponding enum constant.
     *
     * @throws IllegalArgumentException if the input is null or doesn't
     *         match any bucket. Callers (controller) translate this to
     *         HTTP 400.
     */
    public static FidelityBucket fromWireName(String wire) {
        if (wire == null) {
            throw new IllegalArgumentException("fidelityBucket cannot be null");
        }
        for (FidelityBucket b : values()) {
            if (b.wireName.equals(wire)) return b;
        }
        throw new IllegalArgumentException(
                "Unknown fidelityBucket: '" + wire + "'. Expected one of: "
                        + "low, medLow, medium, medHigh, high");
    }

    /**
     * Per-integrator landing default — the bucket the SimSetupDrawer
     * surfaces when the user first opens the form with this integrator
     * selected (or after switching integrators mid-config).
     *
     * <p>Picks differ because the user-visible cost differs per integrator:
     * <ul>
     *   <li>Euler → bucket 4 (K=2). Crude integrator, leaning denser keeps
     *       trails reasonable.</li>
     *   <li>RK4 → bucket 3 (K=5). Balanced; default cost ~0.8 MB
     *       compressed.</li>
     *   <li>DP853 → bucket 2 (N=5000). Same ~2 MB compressed ceiling as
     *       the fixed-step defaults; reward for opting deeper into DP853
     *       is moving up the slider.</li>
     * </ul>
     */
    public static FidelityBucket defaultFor(String integrator) {
        if (integrator == null) {
            throw new IllegalArgumentException("integrator cannot be null");
        }
        return switch (integrator.toLowerCase()) {
            case "euler" -> MED_HIGH;
            case "rk4"   -> MEDIUM;
            case "dp853" -> MED_LOW;
            default -> throw new IllegalArgumentException(
                    "Unknown integrator: '" + integrator + "'");
        };
    }
}
