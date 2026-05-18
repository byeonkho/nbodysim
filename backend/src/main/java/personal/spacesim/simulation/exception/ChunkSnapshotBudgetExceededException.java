package personal.spacesim.simulation.exception;

/**
 * Thrown by {@code Simulation.run()} when an adaptive integrator's
 * substep capture would push the chunk's snapshot count past the
 * configured {@code MAX_SNAPSHOTS_PER_CHUNK}.
 *
 * <p>Signals dynamic stiffness exceeds what the current chunk parameters
 * can express within the wire budget — typically a close encounter or a
 * contrived chaotic scenario. The simulation is left in an indeterminate
 * state for the failing chunk; the session-level integrator state is no
 * longer trustworthy and the session should be terminated.
 *
 * <p>Surfaced at the HTTP boundary as a 422 Unprocessable Entity so the
 * client can prompt the user to coarsen {@code dt}, raise
 * {@code keyframesPerKept}, or simplify the body set.
 */
public class ChunkSnapshotBudgetExceededException extends RuntimeException {

    public ChunkSnapshotBudgetExceededException(String message) {
        super(message);
    }
}
