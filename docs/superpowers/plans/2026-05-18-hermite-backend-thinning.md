# Hermite Backend Keyframe Thinning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 2 of the Hermite work — backend honors a per-session `keyframeIntervalSec` request param, emitting every Kth integration step instead of every step, while preserving cross-chunk continuity (no boundary gaps) and a zero-cost K=1 fast path.

**Architecture:** A nullable `keyframeIntervalSec` field is added to `SimulationRequestDTO`. The controller computes `K = max(1, round(keyframeIntervalSec / stepDtSeconds))`, validates `1 ≤ K ≤ 100`, returns HTTP 400 on out-of-range, then passes the resolved `int keyframesPerKept` through `SimulationSessionService → SimulationFactory → Simulation` constructor. The new field lives as `final int keyframesPerKept` on `Simulation`. `Simulation.run()` is rewritten to use a monotonic `globalStepCount` and `nextKeptAtStep` cursor, so the modulo-K decision persists across `run()` calls and chunk boundaries land K steps apart with no visible stutter. The wire format is unchanged — fewer keyframes per chunk, per-keyframe timestamps spaced K·stepDt apart. Phase 1 frontend Hermite already consumes per-keyframe timestamps, so no frontend code-path change is required for thinned playback to work.

**Tech Stack:** Java 21, Spring Boot 3, Lombok, JUnit Jupiter (`spring-boot-starter-test`). Frontend: TypeScript, Next.js (only a type-stub update — no runtime behavior change in Phase 2).

**Spec:** [docs/superpowers/specs/2026-05-15-hermite-keyframe-interpolation-design.md](../specs/2026-05-15-hermite-keyframe-interpolation-design.md), "Phase 2 — Backend keyframe thinning" section.

**Branch:** `hermite-backend-thinning` (per `branch-workflow.md`; branch off **master**, NOT off the still-open `hermite-frontend` branch).

**Hot-path rules in scope:** [backend-sim-step.md](../../../.claude/rules/backend-sim-step.md) — `Simulation.run()` and `snapshotFromState()` are on the line. K=1 fast path must show zero allocation/branch change vs. today.

---

## File Map

**Backend (modified):**
- `backend/src/main/java/personal/spacesim/dtos/SimulationRequestDTO.java` — add nullable `Double keyframeIntervalSec` field.
- `backend/src/main/java/personal/spacesim/apis/controller/SimulationController.java` — compute & validate K from request, pass `int keyframesPerKept` to service, return 400 on invalid.
- `backend/src/main/java/personal/spacesim/services/SimulationSessionService.java` — `createSimulation` accepts `int keyframesPerKept`, passes through to factory.
- `backend/src/main/java/personal/spacesim/simulation/SimulationFactory.java` — `createSimulation` accepts `int keyframesPerKept`, passes through to Simulation constructor.
- `backend/src/main/java/personal/spacesim/simulation/Simulation.java` — add `final int keyframesPerKept` field + ctor param; add `globalStepCount` + `nextKeptAtStep` state; rewrite `run()` loop emission.

**Backend (created):**
- `backend/src/main/java/personal/spacesim/constants/SimulationLimits.java` — small constants class with `MAX_KEYFRAMES_PER_KEPT = 100`. Single source of truth referenced by controller + test.
- `backend/src/test/java/personal/spacesim/simulation/SimulationTest.java` — `@SpringBootTest` integration test exercising thinning counts at K=1/4/8 and cross-chunk continuity at K=4.

**Backend (modified test):**
- `backend/src/test/java/personal/spacesim/services/SimulationSessionServiceTest.java` — add tests for service-layer plumbing (intent-clarifying smoke tests that K propagates; the heavy lifting lives in `SimulationTest`).

**Frontend (modified — type stub only):**
- `frontend/src/app/utils/initializeCelestialBodies.tsx` — add optional `keyframeIntervalSec?: number` to `InitializeRequest`. Default flow continues to omit the field; Phase 3 will populate it.

**Out of scope (deferred to Phase 3):**
- UI surface, `PlaybackQuality.ts` constants, per-integrator defaults, the SimSetupDrawer form field, frontend stepDt-conversion helper.

---

## Design notes / spec deviations

- **Validation location:** spec says "service layer." This plan puts the K-computation + range validation in the **controller** instead. Rationale: (a) the unit→seconds conversion needed to compute K is conceptually an HTTP-input parsing step, not a simulation-domain rule; (b) avoids needing a `@ExceptionHandler` to map `IllegalArgumentException` → 400 (this codebase has no existing `@ControllerAdvice`, and adding one would change HTTP status for unrelated existing throws like "Unknown integrator type" — out of scope); (c) controller is still outside the hot path, satisfying the spec's actual constraint. Service trusts the resolved `int keyframesPerKept` it receives.
- **`SimulationLimits` constants class:** lifted out so the controller and the eventual frontend `MAX_K` reference (Phase 3) read from a single source. Named after the existing `PhysicsConstants` pattern.

---

## Task 1: Create branch + add DTO field

**Files:**
- Modify: `backend/src/main/java/personal/spacesim/dtos/SimulationRequestDTO.java`

- [ ] **Step 1: Branch off master**

```bash
git fetch origin master
git checkout -b hermite-backend-thinning origin/master
```

Expected: `Switched to a new branch 'hermite-backend-thinning'`. Confirm with `git status` — clean tree, on `hermite-backend-thinning`.

- [ ] **Step 2: Add `keyframeIntervalSec` to the record**

Replace the entire contents of `SimulationRequestDTO.java` with:

```java
package personal.spacesim.dtos;

import java.util.List;

public record SimulationRequestDTO(
        List<String> celestialBodyNames,
        String date,
        String frame,
        String integrator,
        String timeStepUnit,
        Double keyframeIntervalSec  // nullable; null → no thinning (K=1)
) {}
```

- [ ] **Step 3: Verify compile**

```bash
cd backend && ./mvnw compile -q
```

Expected: BUILD SUCCESS (no output other than mvn boilerplate). The existing controller still compiles because Jackson tolerates missing fields in JSON → record fields with no value will be `null`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/main/java/personal/spacesim/dtos/SimulationRequestDTO.java
git commit -m "$(cat <<'EOF'
feat(dto): add keyframeIntervalSec to SimulationRequestDTO

Nullable field; null → server defaults to K=1 (no thinning). Plumbed
through controller/service/factory/Simulation in subsequent commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Plumb `int keyframesPerKept` through factory + Simulation

**Files:**
- Modify: `backend/src/main/java/personal/spacesim/simulation/Simulation.java`
- Modify: `backend/src/main/java/personal/spacesim/simulation/SimulationFactory.java`
- Modify: `backend/src/main/java/personal/spacesim/services/SimulationSessionService.java`

No behavior change in this task — every caller passes `1` (no thinning). Run-loop modulo logic lands in Task 4.

- [ ] **Step 1: Add `keyframesPerKept` field + ctor param to `Simulation`**

In `Simulation.java`, add a new final field just after `private boolean hasEmittedInitialFrame = false;` (line ~35):

```java
    /**
     * Emit every Nth integration step to the snapshot stream (1 = no thinning).
     * Computed by the HTTP boundary from request `keyframeIntervalSec / stepDt`
     * and validated to 1..MAX_KEYFRAMES_PER_KEPT before reaching this ctor.
     * Final because the value is session-scoped — set once at session create,
     * cannot change mid-session.
     */
    private final int keyframesPerKept;
```

In the constructor parameter list, add `int keyframesPerKept` after `String timeStepUnit`:

```java
    public Simulation(
            String sessionID,
            List<CelestialBodyWrapper> celestialBodies,
            Frame frame,
            Integrator integrator,
            AbsoluteDate simStartDate,
            String timeStepUnit,
            int keyframesPerKept
    ) {
        this.sessionID = sessionID;
        this.frame = frame;
        this.celestialBodies = celestialBodies;
        this.integrator = integrator;
        this.simStartDate = simStartDate;
        this.simCurrentDate = simStartDate;
        this.timeStepUnit = timeStepUnit;
        this.keyframesPerKept = keyframesPerKept;
        this.derivatives = NBodyDerivatives.forBodies(celestialBodies);
        // ... rest of constructor unchanged
```

- [ ] **Step 2: Update `SimulationFactory.createSimulation` signature**

In `SimulationFactory.java`, add `int keyframesPerKept` to the method signature and pass it through:

```java
    public Simulation createSimulation(
            String sessionID,
            List<String> celestialBodyNames,
            String frameStr,
            String integratorStr,
            AbsoluteDate simStartDate,
            String timeStepUnit,
            int keyframesPerKept
    ) {

        // using singleton DI instead of static method
        Frame frame = customFrameFactory.createFrame(frameStr);
        Integrator integrator = integratorFactory.createIntegrator(integratorStr);

        List<CelestialBodyWrapper> celestialBodies = new ArrayList<>();
        for (String bodyName : celestialBodyNames) {
            CelestialBodyWrapper body = celestialBodyWrapperFactory.createCelestialBodyWrapper(bodyName, frame, simStartDate);
            celestialBodies.add(body);
        }

        return new Simulation(
                sessionID,
                celestialBodies,
                frame,
                integrator,
                simStartDate,
                timeStepUnit,
                keyframesPerKept
        );
    }
```

- [ ] **Step 3: Update `SimulationSessionService.createSimulation` signature**

In `SimulationSessionService.java`, add `int keyframesPerKept` to the method signature and pass it through to the factory:

```java
    public String createSimulation(
            List<String> celestialBodyNames,
            String frame,
            String integrator,
            AbsoluteDate simStartDate,
            String timeStep,
            int keyframesPerKept
    ) {
        String sessionID = UUID.randomUUID().toString();
        Simulation simulation = simulationFactory.createSimulation(
                sessionID,
                celestialBodyNames,
                frame,
                integrator,
                simStartDate,
                timeStep,
                keyframesPerKept
        );
        simulationMap.put(sessionID, simulation);
        lastAccessedAt.put(sessionID, System.currentTimeMillis());
        logger.info("sessionID: {}", sessionID);
        return sessionID;
    }
```

- [ ] **Step 4: Update controller to pass `1` (no validation yet)**

In `SimulationController.java`, change the service call site to pass `1`:

```java
        // calling the service
        String sessionID = simulationSessionService.createSimulation(
                celestialBodyNames,
                frame,
                integrator,
                date,
                timeStepUnit,
                1  // K=1 (no thinning); proper computation+validation lands in Task 6
        );
```

- [ ] **Step 5: Update existing test call sites**

In `SimulationSessionServiceTest.java`, both `createSimulation` calls need the new arg. Find each call (lines ~54 and ~80, both currently end with `"days"`) and add `, 1`:

```java
        String sessionID = service.createSimulation(
                List.of("Sun"),
                "ICRF",
                "EULER",
                new AbsoluteDate("2024-01-01T00:00:00.000", TimeScalesFactory.getUTC()),
                "days",
                1
        );
```

Apply the same change to both calls in the file.

- [ ] **Step 6: Compile + run tests**

```bash
cd backend && ./mvnw test -q
```

Expected: BUILD SUCCESS, all tests pass. Particularly `SimulationSessionServiceTest` continues to pass — behavior is unchanged because K=1 is the no-thinning path.

- [ ] **Step 7: Commit**

```bash
git add backend/src/main/java/personal/spacesim/simulation/Simulation.java \
        backend/src/main/java/personal/spacesim/simulation/SimulationFactory.java \
        backend/src/main/java/personal/spacesim/services/SimulationSessionService.java \
        backend/src/main/java/personal/spacesim/apis/controller/SimulationController.java \
        backend/src/test/java/personal/spacesim/services/SimulationSessionServiceTest.java
git commit -m "$(cat <<'EOF'
refactor(simulation): plumb keyframesPerKept through factory + Simulation ctor

No behavior change. Every caller passes 1 (no thinning). Run-loop modulo
logic lands in a follow-up commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: TDD — failing test for K=4 thinning count

**Files:**
- Create: `backend/src/test/java/personal/spacesim/simulation/SimulationTest.java`

This task only writes the test. The implementation lands in Task 4. We commit only after both are green.

- [ ] **Step 1: Create the test file**

Write `backend/src/test/java/personal/spacesim/simulation/SimulationTest.java`:

```java
package personal.spacesim.simulation;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.orekit.data.DataContext;
import org.orekit.data.DirectoryCrawler;
import org.orekit.time.AbsoluteDate;
import org.orekit.time.TimeScalesFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.junit.jupiter.SpringExtension;
import personal.spacesim.simulation.body.CelestialBodySnapshot;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Pins {@link Simulation#run()}'s keyframe-thinning emission contract.
 * At K=1 every step is kept; at K&gt;1 every Kth step is kept, with the
 * initial frame always kept and cross-chunk continuity preserved (the
 * second run()'s first kept step is exactly K steps after the first
 * run()'s last kept step).
 */
@ExtendWith(SpringExtension.class)
@SpringBootTest
class SimulationTest {

    @Autowired
    private SimulationFactory simulationFactory;

    @BeforeAll
    static void loadOrekitData() {
        try {
            URL url = SimulationTest.class.getClassLoader()
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

    private Simulation newSim(int keyframesPerKept) {
        return simulationFactory.createSimulation(
                "test-session-" + keyframesPerKept,
                List.of("Sun"),
                "ICRF",
                "EULER",
                new AbsoluteDate("2024-01-01T00:00:00.000", TimeScalesFactory.getUTC()),
                "seconds",
                keyframesPerKept
        );
    }

    @Test
    void kEquals4FirstChunkEmits2501Frames() {
        Simulation sim = newSim(4);

        Map<AbsoluteDate, List<CelestialBodySnapshot>> chunk = sim.run();

        // 1 initial + 2500 kept steps (steps 4, 8, ..., 10000)
        assertEquals(2501, chunk.size(),
                "K=4 first chunk should emit 1 initial + 2500 thinned keyframes");
    }
}
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
cd backend && ./mvnw test -Dtest=SimulationTest -q
```

Expected: FAIL — `expected: <2501> but was: <10001>`. With Task 2 plumbing in place but Task 4 modulo logic not yet, `run()` still emits every step → 10001 frames at any K. **Do not commit yet.**

---

## Task 4: Implement run-loop thinning + cross-chunk continuity

**Files:**
- Modify: `backend/src/main/java/personal/spacesim/simulation/Simulation.java`
- Modify: `backend/src/test/java/personal/spacesim/simulation/SimulationTest.java` (add remaining cases after green)

- [ ] **Step 1: Add the thinning state fields to `Simulation`**

In `Simulation.java`, just below `private boolean hasEmittedInitialFrame = false;` (and after `keyframesPerKept` from Task 2):

```java
    /**
     * Monotonic step counter spanning all run() invocations on this Simulation.
     * Drives the cross-chunk-continuous thinning decision in run().
     */
    private long globalStepCount = 0;

    /**
     * Next globalStepCount at which the snapshot should be kept. Set to
     * keyframesPerKept on first chunk (right after the initial frame is
     * emitted at step 0) and incremented by keyframesPerKept on each kept
     * step. Surviving as a field across run() calls is what guarantees
     * chunk N+1's first kept step lands exactly K steps after chunk N's
     * last kept step — no boundary gap.
     */
    private long nextKeptAtStep = 0;
```

- [ ] **Step 2: Rewrite `run()` to use the thinning cursor**

Replace the existing `run()` method body (line 104–128) with:

```java
    public Map<AbsoluteDate, List<CelestialBodySnapshot>> run() {
        long startTime = System.nanoTime();
        Map<AbsoluteDate, List<CelestialBodySnapshot>> results = new LinkedHashMap<>();

        // Initial frame is always kept (step 0). Only on the first chunk.
        if (!hasEmittedInitialFrame) {
            results.put(simCurrentDate, snapshotFromState());
            hasEmittedInitialFrame = true;
            nextKeptAtStep = keyframesPerKept;
        }

        int currentTimeStep = 0;
        while (currentTimeStep < TIMESTEPS_TO_RUN) {
            update();
            globalStepCount++;
            // Single integer compare — K=1 path is identical to today
            // (true every step, snapshot kept every step).
            if (globalStepCount >= nextKeptAtStep) {
                results.put(simCurrentDate, snapshotFromState());
                nextKeptAtStep += keyframesPerKept;
            }
            currentTimeStep++;
        }

        long endTime = System.nanoTime();
        double totalTimeSeconds = (endTime - startTime) / 1_000_000_000.0;

        log.info("Simulation completed for {} {} in {} seconds.", TIMESTEPS_TO_RUN, timeStepUnit, totalTimeSeconds);
        log.info("Simulation ran using frame: {}", frame.getName());

        return results;
    }
```

- [ ] **Step 3: Run the K=4 test, confirm it passes**

```bash
cd backend && ./mvnw test -Dtest=SimulationTest -q
```

Expected: PASS — `Tests run: 1, Failures: 0`. K=4 now correctly emits 2501 frames.

- [ ] **Step 4: Add the remaining test cases to `SimulationTest`**

Append these tests to `SimulationTest.java`, after `kEquals4FirstChunkEmits2501Frames`:

```java
    @Test
    void kEquals1FirstChunkEmits10001Frames() {
        Simulation sim = newSim(1);

        Map<AbsoluteDate, List<CelestialBodySnapshot>> chunk = sim.run();

        // 1 initial + 10000 kept steps (every step kept)
        assertEquals(10001, chunk.size(),
                "K=1 first chunk should emit every integration step");
    }

    @Test
    void kEquals8FirstChunkEmits1251Frames() {
        Simulation sim = newSim(8);

        Map<AbsoluteDate, List<CelestialBodySnapshot>> chunk = sim.run();

        // 1 initial + 1250 kept steps (steps 8, 16, ..., 10000)
        assertEquals(1251, chunk.size(),
                "K=8 first chunk should emit 1 initial + 1250 thinned keyframes");
    }

    @Test
    void kEquals4CrossChunkContinuityHoldsAtBoundary() {
        Simulation sim = newSim(4);

        Map<AbsoluteDate, List<CelestialBodySnapshot>> chunk1 = sim.run();
        Map<AbsoluteDate, List<CelestialBodySnapshot>> chunk2 = sim.run();

        // chunk1 last kept = global step 10000
        // chunk2 first kept = global step 10004 (4 steps later)
        // At timeStepUnit="seconds", that's 4.0 seconds apart.
        AbsoluteDate lastOfChunk1 = lastKey(chunk1);
        AbsoluteDate firstOfChunk2 = firstKey(chunk2);
        double dtSeconds = firstOfChunk2.durationFrom(lastOfChunk1);

        assertEquals(4.0, dtSeconds, 1e-9,
                "Chunk N+1's first kept keyframe must be exactly K steps after "
                        + "Chunk N's last kept keyframe (no boundary gap)");

        // Chunk 2 has no initial-frame emission, so it should have one fewer
        // entry than Chunk 1 at the same K.
        assertEquals(2500, chunk2.size(),
                "Second chunk should emit only thinned keyframes, no initial");
    }

    private static AbsoluteDate firstKey(Map<AbsoluteDate, List<CelestialBodySnapshot>> m) {
        return m.keySet().iterator().next();
    }

    private static AbsoluteDate lastKey(Map<AbsoluteDate, List<CelestialBodySnapshot>> m) {
        AbsoluteDate last = null;
        for (AbsoluteDate d : m.keySet()) {
            last = d;
        }
        return last;
    }
```

- [ ] **Step 5: Run the full SimulationTest**

```bash
cd backend && ./mvnw test -Dtest=SimulationTest -q
```

Expected: PASS — `Tests run: 4, Failures: 0`. All four cases green.

- [ ] **Step 6: Run the whole backend test suite (regression check)**

```bash
cd backend && ./mvnw test -q
```

Expected: BUILD SUCCESS. Particularly `SimulationSessionServiceTest` continues to pass (it uses K=1, identical to today's behavior).

- [ ] **Step 7: Commit**

```bash
git add backend/src/main/java/personal/spacesim/simulation/Simulation.java \
        backend/src/test/java/personal/spacesim/simulation/SimulationTest.java
git commit -m "$(cat <<'EOF'
feat(simulation): keyframe thinning with cross-chunk continuity

Simulation.run() now emits every Kth integration step using a monotonic
globalStepCount + nextKeptAtStep cursor that persists across run() calls,
guaranteeing chunk N+1's first kept keyframe is exactly K steps after
chunk N's last (no boundary gap). K=1 path is unchanged — single integer
compare is true every step.

Tests pin K=1 (10001 frames), K=4 (2501 frames), K=8 (1251 frames), and
cross-chunk continuity at K=4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add `SimulationLimits` constants class

**Files:**
- Create: `backend/src/main/java/personal/spacesim/constants/SimulationLimits.java`

Tiny task — extracted so Task 6's validation and the future Phase 3 frontend `MAX_K` reference the same number.

- [ ] **Step 1: Create the constants file**

Write `backend/src/main/java/personal/spacesim/constants/SimulationLimits.java`:

```java
package personal.spacesim.constants;

/**
 * Numeric guardrails for simulation request inputs. Centralized so the
 * controller validation and any future frontend mirror reference the
 * same source of truth.
 */
public final class SimulationLimits {

    private SimulationLimits() {}

    /**
     * Maximum value of {@code keyframesPerKept} (K) accepted at /initialize.
     * With CHUNK_SIZE=10000 timesteps, K=100 still leaves ~100 keyframes
     * per chunk — the visual-smoothness floor for Hermite interpolation
     * between samples. Higher values risk visibly under-sampled motion
     * even with cubic interpolation.
     */
    public static final int MAX_KEYFRAMES_PER_KEPT = 100;
}
```

- [ ] **Step 2: Verify compile**

```bash
cd backend && ./mvnw compile -q
```

Expected: BUILD SUCCESS.

- [ ] **Step 3: Commit**

```bash
git add backend/src/main/java/personal/spacesim/constants/SimulationLimits.java
git commit -m "$(cat <<'EOF'
feat(constants): add SimulationLimits.MAX_KEYFRAMES_PER_KEPT

Single source of truth for the K-validation upper bound, referenced by
the controller validation in the next commit and by the eventual Phase 3
frontend mirror.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Controller K-computation + HTTP 400 validation

**Files:**
- Modify: `backend/src/main/java/personal/spacesim/apis/controller/SimulationController.java`

Resolve `Double keyframeIntervalSec` → `int K`, validate, return 400 if out of range.

- [ ] **Step 1: Add the stepDt helper + validation to the controller**

Replace the entire body of `initializeSimulation` in `SimulationController.java` with this version. Also add a new private helper at the bottom of the class.

```java
    @PostMapping("/initialize")
    public ResponseEntity<SimulationResponseDTO> initializeSimulation(@RequestBody SimulationRequestDTO request) {

        // get parameters from payload
        AbsoluteDate date = new AbsoluteDate(
                request.date(),
                TimeScalesFactory.getUTC()
        );
        List<String> celestialBodyNames = request.celestialBodyNames();
        String frame = request.frame();
        String integrator = request.integrator();
        String timeStepUnit = request.timeStepUnit();

        // Resolve keyframesPerKept (K) from the optional interval-in-seconds
        // request param. null → K=1 (no thinning).
        int keyframesPerKept;
        try {
            keyframesPerKept = resolveKeyframesPerKept(
                    request.keyframeIntervalSec(),
                    timeStepUnit
            );
        } catch (IllegalArgumentException e) {
            logger.warn("Rejecting /initialize with invalid keyframeIntervalSec: {}", e.getMessage());
            return ResponseEntity.badRequest().build();
        }

        // calling the service
        String sessionID = simulationSessionService.createSimulation(
                celestialBodyNames,
                frame,
                integrator,
                date,
                timeStepUnit,
                keyframesPerKept
        );

        // building response object
        SimulationResponseDTO responseDTO = simulationSessionService.returnSimulationResponseDTO(sessionID);
        return ResponseEntity.ok(responseDTO);
    }

    /**
     * Computes {@code K = max(1, round(keyframeIntervalSec / stepDtSeconds))}
     * and validates {@code 1 <= K <= MAX_KEYFRAMES_PER_KEPT}. Null input
     * resolves to K=1 (no thinning).
     *
     * @throws IllegalArgumentException if the resolved K is out of range, or
     *         if {@code timeStepUnit} is unrecognized.
     */
    private static int resolveKeyframesPerKept(Double keyframeIntervalSec, String timeStepUnit) {
        if (keyframeIntervalSec == null) {
            return 1;
        }
        if (keyframeIntervalSec <= 0 || !Double.isFinite(keyframeIntervalSec)) {
            throw new IllegalArgumentException(
                    "keyframeIntervalSec must be a finite positive number, got " + keyframeIntervalSec);
        }
        double stepDtSeconds = stepDtSeconds(timeStepUnit);
        int k = (int) Math.max(1, Math.round(keyframeIntervalSec / stepDtSeconds));
        if (k > SimulationLimits.MAX_KEYFRAMES_PER_KEPT) {
            throw new IllegalArgumentException(
                    "keyframeIntervalSec resolves to K=" + k
                            + ", which exceeds the maximum " + SimulationLimits.MAX_KEYFRAMES_PER_KEPT);
        }
        return k;
    }

    private static double stepDtSeconds(String timeStepUnit) {
        return switch (timeStepUnit.toLowerCase()) {
            case "seconds" -> 1.0;
            case "hours" -> PhysicsConstants.SECONDS_PER_HOUR;
            case "days" -> PhysicsConstants.SECONDS_PER_DAY;
            case "weeks" -> PhysicsConstants.SECONDS_PER_WEEK;
            default -> throw new IllegalArgumentException("Unsupported time step unit: " + timeStepUnit);
        };
    }
```

Add the matching imports at the top of `SimulationController.java`:

```java
import personal.spacesim.constants.PhysicsConstants;
import personal.spacesim.constants.SimulationLimits;
```

- [ ] **Step 2: Verify compile + existing tests still pass**

```bash
cd backend && ./mvnw test -q
```

Expected: BUILD SUCCESS, all tests pass. Existing tests don't exercise the new validation paths.

- [ ] **Step 3: Add controller-validation tests**

For these tests, we need a test that touches the HTTP layer to verify the 400. The simplest path that fits this codebase's existing setup (no MockMvc anywhere yet) is to **add unit tests on the static helper directly**. The helper is pure, the conversions are testable in isolation, and exercising it covers the same logic the HTTP path runs.

Append a new test file `backend/src/test/java/personal/spacesim/apis/controller/SimulationControllerKeyframeResolutionTest.java`:

```java
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
```

- [ ] **Step 4: Run the new test file**

```bash
cd backend && ./mvnw test -Dtest=SimulationControllerKeyframeResolutionTest -q
```

Expected: PASS — `Tests run: 12, Failures: 0`.

- [ ] **Step 5: Run the full backend test suite**

```bash
cd backend && ./mvnw test -q
```

Expected: BUILD SUCCESS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/main/java/personal/spacesim/apis/controller/SimulationController.java \
        backend/src/test/java/personal/spacesim/apis/controller/SimulationControllerKeyframeResolutionTest.java
git commit -m "$(cat <<'EOF'
feat(controller): resolve + validate keyframeIntervalSec at HTTP boundary

Controller computes K = max(1, round(keyframeIntervalSec / stepDtSeconds))
and returns HTTP 400 on null-aware out-of-range inputs (negative, zero,
NaN, infinite, K > MAX_KEYFRAMES_PER_KEPT, unknown timeStepUnit). The
resolved int K is passed to the service; the service trusts it.

Reflection-based unit tests pin the helper's rounding, clamping, and
exception behavior across "seconds" and "days" units.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Frontend type stub

**Files:**
- Modify: `frontend/src/app/utils/initializeCelestialBodies.tsx`

Single field addition; runtime behavior unchanged because nothing populates it. The point is forward-compat — Phase 3 wires the UI without re-touching the request type.

- [ ] **Step 1: Add the optional field to `InitializeRequest`**

In `frontend/src/app/utils/initializeCelestialBodies.tsx`, update the interface:

```ts
interface InitializeRequest {
  celestialBodyNames: string[];
  date: string;
  frame: string;
  integrator: string;
  timeStepUnit: string;
  /**
   * Keyframe-interval lever for backend thinning. Optional in Phase 2 —
   * omitted by today's callers, which results in the server defaulting
   * to K=1 (no thinning). Phase 3 wires a SimSetupDrawer control that
   * populates this from a "Playback quality" preset.
   */
  keyframeIntervalSec?: number;
}
```

- [ ] **Step 2: Verify the build + lint + types + tests**

```bash
cd frontend && npm run build && npm run lint && npx tsc --noEmit && npm test
```

Expected: all four pass. No call site needs updating because the field is optional and nothing populates it yet.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/utils/initializeCelestialBodies.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): add optional keyframeIntervalSec to InitializeRequest

Forward-compat type stub for Phase 2 — no caller populates the field yet,
so the server continues to receive null and default to K=1. Phase 3 wires
the SimSetupDrawer "Playback quality" control.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Manual end-to-end verification

No new code or commits — just confirming the spec's Phase 2 verify criteria with the running stack.

- [ ] **Step 1: Start the backend**

```bash
cd backend && ./mvnw spring-boot:run
```

Wait for `Started SpacesimApplication` log line. Keep the server running for the rest of the steps.

- [ ] **Step 2: Capture a baseline chunk size at K=1 (omitted field)**

In a separate terminal:

```bash
SID=$(curl -s -X POST http://localhost:8080/api/simulation/initialize \
  -H 'Content-Type: application/json' \
  -d '{
    "celestialBodyNames": ["Sun", "Earth", "Moon", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Mercury", "Venus"],
    "date": "2024-01-01T00:00:00.000",
    "frame": "ICRF",
    "integrator": "DP853",
    "timeStepUnit": "hours"
  }' | python3 -c 'import sys, json; print(json.load(sys.stdin)["simulationMetaData"]["sessionID"])')
echo "session = $SID"

curl -s -X POST http://localhost:8080/api/simulation/chunk \
  -H 'Content-Type: application/json' \
  -d "{\"sessionID\": \"$SID\"}" \
  --output /tmp/chunk_k1.bin
ls -l /tmp/chunk_k1.bin
```

Expected: chunk byte size in the ballpark of the current ~4MB ARCHITECTURE.md figure (or whatever the recent precompute-era figure is — note the number).

- [ ] **Step 3: Capture a K=4 chunk size**

```bash
SID=$(curl -s -X POST http://localhost:8080/api/simulation/initialize \
  -H 'Content-Type: application/json' \
  -d '{
    "celestialBodyNames": ["Sun", "Earth", "Moon", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Mercury", "Venus"],
    "date": "2024-01-01T00:00:00.000",
    "frame": "ICRF",
    "integrator": "DP853",
    "timeStepUnit": "hours",
    "keyframeIntervalSec": 14400.0
  }' | python3 -c 'import sys, json; print(json.load(sys.stdin)["simulationMetaData"]["sessionID"])')
echo "session = $SID"

curl -s -X POST http://localhost:8080/api/simulation/chunk \
  -H 'Content-Type: application/json' \
  -d "{\"sessionID\": \"$SID\"}" \
  --output /tmp/chunk_k4.bin
ls -l /tmp/chunk_k4.bin
```

`14400.0` = 4 × 3600s (4 hours), with the `"hours"` timeStepUnit → stepDt = 3600s → K=4.

Expected: `chunk_k4.bin` is ~75% smaller than `chunk_k1.bin` (zstd compression of 4× fewer keyframes). Note exact percentage — record in the PR description.

- [ ] **Step 4: Probe the validation path**

```bash
curl -i -X POST http://localhost:8080/api/simulation/initialize \
  -H 'Content-Type: application/json' \
  -d '{
    "celestialBodyNames": ["Sun"],
    "date": "2024-01-01T00:00:00.000",
    "frame": "ICRF",
    "integrator": "EULER",
    "timeStepUnit": "seconds",
    "keyframeIntervalSec": 101.0
  }'
```

Expected: HTTP/1.1 400 (look for `HTTP/1.1 400` in the response headers).

```bash
curl -i -X POST http://localhost:8080/api/simulation/initialize \
  -H 'Content-Type: application/json' \
  -d '{
    "celestialBodyNames": ["Sun"],
    "date": "2024-01-01T00:00:00.000",
    "frame": "ICRF",
    "integrator": "EULER",
    "timeStepUnit": "seconds",
    "keyframeIntervalSec": -1.0
  }'
```

Expected: HTTP/1.1 400.

- [ ] **Step 5: Smoke-test the frontend with the default flow (K=1)**

```bash
cd frontend && npm run dev
```

In a browser at `localhost:3000`, set up and run a simulation through the existing UI (which still omits `keyframeIntervalSec`). Confirm:
- Playback runs and looks identical to master.
- Chunk size in DevTools → Network shows the same size as before this branch.
- No console errors.

If frontend dev server can't be exercised (no browser available in this environment), say so explicitly in the PR description rather than implying success.

- [ ] **Step 6: Stop the backend + frontend**

Ctrl-C both processes.

---

## Task 9: Push branch + open PR

- [ ] **Step 1: Final clean-state check**

```bash
git status
git log master..hermite-backend-thinning --oneline
```

Expected: clean working tree; commit history matches the planned 7 commits (Tasks 1, 2, 4, 5, 6, 7 — Tasks 3 and 8 don't commit independently).

- [ ] **Step 2: Push the branch**

```bash
git push -u origin hermite-backend-thinning
```

- [ ] **Step 3: Open PR**

```bash
gh pr create --title "Hermite Phase 2: backend keyframe thinning" --body "$(cat <<'EOF'
## Summary
- Backend honors a per-session `keyframeIntervalSec` request param; emits every Kth integration step with `globalStepCount`/`nextKeptAtStep` cursors that survive across `run()` invocations, so chunk N+1's first kept frame is exactly K steps after chunk N's last (no boundary gap).
- Controller resolves and validates K at the HTTP boundary, returns 400 on out-of-range, NaN/Inf, negative, zero, or unknown `timeStepUnit`.
- Zero wire-format change. K=1 path is a single integer compare per step — identical cost to before.
- Frontend gets an optional `keyframeIntervalSec?: number` on `InitializeRequest`. No caller populates it yet; Phase 3 wires the SimSetupDrawer "Playback quality" control.

## Test plan
- [x] `SimulationTest`: K=1 (10001 frames), K=4 (2501), K=8 (1251), cross-chunk continuity at K=4.
- [x] `SimulationControllerKeyframeResolutionTest`: 12 cases covering null/zero/negative/NaN/Inf/over-max/exact-max/unit-conversion/unknown-unit.
- [x] `SimulationSessionServiceTest`: regression — K=1 path unchanged.
- [x] Manual K=1 vs K=4 chunk-size capture — **fill in observed numbers from Task 8 here**: K=1 chunk = `_____ KB`, K=4 chunk = `_____ KB`, reduction = `___%`.
- [x] Manual validation probe — K=101 and K=-1 both return HTTP 400.
- [ ] Frontend smoke test at K=1 default (browser availability noted in plan).

Spec: `docs/superpowers/specs/2026-05-15-hermite-keyframe-interpolation-design.md` — Phase 2.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Report the PR URL and stop**

Per `no-ci-polling.md`, do **not** wait for CI to finish or run `gh pr checks`. Print the PR URL and stop here. byeon will verify on GitHub and flag any failures.

---

## Self-review notes

- **Spec coverage:** DTO field (Task 1) ✓, factory plumbing (Task 2) ✓, `Simulation.run()` thinning (Task 4) ✓, K=1/K=4/K=8 counts + cross-chunk continuity (Tasks 3+4) ✓, service-layer validation (deviated to controller layer — documented in Design notes; Task 6) ✓, HTTP 400 on invalid (Task 6) ✓, frontend type stub (Task 7) ✓, manual K=4 chunk-size verification (Task 8) ✓.
- **Not covered (intentional, per spec's "Phase 3" list):** `PlaybackQuality.ts`, per-integrator defaults, SimSetupDrawer UI control, `stepDtSeconds(timeStepUnit)` frontend helper, "× stepDt" form UX.
- **Test for `BinaryResponseSerializerTest`:** spec says "unchanged". Confirmed by running the full test suite in Task 4 / Task 6.
- **Test for frontend SimRequest serialization:** spec lists this. Skipped here because nothing populates the field in Phase 2 — there's no behavior to test beyond TypeScript's compile-time check. Phase 3's UI work is where the field actually flows into a payload.
- **Naming consistency:** the resolved value is uniformly `int keyframesPerKept` (Java) and `keyframeIntervalSec` (wire, in seconds). The K computation transforms one to the other at exactly one place (controller helper).
