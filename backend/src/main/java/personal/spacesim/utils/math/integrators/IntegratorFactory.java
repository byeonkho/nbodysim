package personal.spacesim.utils.math.integrators;

import org.springframework.stereotype.Component;

@Component
public class IntegratorFactory {

    public Integrator createIntegrator(String type) {
        return switch (type.toLowerCase()) {
            case "euler" -> new EulerIntegrator();
            case "rk4", "rungekutta" -> new RK4Integrator();
            case "dp853", "dormandprince" -> new DP853Integrator();
            default -> throw new IllegalArgumentException("Unknown integrator type: " + type);
        };
    }
}
