package personal.spacesim.dtos;

/**
 * @param sessionID          the session the chunk belongs to
 * @param expectedChunkIndex the index of the chunk the client wants next
 *                           (= the number of chunks it has already appended).
 *                           The server re-serves the cached last chunk when this
 *                           equals the last-served index (idempotent retry) and
 *                           advances only for the next sequential index.
 */
public record SimulationChunkRequest(String sessionID, int expectedChunkIndex) {}
