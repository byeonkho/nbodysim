package personal.spacesim.dtos;

import personal.spacesim.simulation.body.CelestialBodyWrapper;

import java.util.List;

public record SimulationResponseDTO(
        List<CelestialBodyWrapper> celestialBodyPropertiesList,
        SimulationResponseMetadata simulationMetaData
) {}
