package personal.spacesim.dtos;

import jakarta.annotation.Nullable;
import lombok.Data;
import org.orekit.time.AbsoluteDate;
import personal.spacesim.simulation.body.CelestialBodySnapshot;

import java.util.List;
import java.util.Map;

@Data
public class SimulationChunkResponse {

    private String messageType;
    @Nullable
    private Map<AbsoluteDate, List<CelestialBodySnapshot>> data;
}
