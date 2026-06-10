package personal.spacesim.services;

/**
 * Thrown by {@link SimulationSessionService#createSimulation} when the number
 * of live in-memory sessions is at capacity. The controller maps this to
 * {@code 503 Service Unavailable}: the request is well-formed, the server is
 * simply full. Bounds total heap on a small VM, complementing the idle sweeper
 * (which only reclaims sessions after the idle timeout).
 */
public class SessionCapacityExceededException extends RuntimeException {
    public SessionCapacityExceededException(String message) {
        super(message);
    }
}
