package personal.spacesim.dtos;

import java.util.List;

public record SimulationRequestDTO(
        List<String> celestialBodyNames,
        String date,
        String frame,
        String integrator,
        String timeStepUnit
) {}
