package personal.spacesim.utils.math.integrators;

import org.springframework.stereotype.Component;

@Component
public class IntegratorFactory {

    public Integrator createIntegrator(String type) {
        return switch (type.toLowerCase()) {
            case "euler" -> new EulerIntegrator();
            // Other integrators will be added in subsequent P0.3 phases:
            //   - "rungekutta" → RK4Integrator (phase 3)
            //   - "dp853"      → DormandPrince853Integrator (phase 4)
            case "rungekutta" -> throw new UnsupportedOperationException(
                "Runge-Kutta integrator is being rebuilt; use 'euler' until phase 3 lands.");
            default -> throw new IllegalArgumentException("Unknown integrator type: " + type);
        };
    }
}
