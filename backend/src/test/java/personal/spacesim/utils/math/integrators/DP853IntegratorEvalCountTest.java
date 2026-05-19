package personal.spacesim.utils.math.integrators;

import org.junit.jupiter.api.Test;
import personal.spacesim.simulation.state.NBodyDerivatives;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DP853IntegratorEvalCountTest {

    @Test
    void evaluationCountIncreasesAcrossSteps() {
        // After two non-trivial steps, the eval counter must have
        // advanced — proves we're piping to Hipparchus's
        // AbstractIntegrator.getEvaluations() and that it's monotone.
        DP853Integrator integrator = new DP853Integrator();
        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{1.989e30, 5.972e24});

        double[] state = {
                0, 0, 0, 0, 0, 0,
                1.5e11, 0, 0, 0, 29800, 0,
        };
        double[] next = new double[state.length];

        assertEquals(0, integrator.getEvaluationCount(),
                "fresh integrator should report zero evaluations");

        integrator.stepInto(next, state, 86_400.0, derivs);
        long afterOne = integrator.getEvaluationCount();
        assertTrue(afterOne > 0, "evaluations must be positive after one step");

        integrator.stepInto(state, next, 86_400.0, derivs);
        long afterTwo = integrator.getEvaluationCount();
        assertTrue(afterTwo > afterOne, "evaluations must grow with steps");
    }

    @Test
    void fixedStepIntegratorsReportZero() {
        // Default Integrator interface returns 0 — fixed-step
        // integrators don't track this.
        assertEquals(0, new EulerIntegrator().getEvaluationCount());
        assertEquals(0, new RK4Integrator().getEvaluationCount());
    }
}
