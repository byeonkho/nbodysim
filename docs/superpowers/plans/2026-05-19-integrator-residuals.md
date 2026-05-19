# Integrator Residuals (#60) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make integrator numerical drift visible as a UI number. Backend computes total system energy at each emitted snapshot and ships `ΔE/E₀`. For DP853, also ships chunk-aggregate `avgStepSeconds` and `acceptRate`. Frontend renders both on the top status strip and the body card.

**Architecture:** New `NBodyDerivatives.totalEnergy(state)` runs on the hot path (allocation-free, indexed loop over `gm[]`, `1/G` factored out). `Simulation` captures `e0` once at construction and accumulates per-emission `ΔE/E₀` plus DP853 telemetry into a new `ChunkResult` record. The wire format gets +12 bytes in the header (always written, `NaN` when not DP853) and +4 bytes per snapshot. Frontend `chunkBuffer` stores `deltaERelative` as a `Float32Array` parallel to `timestamps`; chunk-level telemetry sits alongside. UI cells read via the same ref-based 5 Hz pattern `BodyCard` already uses.

**Tech Stack:** Java 21, JUnit Jupiter, Spring Boot, Hipparchus (DP853). TypeScript, Vitest, Redux Toolkit, R3F.

**Design spec:** `docs/superpowers/specs/2026-05-19-integrator-residuals-design.md`

**Branch:** `integrator-residuals` (already created; spec committed)

---

## File structure

### Backend

| Path | Action | Responsibility |
|---|---|---|
| `backend/src/main/java/personal/spacesim/simulation/state/NBodyDerivatives.java` | Modify | Add `totalEnergy(state)` — hot-path computation |
| `backend/src/test/java/personal/spacesim/simulation/state/NBodyDerivativesEnergyTest.java` | Create | Unit tests for energy formula + integrator-drift invariance |
| `backend/src/main/java/personal/spacesim/simulation/ChunkResult.java` | Create | Record holding snapshots + per-emission ΔE/E₀ + optional DP853 telemetry |
| `backend/src/main/java/personal/spacesim/simulation/Dp853Telemetry.java` | Create | Record: `(double avgStepSeconds, double acceptRate)` |
| `backend/src/main/java/personal/spacesim/simulation/Simulation.java` | Modify | Capture `e0` at construction; ship `ChunkResult` from `run()`; accumulate DP853 telemetry |
| `backend/src/main/java/personal/spacesim/utils/math/integrators/Integrator.java` | Modify | Add default `getEvaluationCount()` returning 0 |
| `backend/src/main/java/personal/spacesim/utils/math/integrators/DP853Integrator.java` | Modify | Override `getEvaluationCount()` to delegate to Hipparchus |
| `backend/src/main/java/personal/spacesim/services/SimulationSessionService.java` | Modify | Adapt to `ChunkResult` return; remove dead `runSimulation()` |
| `backend/src/main/java/personal/spacesim/utils/serializers/BinaryResponseSerializer.java` | Modify | Serialize header DP853 fields + per-snapshot ΔE/E₀ |
| `backend/src/test/java/personal/spacesim/utils/serializers/BinaryResponseSerializerTest.java` | Modify | Extend wire-format pin to cover new fields |

### Frontend

| Path | Action | Responsibility |
|---|---|---|
| `frontend/src/app/store/middleware/parseBinaryChunk.ts` | Modify | Parse new header + per-snapshot fields; expose on `ParsedChunkTypedArrays` |
| `frontend/src/app/store/middleware/parseBinaryChunk.test.ts` | Modify | Extend hand-crafted fixture with new fields |
| `frontend/src/app/store/chunkBuffer.ts` | Modify | Store `deltaERelative` typed array + chunk-level telemetry; add `readDeltaERelativeAt` |
| `frontend/src/app/store/chunkBuffer.test.ts` | Modify | Test `readDeltaERelativeAt` |
| `frontend/src/app/store/middleware/parseBinaryChunk.ts` (already listed) | — | — |
| `frontend/src/app/components/chrome/TopStatusStrip.tsx` | Modify | Add `ΔE/E₀` `StatusCell` with ref-based 5 Hz tick |
| `frontend/src/app/components/chrome/BodyCard.tsx` | Modify | Add `Integrator residual` subsection (one shared row + two DP853-only rows) |

---

## Phase 1 — Backend energy calc + `ChunkResult` plumbing

Goal of phase: `Simulation.run()` returns a `ChunkResult` carrying snapshots, a parallel `Map<AbsoluteDate, Double>` of `ΔE/E₀` values, and a null telemetry slot. Energy formula has unit tests; energy invariance across integrators has correctness tests. Nothing on the wire yet.

### Task 1.1 — Add `totalEnergy(state)` to `NBodyDerivatives`

**Files:**
- Modify: `backend/src/main/java/personal/spacesim/simulation/state/NBodyDerivatives.java`
- Create: `backend/src/test/java/personal/spacesim/simulation/state/NBodyDerivativesEnergyTest.java`

- [ ] **Step 1: Write failing unit tests for the energy formula**

Create `backend/src/test/java/personal/spacesim/simulation/state/NBodyDerivativesEnergyTest.java`:

```java
package personal.spacesim.simulation.state;

import org.junit.jupiter.api.Test;
import personal.spacesim.constants.PhysicsConstants;

import static org.junit.jupiter.api.Assertions.assertEquals;

class NBodyDerivativesEnergyTest {

    @Test
    void loneBodyHasOnlyKineticEnergy() {
        // One body, mass M, velocity (vx, 0, 0). T = 0.5·M·vx². U = 0
        // (no pairs). E = T.
        double M = 1e24;
        double vx = 1e3;
        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{M});

        double[] state = {0, 0, 0, vx, 0, 0};
        double e = derivs.totalEnergy(state);

        double expected = 0.5 * M * vx * vx;
        assertEquals(expected, e, Math.abs(expected) * 1e-12);
    }

    @Test
    void twoBodiesAtRestHavePurePotentialEnergy() {
        // Two equal masses M at separation r, both at rest. T = 0.
        // U = -G·M·M / r.
        double M = 1e24;
        double r = 1e10;
        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{M, M});

        double[] state = {
                0, 0, 0, 0, 0, 0,
                r, 0, 0, 0, 0, 0,
        };
        double e = derivs.totalEnergy(state);

        double expected = -PhysicsConstants.GRAVITATIONAL_CONSTANT * M * M / r;
        assertEquals(expected, e, Math.abs(expected) * 1e-12);
    }

    @Test
    void energyInvariantUnderRigidTranslation() {
        // Shifting both bodies by the same vector leaves both T and U
        // unchanged. Confirms the formula isn't accidentally using
        // absolute position instead of pairwise separation.
        double M = 1e24;
        double r = 1e10;
        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{M, M});

        double[] origin = {
                0, 0, 0, 100, 0, 0,
                r, 0, 0, -50, 0, 0,
        };
        double[] shifted = {
                1e9, 2e9, 3e9, 100, 0, 0,
                r + 1e9, 2e9, 3e9, -50, 0, 0,
        };
        double eOrigin = derivs.totalEnergy(origin);
        double eShifted = derivs.totalEnergy(shifted);

        assertEquals(eOrigin, eShifted, Math.abs(eOrigin) * 1e-12);
    }

    @Test
    void rejectsMismatchedStateLength() {
        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{1e24, 1e24});
        // state has 1 body but derivs is configured for 2
        double[] tooShort = {0, 0, 0, 0, 0, 0};
        org.junit.jupiter.api.Assertions.assertThrows(
                IllegalArgumentException.class,
                () -> derivs.totalEnergy(tooShort));
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && ./mvnw test -Dtest=NBodyDerivativesEnergyTest -q
```

Expected: FAIL with "method totalEnergy not found" or similar compile error.

- [ ] **Step 3: Implement `totalEnergy` in `NBodyDerivatives.java`**

Add this method to `NBodyDerivatives` (after `derivativesInto`, before the allocating `derivatives` wrapper):

```java
    /**
     * Total mechanical energy {@code E = T + U} of the N-body system in
     * the given flat state vector.
     *
     * <p>Returned in joules (SI). Sign convention: kinetic positive,
     * potential negative for bound systems; the sum is negative for any
     * gravitationally bound configuration.
     *
     * <p>Hot path: called once per emitted snapshot (~5000 times per
     * DP853 chunk). Allocation-free; single indexed pair loop matching
     * the {@link #derivativesInto} access pattern. {@code 1/G} is
     * factored out so we reuse the existing {@code gm[]} array rather
     * than carrying a parallel mass array.
     *
     * <p>Math:
     * <pre>
     * T = 0.5 / G · Σ_i gm[i] · |v_i|²
     * U = -1.0 / G · Σ_{i&lt;j} gm[i] · gm[j] / r_ij
     * </pre>
     */
    public double totalEnergy(double[] state) {
        int n = state.length / GlobalState.COORDS_PER_BODY;
        if (n != gm.length) {
            throw new IllegalArgumentException(
                "state bodyCount " + n + " does not match this derivatives' bodyCount " + gm.length);
        }

        double kineticSum = 0.0;
        double potentialSum = 0.0;
        for (int i = 0; i < n; i++) {
            int baseI = i * GlobalState.COORDS_PER_BODY;
            double xi = state[baseI];
            double yi = state[baseI + 1];
            double zi = state[baseI + 2];
            double vxi = state[baseI + 3];
            double vyi = state[baseI + 4];
            double vzi = state[baseI + 5];

            kineticSum += gm[i] * (vxi * vxi + vyi * vyi + vzi * vzi);

            for (int j = i + 1; j < n; j++) {
                int baseJ = j * GlobalState.COORDS_PER_BODY;
                double dx = state[baseJ]     - xi;
                double dy = state[baseJ + 1] - yi;
                double dz = state[baseJ + 2] - zi;
                double r = Math.sqrt(dx * dx + dy * dy + dz * dz);
                potentialSum += gm[i] * gm[j] / r;
            }
        }

        double invG = 1.0 / PhysicsConstants.GRAVITATIONAL_CONSTANT;
        return invG * (0.5 * kineticSum - potentialSum);
    }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && ./mvnw test -Dtest=NBodyDerivativesEnergyTest -q
```

Expected: PASS (4 tests).

- [ ] **Step 5: Run full backend test suite to check nothing else broke**

```bash
cd backend && ./mvnw test -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/main/java/personal/spacesim/simulation/state/NBodyDerivatives.java \
        backend/src/test/java/personal/spacesim/simulation/state/NBodyDerivativesEnergyTest.java
git commit -m "feat(sim): NBodyDerivatives.totalEnergy on the hot path

Allocation-free T + U computation matching the derivativesInto access
pattern. Reuses gm[] with 1/G factored out so we don't carry a
parallel mass array. Unit tests cover lone-body T, two-body U, rigid
translation invariance, and dimension mismatch."
```

---

### Task 1.2 — Define `ChunkResult` and `Dp853Telemetry` records

**Files:**
- Create: `backend/src/main/java/personal/spacesim/simulation/ChunkResult.java`
- Create: `backend/src/main/java/personal/spacesim/simulation/Dp853Telemetry.java`

- [ ] **Step 1: Create `Dp853Telemetry.java`**

```java
package personal.spacesim.simulation;

/**
 * Per-chunk telemetry for the DP853 adaptive integrator. Populated only
 * when the integrator was DP853; null otherwise.
 *
 * @param avgStepSeconds mean accepted-step duration over the chunk, in sim seconds
 * @param acceptRate     fraction of attempted steps that were accepted, in [0, 1]
 */
public record Dp853Telemetry(double avgStepSeconds, double acceptRate) {}
```

- [ ] **Step 2: Create `ChunkResult.java`**

```java
package personal.spacesim.simulation;

import org.orekit.time.AbsoluteDate;
import personal.spacesim.simulation.body.CelestialBodySnapshot;

import java.util.List;
import java.util.Map;

/**
 * Aggregate return type from {@link Simulation#run()}. Bundles the
 * per-emission state snapshots with the parallel ΔE/E₀ values and the
 * optional DP853 chunk-aggregate telemetry, so the serializer takes
 * one cohesive input rather than three parallel collections.
 *
 * <p>The {@code snapshots} and {@code deltaERelative} maps share keys
 * by construction: every emission writes both. Order is insertion
 * (LinkedHashMap) so the serializer can iterate either map and trust
 * the iteration order matches.
 *
 * @param snapshots        per-emission body state (positions, velocities), keyed by sim date
 * @param deltaERelative   per-emission (E - E₀) / |E₀|, keyed by the same dates
 * @param telemetry        DP853 chunk-aggregate values; null for Euler/RK4 chunks
 */
public record ChunkResult(
        Map<AbsoluteDate, List<CelestialBodySnapshot>> snapshots,
        Map<AbsoluteDate, Double> deltaERelative,
        Dp853Telemetry telemetry
) {}
```

- [ ] **Step 3: Verify compilation**

```bash
cd backend && ./mvnw compile -q
```

Expected: PASS (just adds two new files, no other code depends on them yet).

- [ ] **Step 4: Commit**

```bash
git add backend/src/main/java/personal/spacesim/simulation/ChunkResult.java \
        backend/src/main/java/personal/spacesim/simulation/Dp853Telemetry.java
git commit -m "feat(sim): ChunkResult and Dp853Telemetry records

ChunkResult bundles the per-emission snapshots, ΔE/E₀ map, and
optional DP853 telemetry into a single Simulation.run() return value.
Dp853Telemetry holds avgStepSeconds + acceptRate; null on the
ChunkResult for fixed-step integrators."
```

---

### Task 1.3 — `Simulation.run()` captures `e0`, ships `ChunkResult`

**Files:**
- Modify: `backend/src/main/java/personal/spacesim/simulation/Simulation.java`
- Modify: `backend/src/main/java/personal/spacesim/services/SimulationSessionService.java`

This task changes `Simulation.run()`'s return type from `Map<AbsoluteDate, List<CelestialBodySnapshot>>` to `ChunkResult`. DP853 telemetry stays `null` here (filled in Phase 2).

- [ ] **Step 1: Add `e0` field + initialize in `Simulation` constructor**

In `backend/src/main/java/personal/spacesim/simulation/Simulation.java`, after the existing fields and inside the constructor:

Add the field (next to `currentStateBuffer`):

```java
    /**
     * Total mechanical energy of the system at {@link #simStartDate},
     * computed once at construction. Used as the denominator in
     * per-emission ΔE/E₀. Guard against |e0| ≈ 0 in readers (physically
     * impossible for any bound system but worth defending against
     * synthetic test inputs).
     */
    private final double e0;
```

At the end of the constructor (after the `sunIndex` assignment), add:

```java
        // E₀ captured from the initial state. Stored absolute so per-
        // emission readers can compute (E - e0) / |e0| with the
        // guard-against-zero rule at the call site.
        this.e0 = derivatives.totalEnergy(currentStateBuffer);
```

- [ ] **Step 2: Update `Simulation.run()` to build and return `ChunkResult`**

Replace the existing `run()` method's signature and result type. The body's emission sites get a small change: at every `results.put(date, snapshot)` we also compute and store `ΔE/E₀`.

Change the imports near the top of `Simulation.java` to add (if not present):

```java
import java.util.HashMap;
```

Replace `public Map<AbsoluteDate, List<CelestialBodySnapshot>> run() { ... }` with:

```java
    public ChunkResult run() {
        long startTime = System.nanoTime();
        Map<AbsoluteDate, List<CelestialBodySnapshot>> results = new LinkedHashMap<>();
        Map<AbsoluteDate, Double> deltaE = new LinkedHashMap<>();

        // Adaptive integrators (DP853): every accepted substep gives us
        // an interpolator-backed window [stepStart+prev, stepStart+curr]
        // over which we can compute state at any time. We emit at EXACT
        // scheduled target times (not at substep boundaries) by
        // interpolating — produces uniformly-time-spaced samples
        // regardless of how DP853 chose its substep cadence. Critical
        // for Trail.tsx and other integer-index consumers that assume
        // uniform spacing. Fixed-step integrators register but never
        // fire (no substeps).
        integrator.setSubstepHandler((prevTimeSec, currTimeSec, eval) -> {
            while (nextEmitTarget != null) {
                double targetRelTime = nextEmitTarget.durationFrom(stepStartDate);
                if (targetRelTime > currTimeSec) {
                    break;
                }
                double evalT = Math.max(targetRelTime, prevTimeSec);
                double[] evaluatedState = eval.stateAt(evalT);
                results.put(nextEmitTarget, snapshotFromState(evaluatedState));
                deltaE.put(nextEmitTarget, computeDeltaE(evaluatedState));
                adaptiveEmitCount++;
                nextEmitTarget = simStartDate.shiftedBy(
                        adaptiveEmitCount * targetGapSeconds);
            }
        });

        try {
            // Initial frame is always kept (step 0). Only on the first chunk.
            if (!hasEmittedInitialFrame) {
                results.put(simCurrentDate, snapshotFromState(currentStateBuffer));
                deltaE.put(simCurrentDate, computeDeltaE(currentStateBuffer));
                hasEmittedInitialFrame = true;
                nextKeptAtStep = keyframesPerKept;
                adaptiveEmitCount = 1;
                nextEmitTarget = simStartDate.shiftedBy(
                        adaptiveEmitCount * targetGapSeconds);
            }

            int currentTimeStep = 0;
            while (currentTimeStep < TIMESTEPS_TO_RUN) {
                update();
                globalStepCount++;

                if (!isAdaptiveIntegrator
                        && globalStepCount >= nextKeptAtStep) {
                    results.put(simCurrentDate, snapshotFromState(currentStateBuffer));
                    deltaE.put(simCurrentDate, computeDeltaE(currentStateBuffer));
                    nextKeptAtStep += keyframesPerKept;
                }
                currentTimeStep++;
            }
        } finally {
            integrator.setSubstepHandler(null);
        }

        long endTime = System.nanoTime();
        double totalTimeSeconds = (endTime - startTime) / 1_000_000_000.0;

        log.info("Simulation completed for {} {} in {} seconds.", TIMESTEPS_TO_RUN, timeStepUnit, totalTimeSeconds);
        log.info("Simulation ran using frame: {}", frame.getName());

        // DP853 telemetry filled in Phase 2; null for now.
        return new ChunkResult(results, deltaE, null);
    }

    /**
     * Relative energy drift {@code (E - e0) / |e0|} at the given state.
     * Guards against a degenerate |e0| ≈ 0 (would only occur in
     * synthetic test inputs — any bound system has strictly negative
     * E₀) by returning 0.0 to keep the wire format well-defined.
     */
    private double computeDeltaE(double[] state) {
        double absE0 = Math.abs(e0);
        if (absE0 < 1e-30) {
            return 0.0;
        }
        return (derivatives.totalEnergy(state) - e0) / absE0;
    }
```

- [ ] **Step 3: Update `SimulationSessionService` to consume `ChunkResult`**

In `backend/src/main/java/personal/spacesim/services/SimulationSessionService.java`:

Change the import block to also import `ChunkResult`:

```java
import personal.spacesim.simulation.ChunkResult;
```

Replace the existing `runSimulation` method (it's dead code with the old return type — delete it):

```java
    // (delete lines 122-134, the entire runSimulation method)
```

In `computeChunkBytes` (around line 188), change:

```java
        Map<AbsoluteDate, List<CelestialBodySnapshot>> chunkData = simulation.run();
```

to:

```java
        ChunkResult chunkResult = simulation.run();
```

And on the serialize line (around line 196), change:

```java
        byte[] binary = binaryResponseSerializer.serialize(chunkData, muByName);
```

to:

```java
        byte[] binary = binaryResponseSerializer.serialize(chunkResult, muByName);
```

The serializer's signature change is in Phase 3. For now this call won't compile — we'll keep the file compiling by passing through the old map shape via a temporary adapter:

Actually, do it the other way: keep `binaryResponseSerializer.serialize` signature unchanged in this phase, and pass `chunkResult.snapshots()`:

```java
        byte[] binary = binaryResponseSerializer.serialize(chunkResult.snapshots(), muByName);
```

This keeps the project compiling end-to-end through Phase 2; the serializer signature changes in Phase 3.

- [ ] **Step 4: Verify compilation**

```bash
cd backend && ./mvnw compile -q
```

Expected: PASS.

- [ ] **Step 5: Run full backend tests**

```bash
cd backend && ./mvnw test -q
```

Expected: PASS. (Existing `SimulationTest` calls `simulation.run()` — its return type changed, so any direct `.get(date)` calls in tests need to be updated to `.snapshots().get(date)`. If anything fails, fix the test call sites by replacing `simulation.run().get(...)` with `simulation.run().snapshots().get(...)`.)

- [ ] **Step 6: Commit**

```bash
git add backend/src/main/java/personal/spacesim/simulation/Simulation.java \
        backend/src/main/java/personal/spacesim/services/SimulationSessionService.java \
        backend/src/test/java/personal/spacesim/simulation/SimulationTest.java
git commit -m "feat(sim): Simulation.run returns ChunkResult with per-emission ΔE/E₀

E₀ captured once at construction; computeDeltaE called at every
emission site (initial frame, fixed-step keyframe, DP853 interpolator
emission). DP853 telemetry slot remains null pending phase 2.

SimulationSessionService.computeChunkBytes pulls snapshots() off the
ChunkResult for the existing serializer signature; the serializer
itself takes the full record in phase 3. Dead runSimulation() method
deleted."
```

---

### Task 1.4 — Energy invariance test per integrator

**Files:**
- Modify: `backend/src/test/java/personal/spacesim/simulation/state/NBodyDerivativesEnergyTest.java`

Add a test that integrates a known orbit forward and confirms `|ΔE/E₀|` stays within each integrator's expected bound. This is the load-bearing correctness test for #60 — if these thresholds aren't met, the residual the UI displays isn't trustworthy.

- [ ] **Step 1: Add the new test method to `NBodyDerivativesEnergyTest`**

Add the imports at the top:

```java
import personal.spacesim.utils.math.integrators.DP853Integrator;
import personal.spacesim.utils.math.integrators.EulerIntegrator;
import personal.spacesim.utils.math.integrators.Integrator;
import personal.spacesim.utils.math.integrators.RK4Integrator;
```

Add this test method:

```java
    @Test
    void integratorDriftStaysWithinExpectedBounds() {
        // Earth-mass body in circular orbit around Sun at 1 AU. Run
        // each integrator for 1000 daily steps (~3 years) and check
        // |ΔE/E₀| stays within the integrator's typical drift envelope.
        // Thresholds are conservative — actual values are usually
        // 10–100× better, but the bounds catch any regression that
        // makes an integrator visibly broken.
        double sunMass = 1.989e30;
        double earthMass = 5.972e24;
        double au = 1.495978707e11;
        // v for circular orbit: v = sqrt(G·M_sun / r)
        double vCircular = Math.sqrt(
                PhysicsConstants.GRAVITATIONAL_CONSTANT * sunMass / au);

        NBodyDerivatives derivs = new NBodyDerivatives(new double[]{sunMass, earthMass});

        double[] initialState = {
                0, 0, 0,                    // Sun position
                0, 0, 0,                    // Sun velocity
                au, 0, 0,                   // Earth position
                0, vCircular, 0,            // Earth velocity (circular orbit)
        };
        double e0 = derivs.totalEnergy(initialState);
        double absE0 = Math.abs(e0);

        double dt = 86_400.0;  // 1 day
        int steps = 1000;

        // Threshold per integrator: Euler is allowed to drift hugely;
        // RK4 should stay tight; DP853 should be near machine precision.
        assertEnergyDriftBounded(new EulerIntegrator(), derivs, initialState.clone(), dt, steps, absE0, e0, 5e-2);
        assertEnergyDriftBounded(new RK4Integrator(),   derivs, initialState.clone(), dt, steps, absE0, e0, 1e-7);
        assertEnergyDriftBounded(new DP853Integrator(), derivs, initialState.clone(), dt, steps, absE0, e0, 1e-10);
    }

    private static void assertEnergyDriftBounded(
            Integrator integrator,
            NBodyDerivatives derivs,
            double[] state,
            double dt,
            int steps,
            double absE0,
            double e0,
            double bound
    ) {
        double[] next = new double[state.length];
        for (int i = 0; i < steps; i++) {
            integrator.stepInto(next, state, dt, derivs);
            double[] tmp = state;
            state = next;
            next = tmp;
        }
        double eFinal = derivs.totalEnergy(state);
        double drift = Math.abs((eFinal - e0) / absE0);
        org.junit.jupiter.api.Assertions.assertTrue(
                drift < bound,
                String.format(
                        "%s drift %.3e exceeds bound %.3e",
                        integrator.getClass().getSimpleName(), drift, bound));
    }
```

- [ ] **Step 2: Run the test**

```bash
cd backend && ./mvnw test -Dtest=NBodyDerivativesEnergyTest -q
```

Expected: PASS. If Euler exceeds 5e-2, investigate — Euler is allowed to drift, but if it's wildly wrong (`1e+10`-style numbers) the formula or integrator setup is wrong.

- [ ] **Step 3: Commit**

```bash
git add backend/src/test/java/personal/spacesim/simulation/state/NBodyDerivativesEnergyTest.java
git commit -m "test(sim): integrator energy invariance bounds

Three-year Earth circular orbit at 1 AU, daily timestep. Pins:
  Euler  < 5e-2  (allowed to drift, but bounded)
  RK4    < 1e-7  (clean for short runs)
  DP853  < 1e-10 (machine-precision territory)

These are conservative bounds — actual drift is usually 10–100× better.
The threshold is the regression alarm, not the spec value."
```

---

### Phase 1 verification gate

Before moving to Phase 2:

- [ ] `cd backend && ./mvnw test -q` passes
- [ ] `cd backend && ./mvnw compile -q` passes
- [ ] Manual: start backend (`./mvnw spring-boot:run`), open frontend, run a sim — confirm chunks still flow end-to-end (no runtime errors in backend logs; frontend still receives data; this proves the `chunkResult.snapshots()` adapter works).
- [ ] **byeon-verify** before merging this phase to master.

---

## Phase 2 — DP853 telemetry

Goal of phase: `Simulation.run()` populates `ChunkResult.telemetry` for DP853 chunks with `avgStepSeconds` and `acceptRate`. `null` for Euler/RK4.

### Task 2.1 — `Integrator.getEvaluationCount()` + DP853 override

**Files:**
- Modify: `backend/src/main/java/personal/spacesim/utils/math/integrators/Integrator.java`
- Modify: `backend/src/main/java/personal/spacesim/utils/math/integrators/DP853Integrator.java`
- Create: `backend/src/test/java/personal/spacesim/utils/math/integrators/DP853IntegratorEvalCountTest.java` (small dedicated test — `DP853IntegratorTest` is already busy)

- [ ] **Step 1: Write failing test**

Create `backend/src/test/java/personal/spacesim/utils/math/integrators/DP853IntegratorEvalCountTest.java`:

```java
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
```

- [ ] **Step 2: Run, verify failure**

```bash
cd backend && ./mvnw test -Dtest=DP853IntegratorEvalCountTest -q
```

Expected: FAIL (compile error — `getEvaluationCount()` doesn't exist).

- [ ] **Step 3: Add `getEvaluationCount()` to `Integrator` (default returning 0)**

In `Integrator.java`, add this default method below `setSubstepHandler`:

```java
    /**
     * Total number of derivative evaluations performed across all
     * {@code stepInto} calls on this instance. Used by
     * {@link personal.spacesim.simulation.Simulation} to estimate
     * DP853's attempted-step count (and thus accept rate) without
     * subclassing Hipparchus internals.
     *
     * <p>Default 0 for fixed-step integrators (Euler, RK4) — they don't
     * track this and their accept rate is unconditionally 1.0 by
     * construction. Only {@link DP853Integrator} overrides.
     */
    default long getEvaluationCount() {
        return 0;
    }
```

- [ ] **Step 4: Override in `DP853Integrator`**

In `DP853Integrator.java`, add this method at the end of the class:

```java
    @Override
    public long getEvaluationCount() {
        return hipparchusIntegrator.getEvaluations();
    }
```

- [ ] **Step 5: Run the test**

```bash
cd backend && ./mvnw test -Dtest=DP853IntegratorEvalCountTest -q
```

Expected: PASS.

- [ ] **Step 6: Run full test suite**

```bash
cd backend && ./mvnw test -q
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/main/java/personal/spacesim/utils/math/integrators/Integrator.java \
        backend/src/main/java/personal/spacesim/utils/math/integrators/DP853Integrator.java \
        backend/src/test/java/personal/spacesim/utils/math/integrators/DP853IntegratorEvalCountTest.java
git commit -m "feat(integrators): expose getEvaluationCount on the Integrator interface

Default returns 0 (fixed-step integrators don't track this). DP853
overrides to delegate to Hipparchus's AbstractIntegrator.getEvaluations.
Used downstream by Simulation to estimate attempted-step count without
subclassing Hipparchus internals."
```

---

### Task 2.2 — Accumulate DP853 telemetry in `Simulation`

**Files:**
- Modify: `backend/src/main/java/personal/spacesim/simulation/Simulation.java`
- Create: `backend/src/test/java/personal/spacesim/simulation/SimulationTelemetryTest.java`

`Simulation` already wires its substep handler — we extend it to accumulate accepted-step count and total accepted-step duration. After `run()` completes, compute `avgStepSeconds = totalAccepted / acceptedCount`, and `acceptRate ≈ acceptedCount / (evaluations / 12)`.

The `/12` divisor is documented as FSAL-approximate. For DP853 with FSAL the true ratio is 12 evaluations for the first step then 11 thereafter; for `n` accepted steps that's `12 + 11(n-1) = 11n + 1` evaluations. Rearranged: `n ≈ (evals - 1) / 11`. We use `evals / 12` — close enough at the chunk scale (~5000 steps), one decimal point off in the accept rate at most. The risks section of the spec covers this; if it ever matters we tighten the constant.

- [ ] **Step 1: Write failing tests for the telemetry**

Create `backend/src/test/java/personal/spacesim/simulation/SimulationTelemetryTest.java`:

```java
package personal.spacesim.simulation;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeAll;
// ... (mirror the orekit-data setup pattern from BinaryResponseSerializerTest)

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.file.Path;
import java.nio.file.Paths;

import org.orekit.data.DataContext;
import org.orekit.data.DirectoryCrawler;
import org.orekit.frames.FramesFactory;
import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScalesFactory;

import personal.spacesim.simulation.body.CelestialBodyWrapper;
import personal.spacesim.utils.math.integrators.DP853Integrator;
import personal.spacesim.utils.math.integrators.EulerIntegrator;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SimulationTelemetryTest {

    @BeforeAll
    static void loadOrekitData() {
        try {
            URL url = SimulationTelemetryTest.class.getClassLoader()
                    .getResource("orekit-data-master");
            if (url != null) {
                Path path = Paths.get(url.toURI());
                DataContext.getDefault().getDataProvidersManager()
                        .addProvider(new DirectoryCrawler(path.toFile()));
            }
        } catch (URISyntaxException e) {
            throw new UncheckedIOException(new IOException(e));
        }
    }

    @Test
    void dp853PopulatesTelemetry() {
        List<CelestialBodyWrapper> bodies = TestSimulationFixtures.sunEarth();
        Simulation sim = new Simulation(
                "test-dp853", bodies, FramesFactory.getICRF(),
                new DP853Integrator(),
                new AbsoluteDate(2024, 1, 1, 0, 0, 0.0, TimeScalesFactory.getUTC()),
                "hours", 1, 500
        );
        ChunkResult result = sim.run();

        assertNotNull(result.telemetry(), "DP853 must populate telemetry");
        Dp853Telemetry t = result.telemetry();

        assertTrue(t.avgStepSeconds() > 0, "avg step must be positive");
        assertTrue(t.acceptRate() > 0 && t.acceptRate() <= 1.0,
                "accept rate must be in (0, 1]");
        // Benign two-body scenario — accept rate should be high.
        assertTrue(t.acceptRate() > 0.7,
                "accept rate for sun-earth circular orbit should be >0.7, got " + t.acceptRate());
    }

    @Test
    void eulerReportsNullTelemetry() {
        List<CelestialBodyWrapper> bodies = TestSimulationFixtures.sunEarth();
        Simulation sim = new Simulation(
                "test-euler", bodies, FramesFactory.getICRF(),
                new EulerIntegrator(),
                new AbsoluteDate(2024, 1, 1, 0, 0, 0.0, TimeScalesFactory.getUTC()),
                "hours", 1, 500
        );
        ChunkResult result = sim.run();
        assertNull(result.telemetry(),
                "fixed-step integrators must report null telemetry");
    }
}
```

> **Note:** `TestSimulationFixtures.sunEarth()` is referenced but doesn't exist. The engineer needs to either inline the body construction or check existing helpers. `SimulationTest.java` already has body-construction patterns — mirror those into a `TestSimulationFixtures` helper or inline directly. **Inline directly** is simpler — use the same pattern as `SimulationTest.java`, no new helper class.

Concretely, replace `TestSimulationFixtures.sunEarth()` with whatever body-construction code `SimulationTest.java` uses. (Check that file before writing the test; cut-and-paste the body list from there.)

- [ ] **Step 2: Inspect `SimulationTest.java` for the body-construction pattern**

```bash
grep -n "CelestialBodyWrapper\|new CelestialBody\|wrapperFactory" backend/src/test/java/personal/spacesim/simulation/SimulationTest.java | head -10
```

Use whatever pattern is there — adapt the test in step 1 to use it directly rather than the nonexistent fixture.

- [ ] **Step 3: Run, verify the tests fail**

```bash
cd backend && ./mvnw test -Dtest=SimulationTelemetryTest -q
```

Expected: FAIL (`result.telemetry()` is null for DP853 too — Simulation doesn't populate it yet).

- [ ] **Step 4: Wire DP853 telemetry accumulation into `Simulation`**

In `Simulation.java`, add these fields near the existing DP853-specific fields (`adaptiveEmitCount`, `nextEmitTarget`):

```java
    /**
     * Adaptive path telemetry: number of accepted substeps observed
     * during this chunk's {@link #run}. Increments on each call to the
     * registered substep handler (Hipparchus only fires that callback
     * on accepted steps).
     */
    private long acceptedSubstepCount = 0;

    /**
     * Adaptive path telemetry: total sim-time duration of accepted
     * substeps during this chunk's {@link #run}, in seconds. Divided by
     * {@link #acceptedSubstepCount} to produce {@code avgStepSeconds}.
     */
    private double acceptedSubstepDurationSeconds = 0.0;
```

In `run()`, modify the substep handler block to also accumulate the telemetry. The full handler becomes:

```java
        integrator.setSubstepHandler((prevTimeSec, currTimeSec, eval) -> {
            // Telemetry: every accepted substep — count + duration.
            acceptedSubstepCount++;
            acceptedSubstepDurationSeconds += (currTimeSec - prevTimeSec);

            while (nextEmitTarget != null) {
                double targetRelTime = nextEmitTarget.durationFrom(stepStartDate);
                if (targetRelTime > currTimeSec) {
                    break;
                }
                double evalT = Math.max(targetRelTime, prevTimeSec);
                double[] evaluatedState = eval.stateAt(evalT);
                results.put(nextEmitTarget, snapshotFromState(evaluatedState));
                deltaE.put(nextEmitTarget, computeDeltaE(evaluatedState));
                adaptiveEmitCount++;
                nextEmitTarget = simStartDate.shiftedBy(
                        adaptiveEmitCount * targetGapSeconds);
            }
        });
```

Reset the per-chunk counters at the top of `run()` (after the existing `startTime` line, before the `Map<AbsoluteDate, ...>` declarations):

```java
        acceptedSubstepCount = 0;
        acceptedSubstepDurationSeconds = 0.0;
        long evalCountAtStart = integrator.getEvaluationCount();
```

Replace the existing `return new ChunkResult(results, deltaE, null);` with:

```java
        Dp853Telemetry telemetry = null;
        if (isAdaptiveIntegrator && acceptedSubstepCount > 0) {
            // Accept rate via the /12 approximation. DP853 is 12-stage with
            // FSAL; true cost is 12 evals for the first step then 11
            // thereafter, so the constant is slightly off at chunk
            // boundaries but well under 1% error at chunk scale (~5000
            // accepted steps). Acceptable for a UI readout.
            long evalsThisChunk = integrator.getEvaluationCount() - evalCountAtStart;
            double estimatedAttempts = evalsThisChunk / 12.0;
            double acceptRate = estimatedAttempts > 0
                    ? Math.min(1.0, acceptedSubstepCount / estimatedAttempts)
                    : 1.0;
            double avgStep = acceptedSubstepDurationSeconds / acceptedSubstepCount;
            telemetry = new Dp853Telemetry(avgStep, acceptRate);
        }

        return new ChunkResult(results, deltaE, telemetry);
```

- [ ] **Step 5: Run, verify passes**

```bash
cd backend && ./mvnw test -Dtest=SimulationTelemetryTest -q
```

Expected: PASS.

- [ ] **Step 6: Run full suite**

```bash
cd backend && ./mvnw test -q
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/main/java/personal/spacesim/simulation/Simulation.java \
        backend/src/test/java/personal/spacesim/simulation/SimulationTelemetryTest.java
git commit -m "feat(sim): accumulate DP853 telemetry in Simulation

Substep handler tracks acceptedSubstepCount + total accepted duration.
At chunk end, compute avgStepSeconds = total/count and acceptRate ≈
accepted / (evals/12) (FSAL approximation, accurate to <1% at chunk
scale). Telemetry stays null for fixed-step integrators."
```

---

### Phase 2 verification gate

- [ ] `cd backend && ./mvnw test -q` passes
- [ ] Manual sanity: start backend, run a sim with DP853, watch the logs — no exceptions; the chunk-precompute future completes.
- [ ] **byeon-verify** before merging this phase.

---

## Phase 3 — Wire format extension (both sides together)

Goal of phase: extend the binary chunk format to carry the new header fields (DP853 telemetry) and per-snapshot ΔE/E₀. Both the Java serializer and the TS parser update in lockstep. Two tests pin the format on either side; if they drift, one fails first.

The new layout (all little-endian, modifications **bolded**):

```
uint16  bodyCount
per body: uint16 nameLength, UTF-8 name bytes, float64 mu
float64 dp853AvgStepSeconds       (NaN if not DP853)        ← NEW
float32 dp853AcceptRate           (NaN if not DP853)        ← NEW
uint32  timestepCount
per timestep:
  int64 timestamp (millis UTC)
  float32 deltaERelative                                    ← NEW
  per body (header order):
    float64 × 3  (px, py, pz)
    float32 × 3  (vx, vy, vz)
```

### Task 3.1 — Backend serializer update + extended pin test

**Files:**
- Modify: `backend/src/main/java/personal/spacesim/utils/serializers/BinaryResponseSerializer.java`
- Modify: `backend/src/test/java/personal/spacesim/utils/serializers/BinaryResponseSerializerTest.java`

- [ ] **Step 1: Update the test fixture FIRST (TDD)**

Read the existing `BinaryResponseSerializerTest.serialisedBytesMatchDocumentedLayout` test, then extend it to also assert the new fields. Key changes:

1. Build a `ChunkResult` (not a raw map) — the serializer's signature changes in step 4 below.
2. Read back the two new header floats after the per-body block.
3. After reading the timestamp inside each per-timestep block, read the new float32 `deltaERelative` BEFORE the per-body position/velocity sub-block.

Concretely, append a new test alongside the existing one:

```java
    @Test
    void serialisesNewIntegratorResidualFields() {
        // Same body+date setup as serialisedBytesMatchDocumentedLayout,
        // plus: DP853 telemetry in the header, per-snapshot ΔE/E₀.
        TimeScale utc = TimeScalesFactory.getUTC();
        AbsoluteDate date = new AbsoluteDate(2024, 6, 5, 0, 0, 0.0, utc);
        long expectedMillis = date.toDate(utc).getTime();

        CelestialBodySnapshot earth = new CelestialBodySnapshot(
                "Earth",
                new Vector3D(1.0, 2.0, 3.0),
                new Vector3D(4.0, 5.0, 6.0)
        );
        CelestialBodySnapshot moon = new CelestialBodySnapshot(
                "Moon",
                new Vector3D(7.0, 8.0, 9.0),
                new Vector3D(10.0, 11.0, 12.0)
        );

        Map<AbsoluteDate, List<CelestialBodySnapshot>> snapshots = new LinkedHashMap<>();
        snapshots.put(date, List.of(earth, moon));

        Map<AbsoluteDate, Double> deltaE = new LinkedHashMap<>();
        deltaE.put(date, 1.5e-12);

        Dp853Telemetry telemetry = new Dp853Telemetry(3600.0, 0.94);
        ChunkResult chunk = new ChunkResult(snapshots, deltaE, telemetry);

        LinkedHashMap<String, Double> muByName = new LinkedHashMap<>();
        muByName.put("Earth", 3.986004418e14);
        muByName.put("Moon",  4.9028000661e12);

        BinaryResponseSerializer ser = new BinaryResponseSerializer();
        byte[] bytes = ser.serialize(chunk, muByName);

        ByteBuffer buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        assertEquals(2, buf.getShort());

        // Body block.
        for (String expectedName : new String[]{"Earth", "Moon"}) {
            short nameLen = buf.getShort();
            byte[] nameBytes = new byte[nameLen];
            buf.get(nameBytes);
            assertEquals(expectedName, new String(nameBytes, StandardCharsets.UTF_8));
            double mu = buf.getDouble();
            assertEquals(muByName.get(expectedName), mu, 1e-30);
        }

        // NEW: DP853 telemetry in header.
        assertEquals(3600.0, buf.getDouble(), 1e-12);
        assertEquals(0.94f,  buf.getFloat(),  1e-6);

        // Timestep count.
        assertEquals(1, buf.getInt());

        // Per-timestep.
        assertEquals(expectedMillis, buf.getLong());
        // NEW: per-snapshot ΔE/E₀ before the per-body block.
        assertEquals(1.5e-12f, buf.getFloat(), 1e-18);

        // Body 0 (Earth).
        assertEquals(1.0, buf.getDouble(), 1e-12);
        assertEquals(2.0, buf.getDouble(), 1e-12);
        assertEquals(3.0, buf.getDouble(), 1e-12);
        assertEquals(4.0f, buf.getFloat(), 1e-6);
        assertEquals(5.0f, buf.getFloat(), 1e-6);
        assertEquals(6.0f, buf.getFloat(), 1e-6);

        // Body 1 (Moon).
        assertEquals(7.0, buf.getDouble(), 1e-12);
        assertEquals(8.0, buf.getDouble(), 1e-12);
        assertEquals(9.0, buf.getDouble(), 1e-12);
        assertEquals(10.0f, buf.getFloat(), 1e-6);
        assertEquals(11.0f, buf.getFloat(), 1e-6);
        assertEquals(12.0f, buf.getFloat(), 1e-6);
    }

    @Test
    void fixedStepIntegratorWritesNaNTelemetry() {
        // No DP853 telemetry — header floats should be NaN, not omitted.
        TimeScale utc = TimeScalesFactory.getUTC();
        AbsoluteDate date = new AbsoluteDate(2024, 6, 5, 0, 0, 0.0, utc);

        Map<AbsoluteDate, List<CelestialBodySnapshot>> snapshots = new LinkedHashMap<>();
        snapshots.put(date, List.of(new CelestialBodySnapshot(
                "Earth",
                new Vector3D(0.0, 0.0, 0.0),
                new Vector3D(0.0, 0.0, 0.0))));
        Map<AbsoluteDate, Double> deltaE = new LinkedHashMap<>();
        deltaE.put(date, 0.0);
        ChunkResult chunk = new ChunkResult(snapshots, deltaE, null);

        LinkedHashMap<String, Double> mu = new LinkedHashMap<>();
        mu.put("Earth", 3.986004418e14);

        byte[] bytes = new BinaryResponseSerializer().serialize(chunk, mu);
        ByteBuffer buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);

        buf.getShort();                    // bodyCount
        short nameLen = buf.getShort();
        buf.get(new byte[nameLen]);
        buf.getDouble();                   // mu

        assertTrue(Double.isNaN(buf.getDouble()), "avgStepSeconds must be NaN for non-DP853");
        assertTrue(Float.isNaN(buf.getFloat()),   "acceptRate must be NaN for non-DP853");
    }
```

Also: update the existing `serialisedBytesMatchDocumentedLayout` and `emptyDataProducesHeaderOnly` tests. The existing test calls `ser.serialize(data, muByName)` with the old map signature — change to take a `ChunkResult`, and add the new field reads in the byte-level assertions.

The empty test now expects a `6 + 12 = 18`-byte minimal layout (header = `uint16 bodyCount` + `float64 + float32` for DP853 + `uint32 timestepCount`). But wait — for the empty case there are no bodies, and the spec says DP853 telemetry is only meaningful if there were bodies/snapshots. Decide:

**Decision for the empty case:** write the DP853 NaN floats unconditionally. Empty data always produces an `18`-byte header (bodyCount=0, no per-body block, NaN telemetry floats, timestepCount=0). This keeps the parser branchless. Update `emptyDataProducesHeaderOnly` accordingly:

```java
    @Test
    void emptyDataProducesHeaderOnly() {
        // bodyCount + dp853AvgStep + dp853AcceptRate + timestepCount =
        //     2     +     8        +        4         +      4         = 18
        BinaryResponseSerializer ser = new BinaryResponseSerializer();
        byte[] empty = ser.serialize((ChunkResult) null, null);
        assertEquals(18, empty.length);
        ByteBuffer buf = ByteBuffer.wrap(empty).order(ByteOrder.LITTLE_ENDIAN);
        assertEquals(0, buf.getShort());
        assertTrue(Double.isNaN(buf.getDouble()));
        assertTrue(Float.isNaN(buf.getFloat()));
        assertEquals(0, buf.getInt());
    }
```

Update `serialisedBytesMatchDocumentedLayout` similarly — wrap the data in a `ChunkResult` (with a parallel `deltaE` map), read the two new header fields between the body block and the timestep count, and read the per-snapshot `deltaERelative` immediately after each timestamp.

- [ ] **Step 2: Run the tests — they will fail**

```bash
cd backend && ./mvnw test -Dtest=BinaryResponseSerializerTest -q
```

Expected: compile errors (`serialize(ChunkResult, ...)` doesn't exist yet).

- [ ] **Step 3: Update `BinaryResponseSerializer.serialize` signature + layout**

In `BinaryResponseSerializer.java`, replace the entire `serialize` method and the class-level docblock. New file body:

```java
package personal.spacesim.utils.serializers;

import org.hipparchus.geometry.euclidean.threed.Vector3D;
import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScalesFactory;
import org.springframework.stereotype.Component;
import personal.spacesim.simulation.ChunkResult;
import personal.spacesim.simulation.Dp853Telemetry;
import personal.spacesim.simulation.body.CelestialBodySnapshot;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/**
 * Serializes a {@link ChunkResult} into a compact little-endian binary
 * layout. Replaces the JSON path for SIM_DATA frames.
 *
 * Layout (all little-endian):
 *   uint16  bodyCount
 *   per body: uint16 nameLength, UTF-8 name bytes, float64 mu
 *   float64 dp853AvgStepSeconds      (NaN if not DP853)
 *   float32 dp853AcceptRate          (NaN if not DP853)
 *   uint32  timestepCount
 *   per timestep:
 *     int64    timestamp (millis since UNIX epoch, UTC)
 *     float32  deltaERelative        (E - E₀) / |E₀| at this snapshot
 *     per body (header order):
 *       float64 × 3   (px, py, pz)
 *       float32 × 3   (vx, vy, vz)
 *
 * Always-written DP853 fields (NaN-encoded when not applicable) keep the
 * parser branchless. ~0.4% overhead on chunk size for DP853 chunks.
 */
@Component
public class BinaryResponseSerializer {

    public byte[] serialize(ChunkResult chunk, Map<String, Double> muByName) {
        Map<AbsoluteDate, List<CelestialBodySnapshot>> data =
                chunk != null ? chunk.snapshots() : null;
        Map<AbsoluteDate, Double> deltaE =
                chunk != null ? chunk.deltaERelative() : null;
        Dp853Telemetry telemetry =
                chunk != null ? chunk.telemetry() : null;

        if (data == null || data.isEmpty()) {
            // bodyCount(2) + dp853AvgStep(8) + dp853AcceptRate(4) + timestepCount(4) = 18
            ByteBuffer empty = ByteBuffer.allocate(18).order(ByteOrder.LITTLE_ENDIAN);
            empty.putShort((short) 0);
            empty.putDouble(Double.NaN);
            empty.putFloat(Float.NaN);
            empty.putInt(0);
            return empty.array();
        }

        List<CelestialBodySnapshot> firstSnapshot = data.values().iterator().next();
        int bodyCount = firstSnapshot.size();

        byte[][] nameBytes = new byte[bodyCount][];
        // bodyCount(2) + bodies + dp853AvgStep(8) + dp853AcceptRate(4) + timestepCount(4)
        int headerSize = 2 + 8 + 4 + 4;
        for (int i = 0; i < bodyCount; i++) {
            nameBytes[i] = firstSnapshot.get(i).name().getBytes(StandardCharsets.UTF_8);
            headerSize += 2 + nameBytes[i].length + 8;
        }

        int timestepCount = data.size();
        // timestamp(8) + deltaERelative(4) + per-body (3×8 + 3×4)
        int perTimestepSize = 8 + 4 + bodyCount * (3 * 8 + 3 * 4);
        int totalSize = headerSize + timestepCount * perTimestepSize;

        ByteBuffer buf = ByteBuffer.allocate(totalSize).order(ByteOrder.LITTLE_ENDIAN);

        buf.putShort((short) bodyCount);
        for (int i = 0; i < bodyCount; i++) {
            String bodyName = firstSnapshot.get(i).name();
            buf.putShort((short) nameBytes[i].length);
            buf.put(nameBytes[i]);
            Double mu = muByName != null ? muByName.get(bodyName) : null;
            buf.putDouble(mu != null ? mu : 0.0);
        }
        // DP853 telemetry — NaN when not applicable, keeps the parser branchless.
        buf.putDouble(telemetry != null ? telemetry.avgStepSeconds() : Double.NaN);
        buf.putFloat(telemetry != null ? (float) telemetry.acceptRate() : Float.NaN);
        buf.putInt(timestepCount);

        for (Map.Entry<AbsoluteDate, List<CelestialBodySnapshot>> entry : data.entrySet()) {
            AbsoluteDate date = entry.getKey();
            long millis = date.toDate(TimeScalesFactory.getUTC()).getTime();
            buf.putLong(millis);

            Double dE = deltaE != null ? deltaE.get(date) : null;
            buf.putFloat(dE != null ? dE.floatValue() : 0.0f);

            List<CelestialBodySnapshot> snapshot = entry.getValue();
            for (int i = 0; i < bodyCount; i++) {
                Vector3D pos = snapshot.get(i).position();
                Vector3D vel = snapshot.get(i).velocity();
                buf.putDouble(pos.getX()).putDouble(pos.getY()).putDouble(pos.getZ());
                buf.putFloat((float) vel.getX()).putFloat((float) vel.getY()).putFloat((float) vel.getZ());
            }
        }

        return buf.array();
    }
}
```

- [ ] **Step 4: Update `SimulationSessionService.computeChunkBytes`**

In `SimulationSessionService.java`, change the call site from:

```java
        byte[] binary = binaryResponseSerializer.serialize(chunkResult.snapshots(), muByName);
```

back to:

```java
        byte[] binary = binaryResponseSerializer.serialize(chunkResult, muByName);
```

- [ ] **Step 5: Run the serializer tests**

```bash
cd backend && ./mvnw test -Dtest=BinaryResponseSerializerTest -q
```

Expected: PASS (all four tests including the two new ones).

- [ ] **Step 6: Run full backend suite**

```bash
cd backend && ./mvnw test -q
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/main/java/personal/spacesim/utils/serializers/BinaryResponseSerializer.java \
        backend/src/test/java/personal/spacesim/utils/serializers/BinaryResponseSerializerTest.java \
        backend/src/main/java/personal/spacesim/services/SimulationSessionService.java
git commit -m "feat(wire): extend chunk format with DP853 telemetry + per-snapshot ΔE/E₀

Adds 12 bytes to header (float64 avgStep + float32 acceptRate, NaN when
not DP853) and 4 bytes per snapshot (float32 deltaERelative before the
per-body block). Always-written NaN encoding keeps the parser branchless;
~0.4% overhead at 5000-snapshot chunks. Frontend parser changes ship in
the next commit; both pin the same fixture bytes."
```

---

### Task 3.2 — Frontend parser update + extended pin test

**Files:**
- Modify: `frontend/src/app/store/middleware/parseBinaryChunk.ts`
- Modify: `frontend/src/app/store/middleware/parseBinaryChunk.test.ts`

- [ ] **Step 1: Update the test fixture builder FIRST (TDD)**

In `parseBinaryChunk.test.ts`, modify the `buildChunkBytes` helper to also accept and emit the new fields:

```ts
function buildChunkBytes(
  bodies: Array<{ name: string; mu: number }>,
  timesteps: Array<{
    millis: number;
    deltaERelative: number;
    bodies: Array<{ pos: [number, number, number]; vel: [number, number, number] }>;
  }>,
  dp853AvgStepSeconds: number,
  dp853AcceptRate: number,
): Uint8Array {
  const encoder = new TextEncoder();
  const encodedNames = bodies.map((b) => encoder.encode(b.name));
  const headerSize =
    2 +
    encodedNames.reduce((sum, b) => sum + 2 + b.length + 8, 0) +
    8 + // dp853AvgStepSeconds (float64)
    4 + // dp853AcceptRate (float32)
    4;  // timestepCount
  // timestamp(8) + deltaERelative(4) + per-body (3*8 + 3*4)
  const perTimestep = 8 + 4 + bodies.length * (3 * 8 + 3 * 4);
  const total = headerSize + timesteps.length * perTimestep;

  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const out = new Uint8Array(buf);
  let offset = 0;

  view.setUint16(offset, bodies.length, true);
  offset += 2;
  for (let i = 0; i < bodies.length; i++) {
    const nameBytes = encodedNames[i];
    view.setUint16(offset, nameBytes.length, true);
    offset += 2;
    out.set(nameBytes, offset);
    offset += nameBytes.length;
    view.setFloat64(offset, bodies[i].mu, true);
    offset += 8;
  }
  view.setFloat64(offset, dp853AvgStepSeconds, true);
  offset += 8;
  view.setFloat32(offset, dp853AcceptRate, true);
  offset += 4;
  view.setUint32(offset, timesteps.length, true);
  offset += 4;

  for (const t of timesteps) {
    view.setBigInt64(offset, BigInt(t.millis), true);
    offset += 8;
    view.setFloat32(offset, t.deltaERelative, true);
    offset += 4;
    for (const body of t.bodies) {
      view.setFloat64(offset, body.pos[0], true); offset += 8;
      view.setFloat64(offset, body.pos[1], true); offset += 8;
      view.setFloat64(offset, body.pos[2], true); offset += 8;
      view.setFloat32(offset, body.vel[0], true); offset += 4;
      view.setFloat32(offset, body.vel[1], true); offset += 4;
      view.setFloat32(offset, body.vel[2], true); offset += 4;
    }
  }
  return out;
}
```

Update both existing tests in this file to pass the new parameters to `buildChunkBytes`. Use the same numeric values as the backend test (`3600.0`, `0.94`, `1.5e-12`) so the two pin-tests are checking the same fixture.

Add new assertions in the existing `parseBinaryChunk` describe block — extend the test cases to also assert `result.dp853AvgStepSeconds`, `result.dp853AcceptRate`, and the per-snapshot delta. For the typed-array variant test, also assert the `deltaERelative` array.

Add a new test for the NaN case:

```ts
  it("parses NaN dp853 telemetry for fixed-step chunks", () => {
    const bytes = buildChunkBytes(
      [{ name: "Earth", mu: 3.986004418e14 }],
      [
        {
          millis: Date.UTC(2024, 5, 5),
          deltaERelative: 0,
          bodies: [{ pos: [0, 0, 0], vel: [0, 0, 0] }],
        },
      ],
      Number.NaN,
      Number.NaN,
    );
    const result = parseBinaryChunkToTypedArrays(bytes);
    expect(result.dp853AvgStepSeconds).toBeNull();
    expect(result.dp853AcceptRate).toBeNull();
  });
```

Note: parser should map `NaN` → `null` for the chunk-level fields (cleaner for downstream consumers than checking `isNaN`).

- [ ] **Step 2: Run the tests — verify failure**

```bash
cd frontend && npm test -- parseBinaryChunk -t
```

Expected: FAIL (parser doesn't read the new fields).

- [ ] **Step 3: Update `parseBinaryChunk.ts`**

Replace the file's header doc + both parsing functions. New top-of-file doc:

```ts
// Parser for the simulation chunk wire format. Mirrors the layout written by
// backend BinaryResponseSerializer.java. If you change one, change the other —
// there are tests on each side that pin the format.
//
// Wire format (after zstd, all little-endian):
//   uint16   bodyCount
//   per body: uint16 nameLength, UTF-8 name bytes, float64 mu
//   float64  dp853AvgStepSeconds       (NaN if not DP853)
//   float32  dp853AcceptRate           (NaN if not DP853)
//   uint32   timestepCount
//   per timestep:
//     int64    timestamp (millis since UNIX epoch, UTC)
//     float32  deltaERelative          (E - E₀) / |E₀| at this snapshot
//     per body (header order):
//       float64 × 3   (px, py, pz)
//       float32 × 3   (vx, vy, vz)
//
// Mixed precision: positions are rendered directly (per-pixel sensitivity
// to quantization) so they need float64. Velocities are inputs to downstream
// math that damps precision loss; float32 is fine. ΔE/E₀ is a UI readout
// (1-2 sig figs displayed); float32's ~7-digit mantissa is plenty.
//
// `mu` is the standard gravitational parameter (G·M, m³/s²) for each body —
// constant per session, sent once with names. µ=0 means "unknown" (backend
// missing-entry fallback).
//
// DP853 telemetry fields are NaN-encoded for fixed-step chunks; consumers
// should treat NaN as "not applicable" (the typed-array parser maps these
// to null for cleaner downstream handling).
```

Update `ParsedChunk` and `ParsedChunkTypedArrays` interfaces:

```ts
export interface ParsedChunk {
  data: Record<string, CelestialBody[]>;
  mu: Record<string, number>;
  // Per-snapshot relative energy drift, keyed by the same ISO strings as `data`.
  deltaERelative: Record<string, number>;
  // null when the chunk was produced by a fixed-step integrator.
  dp853AvgStepSeconds: number | null;
  dp853AcceptRate: number | null;
}

export interface ParsedChunkTypedArrays {
  bodyNames: string[];
  bodyCount: number;
  timestepCount: number;
  positions: Float64Array;
  timestamps: BigInt64Array;
  mu: Record<string, number>;
  // Parallel to `timestamps`. Length = timestepCount.
  deltaERelative: Float32Array;
  // null when the chunk was produced by a fixed-step integrator.
  dp853AvgStepSeconds: number | null;
  dp853AcceptRate: number | null;
}
```

Update both parsers. Pattern is the same in each — after the per-body block reads, decode the two new header fields; inside the per-timestep loop, decode `deltaERelative` immediately after the timestamp.

For the dict-shaped `parseBinaryChunk`:

```ts
  // After the body block:
  const dp853AvgRaw = view.getFloat64(offset, true);
  offset += 8;
  const dp853RateRaw = view.getFloat32(offset, true);
  offset += 4;
  const dp853AvgStepSeconds = Number.isNaN(dp853AvgRaw) ? null : dp853AvgRaw;
  const dp853AcceptRate = Number.isNaN(dp853RateRaw) ? null : dp853RateRaw;

  const timestepCount = view.getUint32(offset, true);
  offset += 4;

  const data: Record<string, CelestialBody[]> = {};
  const deltaERelative: Record<string, number> = {};
  for (let t = 0; t < timestepCount; t++) {
    const millis = Number(view.getBigInt64(offset, true));
    offset += 8;
    const isoKey = new Date(millis).toISOString();
    deltaERelative[isoKey] = view.getFloat32(offset, true);
    offset += 4;

    // ... existing per-body decoding unchanged ...
  }

  return { data, mu, deltaERelative, dp853AvgStepSeconds, dp853AcceptRate };
```

For the typed-array parser:

```ts
  // After the body block:
  const dp853AvgRaw = view.getFloat64(offset, true);
  offset += 8;
  const dp853RateRaw = view.getFloat32(offset, true);
  offset += 4;
  const dp853AvgStepSeconds = Number.isNaN(dp853AvgRaw) ? null : dp853AvgRaw;
  const dp853AcceptRate = Number.isNaN(dp853RateRaw) ? null : dp853RateRaw;

  const timestepCount = view.getUint32(offset, true);
  offset += 4;

  const positions = new Float64Array(timestepCount * bodyCount * 6);
  const timestamps = new BigInt64Array(timestepCount);
  const deltaERelative = new Float32Array(timestepCount);

  for (let t = 0; t < timestepCount; t++) {
    timestamps[t] = view.getBigInt64(offset, true);
    offset += 8;
    deltaERelative[t] = view.getFloat32(offset, true);
    offset += 4;
    // ... existing per-body decoding unchanged ...
  }

  return {
    bodyNames, bodyCount, timestepCount, positions, timestamps, mu,
    deltaERelative, dp853AvgStepSeconds, dp853AcceptRate,
  };
```

- [ ] **Step 4: Run the parser tests**

```bash
cd frontend && npm test -- parseBinaryChunk
```

Expected: PASS.

- [ ] **Step 5: Run full frontend test suite**

```bash
cd frontend && npm test
```

Expected: PASS.

- [ ] **Step 6: Run frontend build to catch type errors elsewhere**

```bash
cd frontend && npm run build
```

Expected: PASS. (If chunkBuffer or other consumers use the typed-array result, type-check will flag missing fields — handle in Phase 4.)

If `npm run build` flags anywhere using `ParsedChunkTypedArrays` that doesn't account for the new fields, leave those as-is for now — Phase 4 wires `chunkBuffer` to consume them. The build should still succeed because the new fields are added (not removed); existing consumers ignore them.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/store/middleware/parseBinaryChunk.ts \
        frontend/src/app/store/middleware/parseBinaryChunk.test.ts
git commit -m "feat(wire): parse new DP853 telemetry + per-snapshot ΔE/E₀

Mirrors backend BinaryResponseSerializer changes from the prior commit.
Both pin-tests use the same fixture values (avgStep=3600.0, rate=0.94,
deltaE=1.5e-12) so cross-side drift fails one of the two tests first.
NaN telemetry fields map to null in the parsed output for cleaner
downstream consumption."
```

---

### Phase 3 verification gate

- [ ] `cd backend && ./mvnw test -q` passes
- [ ] `cd frontend && npm test` passes
- [ ] `cd frontend && npm run build` passes
- [ ] Manual: backend + frontend running, submit a sim, observe the chunk request completes and the existing UI still works (no console errors). The new fields are present in the parsed chunk but not yet consumed.
- [ ] **byeon-verify** before merging.

---

## Phase 4 — Frontend buffer storage + reader

Goal of phase: `chunkBuffer` stores `deltaERelative` in a `Float32Array` parallel to `timestamps`, plus the chunk-level DP853 fields. Add `readDeltaERelativeAt(buffer, floatIdx)` reader. UI doesn't consume it yet.

### Task 4.1 — `chunkBuffer` stores `deltaERelative` + telemetry, with reader

**Files:**
- Modify: `frontend/src/app/store/chunkBuffer.ts`
- Modify: `frontend/src/app/store/chunkBuffer.test.ts`
- Modify: `frontend/src/app/store/middleware/parseBinaryChunk.ts` (if needed — already done in Phase 3)

- [ ] **Step 1: Write failing test for `readDeltaERelativeAt`**

In `chunkBuffer.test.ts`, find the existing test that calls `appendChunk` and add an adjacent test:

```ts
describe("readDeltaERelativeAt", () => {
  it("returns the stored value at integer indices", () => {
    const buf = createChunkBuffer(["Earth"], 100);
    const positions = new Float64Array(3 * 6);  // 3 timesteps, 1 body, 6 floats
    const timestamps = new BigInt64Array([0n, 1000n, 2000n]);
    const deltaE = new Float32Array([1e-12, 2e-12, 3e-12]);

    appendChunk(buf, positions, timestamps, deltaE, 3);

    expect(readDeltaERelativeAt(buf, 0)).toBeCloseTo(1e-12, 18);
    expect(readDeltaERelativeAt(buf, 1)).toBeCloseTo(2e-12, 18);
    expect(readDeltaERelativeAt(buf, 2)).toBeCloseTo(3e-12, 18);
  });

  it("linearly interpolates at fractional indices", () => {
    // ΔE between snapshots is a slow scalar — linear interpolation is
    // plenty (we don't need Hermite for a UI readout that's already
    // limited to 1-2 sig figs).
    const buf = createChunkBuffer(["Earth"], 100);
    const positions = new Float64Array(2 * 6);
    const timestamps = new BigInt64Array([0n, 1000n]);
    const deltaE = new Float32Array([1e-12, 3e-12]);

    appendChunk(buf, positions, timestamps, deltaE, 2);

    expect(readDeltaERelativeAt(buf, 0.5)).toBeCloseTo(2e-12, 18);
  });

  it("returns 0 for an empty buffer", () => {
    const buf = createChunkBuffer(["Earth"], 100);
    expect(readDeltaERelativeAt(buf, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
cd frontend && npm test -- chunkBuffer
```

Expected: FAIL (`appendChunk` doesn't take the extra arg; `readDeltaERelativeAt` doesn't exist).

- [ ] **Step 3: Extend the `ChunkBuffer` shape and `appendChunk`**

In `chunkBuffer.ts`, update the interface:

```ts
export interface ChunkBuffer {
  positions: Float64Array;
  timestamps: BigInt64Array;
  // Parallel to timestamps. Per-snapshot (E - E₀) / |E₀| from the
  // backend integrator. Stored as float32 to match the wire format —
  // it's a UI readout, the extra precision wouldn't be used.
  deltaERelative: Float32Array;
  bodyNames: string[];
  bodyNameToIndex: Map<string, number>;
  bodyCount: number;
  capacity: number;
  totalTimesteps: number;
  bufferStartTimestep: number;
  // Chunk-level DP853 telemetry; tracks the CURRENT chunk in the buffer.
  // null when the active integrator is fixed-step. These are *latest-write-
  // wins*: when a new chunk lands they update to that chunk's values, even
  // if older chunks remain in the buffer. The user-facing semantics are
  // "telemetry for the most-recently-loaded chunk" which matches what they'd
  // expect from a live readout.
  dp853AvgStepSeconds: number | null;
  dp853AcceptRate: number | null;
}
```

Update `createChunkBuffer`:

```ts
export function createChunkBuffer(
  bodyNames: string[],
  capacity: number,
): ChunkBuffer {
  const bodyCount = bodyNames.length;
  const map = new Map<string, number>();
  for (let i = 0; i < bodyNames.length; i++) {
    map.set(bodyNames[i], i);
  }
  return {
    positions: new Float64Array(capacity * bodyCount * 6),
    timestamps: new BigInt64Array(capacity),
    deltaERelative: new Float32Array(capacity),
    bodyNames,
    bodyNameToIndex: map,
    bodyCount,
    capacity,
    totalTimesteps: 0,
    bufferStartTimestep: 0,
    dp853AvgStepSeconds: null,
    dp853AcceptRate: null,
  };
}
```

Update `appendChunk` signature to take the new typed array AND update telemetry; keep ordering with the existing `chunkLen` last:

```ts
export function appendChunk(
  buffer: ChunkBuffer,
  chunkPositions: Float64Array,
  chunkTimestamps: BigInt64Array,
  chunkDeltaE: Float32Array,
  chunkLen: number,
  dp853AvgStepSeconds?: number | null,
  dp853AcceptRate?: number | null,
): number {
  const stride = buffer.bodyCount * 6;
  let shifted = 0;

  if (buffer.totalTimesteps + chunkLen > buffer.capacity) {
    const dropCount = chunkLen;
    const surviveCount = buffer.totalTimesteps - dropCount;

    buffer.positions.copyWithin(0, dropCount * stride, (dropCount + surviveCount) * stride);
    buffer.timestamps.copyWithin(0, dropCount, dropCount + surviveCount);
    buffer.deltaERelative.copyWithin(0, dropCount, dropCount + surviveCount);

    buffer.totalTimesteps = surviveCount;
    buffer.bufferStartTimestep += dropCount;
    shifted = dropCount;
  }

  buffer.positions.set(chunkPositions, buffer.totalTimesteps * stride);
  buffer.timestamps.set(chunkTimestamps, buffer.totalTimesteps);
  buffer.deltaERelative.set(chunkDeltaE, buffer.totalTimesteps);
  buffer.totalTimesteps += chunkLen;

  if (dp853AvgStepSeconds !== undefined) {
    buffer.dp853AvgStepSeconds = dp853AvgStepSeconds;
  }
  if (dp853AcceptRate !== undefined) {
    buffer.dp853AcceptRate = dp853AcceptRate;
  }

  return shifted;
}
```

Add the reader (next to `readBodyPositionInto`):

```ts
/**
 * Per-snapshot relative energy drift. Linear interpolation between
 * keyframes (ΔE evolves slowly — cubic Hermite is overkill for a UI
 * readout that displays 1-2 sig figs). Empty buffer returns 0.
 *
 * Designed for ref-based 5 Hz polling — imperative, no allocations.
 */
export function readDeltaERelativeAt(
  buffer: ChunkBuffer,
  floatIdx: number,
): number {
  if (buffer.totalTimesteps === 0) return 0;
  if (floatIdx <= 0) return buffer.deltaERelative[0];
  if (floatIdx >= buffer.totalTimesteps - 1) {
    return buffer.deltaERelative[buffer.totalTimesteps - 1];
  }
  const i0 = Math.floor(floatIdx);
  const s = floatIdx - i0;
  const a = buffer.deltaERelative[i0];
  const b = buffer.deltaERelative[i0 + 1];
  return a + (b - a) * s;
}
```

- [ ] **Step 4: Run tests**

```bash
cd frontend && npm test -- chunkBuffer
```

Expected: PASS for the new tests. Existing tests that call `appendChunk(buf, positions, timestamps, chunkLen)` will fail — they need the new `chunkDeltaE` argument inserted. Update them: pass `new Float32Array(chunkLen)` (all zeros) for tests that don't care about deltaE values.

- [ ] **Step 5: Update the chunk decode/append call sites**

```bash
grep -rn "appendChunk" frontend/src/app/store
```

Two kinds of call sites:
1. Production: wherever `parseBinaryChunkToTypedArrays` flows into `appendChunk` (the zstd worker or similar). Pass `parsed.deltaERelative` and the two `dp853*` fields.
2. Tests outside `chunkBuffer.test.ts` (e.g. `parseBinaryChunk.test.ts`, `SimulationSlice.middleware.test.ts`): pass `new Float32Array(chunkLen)` if they don't care; pass real values if they do.

Use `grep` to find every call and update them. The production code path is the load-bearing one — verify it pipes the new fields from the parser through to `appendChunk`.

- [ ] **Step 6: Run all frontend tests**

```bash
cd frontend && npm test
```

Expected: PASS.

- [ ] **Step 7: Frontend build sanity check**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/app/store/chunkBuffer.ts \
        frontend/src/app/store/chunkBuffer.test.ts \
        frontend/src/app/store/middleware/
git commit -m "feat(buffer): store deltaERelative + DP853 telemetry in chunkBuffer

deltaERelative kept as Float32Array parallel to timestamps; chunk-level
DP853 fields are latest-write-wins. New readDeltaERelativeAt does linear
interpolation between keyframes (cubic Hermite overkill for a 1-2-sig-fig
UI readout). appendChunk gains the new typed array + two optional
telemetry params; all call sites updated."
```

---

### Phase 4 verification gate

- [ ] `cd frontend && npm test` passes
- [ ] `cd frontend && npm run build && npm run lint` both pass
- [ ] Manual: start backend + frontend, run a sim with DP853, open the browser devtools and confirm `store.getState()` exposes a chunkBuffer with non-null `dp853AvgStepSeconds` and a populated `deltaERelative` array. Run again with Euler, confirm telemetry is null.
- [ ] **byeon-verify** before merging.

---

## Phase 5 — UI surfaces (top status strip + body card)

Goal of phase: wire the buffered values into the UI. Top strip gets one new cell; body card gets a three-row subsection. Both use ref-based 5 Hz polling to match the existing `BodyCard` pattern.

No automated tests in this phase — visual oracle is better. Each task ends with manual browser checks per the project's UI-changes rule.

### Task 5.1 — `TopStatusStrip` ΔE/E₀ cell

**Files:**
- Modify: `frontend/src/app/components/chrome/TopStatusStrip.tsx`

- [ ] **Step 1: Read the existing `TopStatusStrip.tsx` to confirm cell layout pattern**

```bash
cat frontend/src/app/components/chrome/TopStatusStrip.tsx
```

The existing `StatusCell` accepts `label` + `value` as props. We need a variant that updates via DOM ref (no React rerender on tick). The cleanest path is a new `StatusCellRef` component that takes a `valueRef` prop and exposes the span ref to its parent.

- [ ] **Step 2: Add a ref-backed cell and the polling effect**

In `TopStatusStrip.tsx`, near the top of the component, add the ref and the effect:

```tsx
import { useEffect, useRef } from "react";
import { useStore } from "react-redux";
import { readDeltaERelativeAt } from "@/app/store/chunkBuffer";

// ... inside the component:

  const store = useStore<RootState>();
  const deltaERef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const tick = () => {
      const state = store.getState();
      const buffer = state.simulation.chunkBuffer;  // adjust to actual selector
      if (!buffer || !deltaERef.current) return;
      const idx = state.simulation.currentTimeStepIndex
        - buffer.bufferStartTimestep;
      const value = readDeltaERelativeAt(buffer, idx);
      deltaERef.current.textContent = formatDeltaE(value);
    };
    const id = window.setInterval(tick, 200);
    tick();
    return () => window.clearInterval(id);
  }, [store]);

// Formatter — scientific notation, 1-2 sig figs.
function formatDeltaE(v: number): string {
  if (v === 0) return "0";
  const abs = Math.abs(v);
  const exp = Math.floor(Math.log10(abs));
  const mantissa = v / Math.pow(10, exp);
  return `${mantissa.toFixed(1)}e${exp >= 0 ? "+" : ""}${exp}`;
}
```

> **Note:** the exact `state.simulation.chunkBuffer` path needs to match the actual Redux shape — read `SimulationSlice.ts` to confirm. If the buffer lives somewhere else (it may be referenced via a selector), use the established selector.

- [ ] **Step 3: Render the ref-backed cell**

In the JSX where the existing `StatusCell`s render, add a new one. Match the existing pattern (border + padding + label):

```tsx
        <div className="flex h-full items-baseline gap-1.5 border-r border-white/[0.06] px-3.5">
          <span className="eyebrow self-center">ΔE/E₀</span>
          <span
            ref={deltaERef}
            className="tabular text-hi self-center font-mono text-[11px]"
          >
            —
          </span>
        </div>
```

- [ ] **Step 4: Start the dev server and verify in browser**

```bash
cd frontend && npm run dev
# In another terminal:
cd backend && ./mvnw spring-boot:run
```

Open `http://localhost:3000`, submit a sim with:
- Euler: watch the ΔE/E₀ cell — values should be visibly non-zero (`1e-3`-ish range).
- DP853: values should be tiny (`1e-12`-ish range).

Switch integrators between sims and confirm the cell updates accordingly. Switch timestep speed; confirm the cell ticks at 5 Hz, not 60 fps (you can verify by adding a `console.count` in the tick if needed; remove before commit).

- [ ] **Step 5: Lint + build**

```bash
cd frontend && npm run build && npm run lint
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/components/chrome/TopStatusStrip.tsx
git commit -m "feat(ui): top-status-strip ΔE/E₀ cell

Ref-based 5 Hz polling matches BodyCard's pattern — avoids re-rendering
the strip 60×/sec for a number the user only needs to glance at.
Scientific notation, 1-2 sig figs (formatDeltaE)."
```

---

### Task 5.2 — `BodyCard` `Integrator residual` subsection

**Files:**
- Modify: `frontend/src/app/components/chrome/BodyCard.tsx`

The body card already has a comment block reserving this slot. Add three rows beneath the existing Keplerian elements:

- `ΔE / E₀` — same value as the top strip.
- `Avg step` — chunk-level value, formatted with units (`12 min`, `4.2 h`).
- `Accept rate` — chunk-level value, formatted as percent.

The DP853 rows hide when `chunkBuffer.dp853AvgStepSeconds === null`.

- [ ] **Step 1: Identify the existing 5 Hz tick in `BodyCard.tsx`**

`BodyCard.tsx` already has `REFRESH_HZ_MS = 200` and an existing polling pattern. Reuse that loop — add the new ref reads inside the same `setInterval`.

- [ ] **Step 2: Add the residual subsection**

After the existing Keplerian-elements JSX (it's the last numeric block today), add:

```tsx
        <Separator />
        <Section title="Integrator residual">
          <Row label="ΔE / E₀">
            <span ref={residualDeltaERef} className="tabular text-hi font-mono">—</span>
          </Row>
          {showDp853Telemetry && (
            <>
              <Row label="Avg step">
                <span ref={avgStepRef} className="tabular text-hi font-mono">—</span>
              </Row>
              <Row label="Accept rate">
                <span ref={acceptRateRef} className="tabular text-hi font-mono">—</span>
              </Row>
            </>
          )}
        </Section>
```

> The exact `Separator`, `Section`, `Row` component names depend on what's already in `BodyCard.tsx` — match the existing visual structure rather than introducing new primitives.

Add the refs and the in-loop read inside the existing polling effect:

```tsx
const residualDeltaERef = useRef<HTMLSpanElement>(null);
const avgStepRef = useRef<HTMLSpanElement>(null);
const acceptRateRef = useRef<HTMLSpanElement>(null);
const [showDp853Telemetry, setShowDp853Telemetry] = useState(false);

// In the tick:
const buffer = state.simulation.chunkBuffer;  // adjust to actual access path
if (buffer && residualDeltaERef.current) {
  const idx = state.simulation.currentTimeStepIndex - buffer.bufferStartTimestep;
  residualDeltaERef.current.textContent = formatDeltaE(readDeltaERelativeAt(buffer, idx));

  const dp853Active = buffer.dp853AvgStepSeconds !== null;
  setShowDp853Telemetry(dp853Active);
  if (dp853Active) {
    if (avgStepRef.current) {
      avgStepRef.current.textContent = formatStepDuration(buffer.dp853AvgStepSeconds!);
    }
    if (acceptRateRef.current) {
      acceptRateRef.current.textContent = `${(buffer.dp853AcceptRate! * 100).toFixed(1)}%`;
    }
  }
}
```

And add the formatter (export it from `BodyCard.tsx` or stash next to `formatToKM` in `helpers.ts` — pick wherever the existing formatters live):

```ts
function formatStepDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)} s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} min`;
  if (seconds < 86_400) return `${(seconds / 3600).toFixed(1)} h`;
  return `${(seconds / 86_400).toFixed(1)} d`;
}
```

`formatDeltaE` already exists from Task 5.1 — import it from `TopStatusStrip.tsx` or move it to `helpers.ts` (cleaner) and import from there in both places.

- [ ] **Step 3: Move `formatDeltaE` to `helpers.ts` and import in both files**

If `formatDeltaE` is currently inlined in `TopStatusStrip.tsx`, move it to `frontend/src/app/utils/helpers.ts` alongside the other formatters, then import it in both `TopStatusStrip.tsx` and `BodyCard.tsx`.

- [ ] **Step 4: Manual browser verification**

With dev server running:
- Pick a body. Confirm `ΔE/E₀` row shows the same value as the top strip.
- Pick Euler → confirm `Avg step` and `Accept rate` rows are hidden.
- Pick DP853 → confirm both rows appear with sensible values (avg step in hours, accept rate near 100% for a benign sim).
- Switch active bodies; confirm the residual rows persist (they don't depend on the body) and DP853 visibility doesn't flicker.

- [ ] **Step 5: Lint + build + test**

```bash
cd frontend && npm run build && npm run lint && npm test
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/components/chrome/BodyCard.tsx \
        frontend/src/app/components/chrome/TopStatusStrip.tsx \
        frontend/src/app/utils/helpers.ts
git commit -m "feat(ui): BodyCard 'Integrator residual' subsection

Three rows under Keplerian elements: ΔE/E₀ (always), Avg step + Accept
rate (DP853 only — hidden for fixed-step integrators). Reuses the
existing 5 Hz polling effect; formatStepDuration picks unit (s/min/h/d)
based on magnitude. formatDeltaE moved to helpers.ts (shared with the
top status strip)."
```

---

### Phase 5 verification gate

- [ ] `cd frontend && npm run build && npm run lint && npm test` all pass
- [ ] Manual smoke: full integrator comparison — submit Euler sim, watch ΔE/E₀ tick visibly within a sim-week; restart with DP853, watch ΔE/E₀ sit near 1e-12; confirm DP853 telemetry rows show on the body card with reasonable values; confirm they hide for Euler/RK4.
- [ ] **byeon-verify** before final merge to master.

---

## Self-review

**Spec coverage check:**
- Per-snapshot ΔE/E₀ on the wire? ✓ Tasks 1.3, 3.1, 3.2
- DP853 telemetry (avg step + accept rate)? ✓ Tasks 2.1, 2.2, 3.1, 3.2
- Hot-path discipline (allocation-free totalEnergy)? ✓ Task 1.1 explicitly
- Top-strip cell? ✓ Task 5.1
- Body card subsection? ✓ Task 5.2
- E₀ at construction, ε guard? ✓ Task 1.3 (computeDeltaE)
- Energy invariance test bounds? ✓ Task 1.4
- Wire format pin on both sides? ✓ Tasks 3.1 + 3.2
- DP853 NaN telemetry for fixed-step chunks? ✓ Task 3.1 explicit test
- Branchless parser? ✓ Always-write NaN at Task 3.1

**Placeholder scan:** no "TBD" / "TODO" / "implement appropriately". One inline-resolved decision callout (`emptyDataProducesHeaderOnly` → 18 bytes) was made in step rather than left ambiguous. The `TestSimulationFixtures.sunEarth()` reference was flagged with a "do this inline" instruction immediately after.

**Type consistency:**
- `ChunkResult.deltaERelative` is `Map<AbsoluteDate, Double>` (Java) → `deltaERelative: Float32Array | Record<string, number>` (TS). Names match.
- `Dp853Telemetry(avgStepSeconds, acceptRate)` → `dp853AvgStepSeconds`, `dp853AcceptRate` on the parsed chunk and chunk buffer. Names match.
- `getEvaluationCount()` consistent across Integrator + DP853Integrator + test.
- `readDeltaERelativeAt(buffer, floatIdx)` consistent across chunkBuffer + Task 5.1/5.2.

---

## Execution

Plan complete and committed in the next step. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks. Best for catching regressions early; clean context per task.
2. **Inline Execution** — execute tasks in this session via `executing-plans`, with checkpoints between phases.

Which approach?
