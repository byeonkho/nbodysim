package personal.spacesim.services;

/**
 * Thrown by {@link SimulationSessionService#getNextChunkBytes} when a chunk is
 * requested for a session that is not (or no longer) live: evicted after the
 * idle timeout, released on resubmit, or never existed. The controller maps this
 * to {@code 410 Gone} so the client can distinguish a dead session (stop
 * requesting, prompt a fresh run) from a transient 5xx (retry).
 */
public class SessionNotFoundException extends RuntimeException {
    public SessionNotFoundException(String message) {
        super(message);
    }
}
