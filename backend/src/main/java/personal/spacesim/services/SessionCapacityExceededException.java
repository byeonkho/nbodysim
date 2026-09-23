package personal.spacesim.services;

/**
 * Admission or compute capacity is occupied. Controllers return 503 so clients
 * can retry without treating ordinary overload as an internal server failure.
 */
public class SessionCapacityExceededException extends RuntimeException {
    public SessionCapacityExceededException(String message) {
        super(message);
    }
}
