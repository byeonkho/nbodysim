package personal.spacesim.services;

/**
 * Thrown when a chunk request's expected index is neither the next sequential
 * chunk nor the last-served chunk (the single re-servable step). The client and
 * server cursors have diverged by more than one step, so producing would
 * silently corrupt the client's timeline. The controller maps this to
 * {@code 409 Conflict}.
 */
public class ChunkIndexConflictException extends RuntimeException {
    public ChunkIndexConflictException(int expected, int served) {
        super("Chunk index conflict: expected " + expected
                + " but server last served " + served);
    }
}
