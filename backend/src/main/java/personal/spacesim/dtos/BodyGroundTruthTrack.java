package personal.spacesim.dtos;

import java.util.List;

/**
 * The full sparse true-position track for a single body over the requested
 * window. {@code name} matches the wire body name (upper-case) so the client
 * can key it to the predicted body.
 */
public record BodyGroundTruthTrack(
        String name,
        List<GroundTruthAnchor> anchors
) {}
