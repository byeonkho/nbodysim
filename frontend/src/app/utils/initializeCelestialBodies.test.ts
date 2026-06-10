import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries a cold-wake 502 then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(statusResponse(502))
      .mockResolvedValueOnce(okResponse());
    const dispatch = vi.fn() as unknown as AppDispatch;
    const onRetry = vi.fn();

    const promise = initializeCelestialBodies(dispatch, REQUEST_BODY, { onRetry });
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
});
