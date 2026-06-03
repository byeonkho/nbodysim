package personal.spacesim.dtos;

import java.util.List;

/**
 * Response for {@code GET /api/simulation/ground-truth}. Contains one track
 * per supported body (planets + Pluto) in the session; moons and
 * Horizons-sourced minor bodies are omitted (no local DE-440 truth in v1).
 */
public record GroundTruthResponse(
        List<BodyGroundTruthTrack> tracks
) {}
