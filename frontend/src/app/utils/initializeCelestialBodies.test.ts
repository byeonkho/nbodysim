import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import simulationReducer, {
  appendChunkToBuffer,
  setCurrentTimeStepIndex,
  simulationUpdateDataMiddleware,
} from "@/app/store/slices/SimulationSlice";
import requestReducer, {
  setRequestInProgress,
} from "@/app/store/slices/RequestSlice";
import {
  dispatchChunkRequest,
  cancelChunkStream,
} from "@/app/store/middleware/simulationRequestThunk";
import { beginSimulationLaunch } from "./simulationLaunch";
import { computeNextIndex } from "./animationStep";
import { beginLaunch } from "@/app/store/launchEpoch";
import { initializeCelestialBodies } from "./initializeCelestialBodies";
import { setErrorMessage } from "@/app/store/slices/RequestSlice";
import { loadSimulation } from "@/app/store/slices/SimulationSlice";
import type { AppDispatch } from "@/app/store/Store";
import type { components } from "@/app/generated/api";

// Pins the cold-wake retry contract: the backend sleeps when idle and the first
// request can 502 for a few seconds. Retrying the transient statuses (vs.
// surfacing client errors immediately) is silent-failure territory — a wrong
// classification either hangs the user on a blank scene or hammers a 4xx.

const REQUEST_BODY = {
  celestialBodyNames: ["SUN", "EARTH"],
  date: "2024-06-05T00:00:00.000",
  frame: "ICRF",
  integrator: "rk4",
  timeStepUnit: "Hours",
  fidelityBucket: "medLow",
} as unknown as components["schemas"]["SimulationRequestDTO"];

const okResponse = (sessionID = "sess-1") => ({
  ok: true,
  status: 200,
  json: async () => ({
    celestialBodyPropertiesList: [],
    simulationMetaData: { sessionID },
  }),
});

const statusResponse = (status: number) => ({ ok: false, status });

describe("initializeCelestialBodies", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cancelChunkStream();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries a cold-wake 502 then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(statusResponse(502))
      .mockResolvedValueOnce(okResponse());
    const dispatch = vi.fn() as unknown as AppDispatch;
    const onRetry = vi.fn();

    const promise = initializeCelestialBodies(dispatch, REQUEST_BODY, {
      onRetry,
    });
    await vi.runAllTimersAsync();

    expect(await promise).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: loadSimulation.type }),
    );
  });

  it("retries a network error then succeeds", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(okResponse());
    const dispatch = vi.fn() as unknown as AppDispatch;

    const promise = initializeCelestialBodies(dispatch, REQUEST_BODY);
    await vi.runAllTimersAsync();

    expect(await promise).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces an error toast after exhausting retries", async () => {
    fetchMock.mockResolvedValue(statusResponse(502));
    const dispatch = vi.fn() as unknown as AppDispatch;

    const promise = initializeCelestialBodies(dispatch, REQUEST_BODY);
    await vi.runAllTimersAsync();

    expect(await promise).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(6); // 5 retries + final attempt
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: setErrorMessage.type }),
    );
  });

  it("does not retry a client error (400)", async () => {
    fetchMock.mockResolvedValue(statusResponse(400));
    const dispatch = vi.fn() as unknown as AppDispatch;

    const promise = initializeCelestialBodies(dispatch, REQUEST_BODY);
    await vi.runAllTimersAsync();

    expect(await promise).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: setErrorMessage.type }),
    );
  });

  it("does not retry a 429 rate-limit", async () => {
    fetchMock.mockResolvedValue(statusResponse(429));
    const dispatch = vi.fn() as unknown as AppDispatch;

    const promise = initializeCelestialBodies(dispatch, REQUEST_BODY);
    await vi.runAllTimersAsync();

    expect(await promise).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([200, 400, 503])(
    "ignores a superseded initialization response (%s)",
    async (status) => {
      let finish!: (
        value:
          ReturnType<typeof okResponse> | ReturnType<typeof statusResponse>,
      ) => void;
      fetchMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const dispatch = vi.fn() as unknown as AppDispatch;
      const onRetry = vi.fn();
      const pending = initializeCelestialBodies(dispatch, REQUEST_BODY, {
        onRetry,
      });
      beginLaunch();
      finish(status === 200 ? okResponse("old") : statusResponse(status));
      await vi.runAllTimersAsync();
      expect(await pending).toBe(false);
      expect(dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: loadSimulation.type }),
      );
      expect(dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: setErrorMessage.type }),
      );
      expect(onRetry).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("ignores a response superseded while its JSON body was decoding", async () => {
    fetchMock.mockResolvedValue({
      ...okResponse(),
      json: async () => {
        beginLaunch();
        return {
          celestialBodyPropertiesList: [],
          simulationMetaData: { sessionID: "old" },
        };
      },
    });
    const dispatch = vi.fn() as unknown as AppDispatch;
    expect(await initializeCelestialBodies(dispatch, REQUEST_BODY)).toBe(false);
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: loadSimulation.type }),
    );
  });

  it("stops retrying when superseded during backoff", async () => {
    fetchMock.mockResolvedValue(statusResponse(503));
    const dispatch = vi.fn() as unknown as AppDispatch;
    const pending = initializeCelestialBodies(dispatch, REQUEST_BODY);
    await vi.advanceTimersByTimeAsync(0);
    beginLaunch();
    await vi.runAllTimersAsync();
    expect(await pending).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: setErrorMessage.type }),
    );
  });
  it("releases the old request flag if its replacement fails", async () => {
    fetchMock.mockResolvedValue(statusResponse(400));
    const store = configureStore({
      reducer: { simulation: simulationReducer, request: requestReducer },
    });
    store.dispatch(
      loadSimulation({
        celestialBodyPropertiesList: [],
        simulationMetaData: { sessionID: "old" },
      }),
    );
    store.dispatch(setRequestInProgress(true));
    expect(
      await initializeCelestialBodies(
        store.dispatch as AppDispatch,
        REQUEST_BODY,
      ),
    ).toBe(false);
    expect(store.getState().request.isRequestInProgress).toBe(false);
    expect(
      store.getState().simulation.simulationParameters.simulationMetaData
        ?.sessionID,
    ).toBe("old");
  });
  it("does not prefetch the old session during pending initialization", async () => {
    let finish!: (value: ReturnType<typeof statusResponse>) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const store = configureStore({
      reducer: { simulation: simulationReducer, request: requestReducer },
      middleware: (getDefault) =>
        getDefault({ serializableCheck: false }).concat(
          simulationUpdateDataMiddleware,
        ),
    });
    store.dispatch(
      loadSimulation({
        celestialBodyPropertiesList: [{ name: "Sun" }],
        simulationMetaData: { sessionID: "old" },
      }),
    );
    store.dispatch(
      appendChunkToBuffer({
        bodyNames: ["Sun"],
        bodyCount: 1,
        timestepCount: 4,
        positions: new Float64Array(24),
        timestamps: new Float64Array(4),
        mu: { Sun: 1 },
        deltaERelative: new Float32Array(4),
        dp853AvgStepSeconds: null,
        dp853AcceptRate: null,
      }),
    );
    const pending = initializeCelestialBodies(
      store.dispatch as AppDispatch,
      REQUEST_BODY,
    );
    store.dispatch(setCurrentTimeStepIndex(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.getState().request.isLaunchInProgress).toBe(true);
    fetchMock.mockImplementation(() => new Promise(() => {}));
    finish(statusResponse(400));
    expect(await pending).toBe(false);
    expect(store.getState().request.isLaunchInProgress).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store.getState().request.isRequestInProgress).toBe(true);
  });
  it.each([true, false])(
    "resumes a retained stream without another animation action (buffered=%s)",
    async (buffered) => {
      const store = configureStore({
        reducer: { simulation: simulationReducer, request: requestReducer },
        middleware: (g) =>
          g({ serializableCheck: false }).concat(
            simulationUpdateDataMiddleware,
          ),
      });
      store.dispatch(
        loadSimulation({
          celestialBodyPropertiesList: [{ name: "Sun" }],
          simulationMetaData: { sessionID: "old" },
        }),
      );
      if (buffered)
        store.dispatch(
          appendChunkToBuffer({
            bodyNames: ["Sun"],
            bodyCount: 1,
            timestepCount: 4,
            positions: new Float64Array(24),
            timestamps: new Float64Array(4),
            mu: { Sun: 1 },
            deltaERelative: new Float32Array(4),
            dp853AvgStepSeconds: null,
            dp853AcceptRate: null,
          }),
        );
      let finish!: (value: ReturnType<typeof statusResponse>) => void;
      fetchMock.mockImplementation(
        (url: string, opts: { signal: AbortSignal }) =>
          url.endsWith("/initialize")
            ? new Promise((resolve) => {
                finish = resolve;
              })
            : new Promise((_resolve, reject) =>
                opts.signal.addEventListener("abort", () =>
                  reject(new DOMException("Aborted", "AbortError")),
                ),
              ),
      );
      dispatchChunkRequest(store.dispatch as AppDispatch, { sessionID: "old" });
      const pending = initializeCelestialBodies(
        store.dispatch as AppDispatch,
        REQUEST_BODY,
      );
      if (buffered) store.dispatch(setCurrentTimeStepIndex(3));
      finish(statusResponse(400));
      expect(await pending).toBe(false);
      // The real animation controller produces no action at the buffer end,
      // and returns immediately with no buffer. Recovery cannot depend on it.
      if (buffered)
        expect(
          computeNextIndex({
            currentIndex: 3,
            delta: 1 / 60,
            speedMultiplier: 1,
            fps: 60,
            totalTimesteps: 4,
          }),
        ).toBe(3);
      const chunks = fetchMock.mock.calls.filter(([url]) =>
        url.endsWith("/chunk"),
      );
      expect(chunks).toHaveLength(2);
      expect(JSON.parse(chunks[1][1].body)).toEqual({
        sessionID: "old",
        expectedChunkIndex: buffered ? 1 : 0,
      });
      expect(store.getState().request.isRequestInProgress).toBe(true);
    },
  );
  it.each(["success", "superseded", "sessionless"])(
    "does not restart a retained stream for %s launches",
    async (outcome) => {
      const store = configureStore({
        reducer: { simulation: simulationReducer, request: requestReducer },
        middleware: (g) =>
          g({ serializableCheck: false }).concat(
            simulationUpdateDataMiddleware,
          ),
      });
      store.dispatch(
        loadSimulation({
          celestialBodyPropertiesList: [],
          simulationMetaData:
            outcome === "sessionless" ? null : { sessionID: "old" },
        }),
      );
      let finish!: (value: unknown) => void;
      fetchMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const pending = initializeCelestialBodies(
        store.dispatch as AppDispatch,
        REQUEST_BODY,
      );
      if (outcome === "superseded")
        beginSimulationLaunch(store.dispatch as AppDispatch);
      finish(outcome === "success" ? okResponse("new") : statusResponse(400));
      expect(await pending).toBe(outcome === "success");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(store.getState().request.isLaunchInProgress).toBe(
        outcome === "superseded",
      );
    },
  );
});
