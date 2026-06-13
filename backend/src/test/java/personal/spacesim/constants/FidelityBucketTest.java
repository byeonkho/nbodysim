package personal.spacesim.constants;

import org.junit.jupiter.api.Test;
import personal.spacesim.utils.math.integrators.IntegratorFactory;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins the user-facing bucket → (K, N) table and per-integrator landing
 * defaults. Both halves of this contract are load-bearing for the
 * frontend mirror in {@code PlaybackQuality.ts} — drift here means
 * silent quality regressions in the UI.
 */
class FidelityBucketTest {

    @Test
    void allBucketsResolveToExpectedKValues() {
        // Design doc table — Euler/RK4 column.
        assertEquals(20, FidelityBucket.fromWireName("low").keyframesPerKept());
        assertEquals(10, FidelityBucket.fromWireName("medLow").keyframesPerKept());
        assertEquals(5,  FidelityBucket.fromWireName("medium").keyframesPerKept());
        assertEquals(2,  FidelityBucket.fromWireName("medHigh").keyframesPerKept());
    }

    @Test
    void allBucketsResolveToExpectedNValues() {
        // Design doc table — DP853 column.
        assertEquals(3000,  FidelityBucket.fromWireName("low").targetSnapshotsPerChunk());
        assertEquals(5000,  FidelityBucket.fromWireName("medLow").targetSnapshotsPerChunk());
        assertEquals(7500,  FidelityBucket.fromWireName("medium").targetSnapshotsPerChunk());
        assertEquals(10000, FidelityBucket.fromWireName("medHigh").targetSnapshotsPerChunk());
    }

    @Test
    void kValuesAreMonotonicallyDecreasingLowToHigh() {
        // Higher quality = fewer skipped steps = lower K. Sanity check
        // catches accidental swaps of K values between buckets.
        FidelityBucket[] ascending = {
                FidelityBucket.LOW, FidelityBucket.MED_LOW,
                FidelityBucket.MEDIUM, FidelityBucket.MED_HIGH
        };
        for (int i = 1; i < ascending.length; i++) {
            assertTrue(
                    ascending[i - 1].keyframesPerKept() > ascending[i].keyframesPerKept(),
                    "K must decrease as quality bucket ascends: " + ascending[i - 1]
                            + " K=" + ascending[i - 1].keyframesPerKept()
                            + " should exceed " + ascending[i] + " K="
                            + ascending[i].keyframesPerKept()
            );
        }
    }

    @Test
    void nValuesAreMonotonicallyIncreasingLowToHigh() {
        // Higher quality = more snapshots emitted = higher N.
        FidelityBucket[] ascending = {
                FidelityBucket.LOW, FidelityBucket.MED_LOW,
                FidelityBucket.MEDIUM, FidelityBucket.MED_HIGH
        };
        for (int i = 1; i < ascending.length; i++) {
            assertTrue(
                    ascending[i - 1].targetSnapshotsPerChunk() < ascending[i].targetSnapshotsPerChunk(),
                    "N must increase as quality bucket ascends"
            );
        }
    }

    @Test
    void fromWireNameRejectsUnknown() {
        IllegalArgumentException ex = assertThrows(
                IllegalArgumentException.class,
                () -> FidelityBucket.fromWireName("garbage")
        );
        assertTrue(ex.getMessage().contains("garbage"),
                "Error should report the bad input: " + ex.getMessage());
    }

    @Test
    void fromWireNameRejectsNull() {
        assertThrows(IllegalArgumentException.class,
                () -> FidelityBucket.fromWireName(null));
    }

    @Test
    void fromWireNameRejectsEmpty() {
        assertThrows(IllegalArgumentException.class,
                () -> FidelityBucket.fromWireName(""));
    }

    @Test
    void defaultForEulerIsMedHigh() {
        // Per design doc landing defaults.
        assertEquals(FidelityBucket.MED_HIGH, FidelityBucket.defaultFor("euler"));
    }

    @Test
    void defaultForRk4IsMedLow() {
        assertEquals(FidelityBucket.MED_LOW, FidelityBucket.defaultFor("rk4"));
    }

    @Test
    void defaultForDp853IsLow() {
        assertEquals(FidelityBucket.LOW, FidelityBucket.defaultFor("dp853"));
    }

    @Test
    void defaultForIsCaseInsensitive() {
        // Frontend may send uppercase strings — match the integrator-factory
        // tolerance pattern.
        assertEquals(FidelityBucket.MED_HIGH, FidelityBucket.defaultFor("EULER"));
        assertEquals(FidelityBucket.LOW, FidelityBucket.defaultFor("DP853"));
    }

    @Test
    void defaultForRungekuttaAliasIsMedLow() {
        // "rungekutta" is an RK4 alias the IntegratorFactory accepts; it must
        // resolve to the same bucket as "rk4".
        assertEquals(FidelityBucket.MED_LOW, FidelityBucket.defaultFor("rungekutta"));
    }

    @Test
    void defaultForDormandprinceAliasIsLow() {
        // "dormandprince" is a DP853 alias the IntegratorFactory accepts; it
        // must resolve to the same bucket as "dp853".
        assertEquals(FidelityBucket.LOW, FidelityBucket.defaultFor("dormandprince"));
    }

    @Test
    void defaultForAliasesAreCaseInsensitive() {
        assertEquals(FidelityBucket.MED_LOW, FidelityBucket.defaultFor("RungeKutta"));
        assertEquals(FidelityBucket.LOW, FidelityBucket.defaultFor("DormandPrince"));
    }

    @Test
    void everyFactoryAliasResolvesToABucket() {
        // Parity guard: every integrator string IntegratorFactory.createIntegrator
        // accepts must also resolve to a fidelity bucket in defaultFor. When the
        // two alias lists drift apart, an /initialize request with a valid alias
        // and fidelityBucket=null builds an integrator and then 400s in defaultFor.
        // Pin the lists together so a future factory alias that isn't mirrored
        // here fails this test.
        IntegratorFactory factory = new IntegratorFactory();
        String[] factoryAliases = {"euler", "rk4", "rungekutta", "dp853", "dormandprince"};
        for (String alias : factoryAliases) {
            // Confirm the test premise: this really is an alias the factory accepts.
            assertDoesNotThrow(() -> factory.createIntegrator(alias),
                    "Test premise broken: factory should accept '" + alias + "'");
            // The parity assertion: defaultFor must accept it too.
            assertDoesNotThrow(() -> FidelityBucket.defaultFor(alias),
                    "defaultFor must accept every integrator alias the factory does, "
                            + "but rejected '" + alias + "'");
        }
    }

    @Test
    void defaultForRejectsUnknownIntegrator() {
        assertThrows(IllegalArgumentException.class,
                () -> FidelityBucket.defaultFor("fortran66"));
    }

    @Test
    void defaultForRejectsNull() {
        assertThrows(IllegalArgumentException.class,
                () -> FidelityBucket.defaultFor(null));
    }
}
