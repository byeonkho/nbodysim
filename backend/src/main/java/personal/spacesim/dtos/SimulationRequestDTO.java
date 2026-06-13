package personal.spacesim.dtos;

import java.util.List;

public record SimulationRequestDTO(
        List<String> celestialBodyNames,
        String date,
        String frame,
        String integrator,
        String timeStepUnit,
        // Nullable; null → backend uses the per-integrator landing default
        // from FidelityBucket.defaultFor(integrator). Wire format: one of
        // "low" | "medLow" | "medium" | "medHigh" | "high".
        String fidelityBucket,
        // Nullable; when set, the session the client is replacing. The server
        // releases it on initialize so resubmits don't orphan sessions for the
        // full idle timeout. Null/unknown is a no-op.
        String previousSessionID
) {}
