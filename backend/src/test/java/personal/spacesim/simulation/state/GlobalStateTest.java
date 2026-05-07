package personal.spacesim.simulation.state;

import org.hipparchus.geometry.euclidean.threed.Vector3D;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class GlobalStateTest {

    @Test
    void rejectsMismatchedDataLength() {
        // 2 bodies should require 12 doubles (6 per body)
        assertThrows(IllegalArgumentException.class,
            () -> new GlobalState(new double[11], 2));
        assertThrows(IllegalArgumentException.class,
            () -> new GlobalState(new double[13], 2));
    }

    @Test
    void positionAndVelocityExtractCorrectly() {
        // body 0: pos (1,2,3), vel (4,5,6)
        // body 1: pos (10,20,30), vel (40,50,60)
        double[] data = {1, 2, 3, 4, 5, 6, 10, 20, 30, 40, 50, 60};
        GlobalState state = new GlobalState(data, 2);

        assertEquals(new Vector3D(1, 2, 3), state.position(0));
        assertEquals(new Vector3D(4, 5, 6), state.velocity(0));
        assertEquals(new Vector3D(10, 20, 30), state.position(1));
        assertEquals(new Vector3D(40, 50, 60), state.velocity(1));
    }

    @Test
    void addScaledProducesCorrectMath() {
        double[] aData = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12};
        double[] bData = {1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2};
        GlobalState a = new GlobalState(aData, 2);
        GlobalState b = new GlobalState(bData, 2);

        GlobalState result = a.addScaled(b, 0.5);

        // body 0: each component of a + 0.5 * each component of b
        assertEquals(1.5, result.data()[0], 1e-12);   // 1 + 0.5*1
        assertEquals(2.5, result.data()[1], 1e-12);
        assertEquals(6.5, result.data()[5], 1e-12);   // 6 + 0.5*1
        // body 1
        assertEquals(8.0, result.data()[6], 1e-12);   // 7 + 0.5*2
        assertEquals(13.0, result.data()[11], 1e-12); // 12 + 0.5*2
    }

    @Test
    void addScaledRejectsShapeMismatch() {
        GlobalState a = new GlobalState(new double[6], 1);
        GlobalState b = new GlobalState(new double[12], 2);

        assertThrows(IllegalArgumentException.class, () -> a.addScaled(b, 1.0));
    }

    @Test
    void bodyCountIsExposed() {
        GlobalState state = new GlobalState(new double[18], 3);
        assertEquals(3, state.bodyCount());
    }
}
