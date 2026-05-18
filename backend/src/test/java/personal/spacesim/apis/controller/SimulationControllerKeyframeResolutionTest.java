package personal.spacesim.apis.controller;

import org.junit.jupiter.api.Test;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins the private resolveKeyframesPerKept helper on SimulationController.
 * Direct unit test via reflection — the helper is pure, has no Spring
 * deps, and the codebase doesn't otherwise wire MockMvc, so a reflection-
 * based unit test is the lowest-overhead way to lock in the rounding +
 * validation rules.
 */
class SimulationControllerKeyframeResolutionTest {

    private static int resolve(Double intervalSec, String unit) {
        try {
            Method m = SimulationController.class.getDeclaredMethod(
                    "resolveKeyframesPerKept", Double.class, String.class);
            m.setAccessible(true);
            return (int) m.invoke(null, intervalSec, unit);
        } catch (InvocationTargetException e) {
            // Unwrap to the real exception for assertThrows.
            Throwable cause = e.getCause();
            if (cause instanceof RuntimeException re) throw re;
            throw new RuntimeException(cause);
        } catch (ReflectiveOperationException e) {
            throw new RuntimeException(e);
        }
    }

    @Test
    void nullIntervalResolvesToK1() {
        assertEquals(1, resolve(null, "seconds"));
    }

    @Test
    void intervalEqualToStepDtResolvesToK1() {
        // seconds unit → stepDt=1s; 1.0s / 1.0s = 1
        assertEquals(1, resolve(1.0, "seconds"));
    }

    @Test
    void intervalFourTimesStepDtResolvesToK4() {
        assertEquals(4, resolve(4.0, "seconds"));
    }

    @Test
    void intervalRoundsToNearestKAtNonIntegerMultiples() {
        // 3.6s / 1.0s = 3.6 → rounds to 4
        assertEquals(4, resolve(3.6, "seconds"));
        // 3.4s / 1.0s = 3.4 → rounds to 3
        assertEquals(3, resolve(3.4, "seconds"));
    }

    @Test
    void daysUnitRespectsStepDtConversion() {
        // 4 days expressed in seconds, against a 1-day stepDt → K=4
        double fourDaysSec = 4.0 * 86400.0;
        assertEquals(4, resolve(fourDaysSec, "days"));
    }

    @Test
    void belowOneStepClampsToK1() {
        // 0.4s / 1.0s = 0.4 → rounds to 0 → clamped to 1
        assertEquals(1, resolve(0.4, "seconds"));
    }

    @Test
    void exactlyMaxResolvesSuccessfully() {
        // 100s / 1s = 100 → at the cap, accepted
        assertEquals(100, resolve(100.0, "seconds"));
    }

    @Test
    void aboveMaxThrows() {
        IllegalArgumentException ex = assertThrows(
                IllegalArgumentException.class,
                () -> resolve(101.0, "seconds")
        );
        assertTrue(ex.getMessage().contains("101"),
                "Error message should report the resolved K. Got: " + ex.getMessage());
    }

    @Test
    void negativeIntervalThrows() {
        assertThrows(IllegalArgumentException.class,
                () -> resolve(-1.0, "seconds"));
    }

    @Test
    void zeroIntervalThrows() {
        assertThrows(IllegalArgumentException.class,
                () -> resolve(0.0, "seconds"));
    }

    @Test
    void infiniteIntervalThrows() {
        assertThrows(IllegalArgumentException.class,
                () -> resolve(Double.POSITIVE_INFINITY, "seconds"));
    }

    @Test
    void nanIntervalThrows() {
        assertThrows(IllegalArgumentException.class,
                () -> resolve(Double.NaN, "seconds"));
    }

    @Test
    void unknownUnitThrows() {
        assertThrows(IllegalArgumentException.class,
                () -> resolve(1.0, "fortnights"));
    }
}
