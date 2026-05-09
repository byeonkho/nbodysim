import { describe, expect, it } from "vitest";
import eventLogReducer, {
  clearEvents,
  pushEvent,
  setEventFilter,
} from "./EventLogSlice";

// Critical contract: the events array is capped (currently at 200)
// to bound memory. A regression there grows the array unboundedly
// across a session — silent failure that would only show up under
// long uptimes. Keep this pinned.

type Slice = ReturnType<typeof eventLogReducer>;

const initialState = (): Slice =>
  eventLogReducer(undefined, { type: "@@INIT" });

describe("EventLogSlice — pushEvent", () => {
  it("inserts at the head of the events list", () => {
    let state = initialState();
    state = eventLogReducer(
      state,
      pushEvent({ source: "USR", severity: "user", message: "first" }),
    );
    state = eventLogReducer(
      state,
      pushEvent({ source: "USR", severity: "user", message: "second" }),
    );
    expect(state.events.map((e) => e.message)).toEqual(["second", "first"]);
  });

  it("assigns monotonically increasing ids", () => {
    let state = initialState();
    state = eventLogReducer(
      state,
      pushEvent({ source: "USR", severity: "user", message: "a" }),
    );
    state = eventLogReducer(
      state,
      pushEvent({ source: "USR", severity: "user", message: "b" }),
    );
    const [b, a] = state.events;
    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
    expect(state.nextId).toBe(3);
  });

  it("uses Date.now() when ts is not supplied", () => {
    let state = initialState();
    const before = Date.now();
    state = eventLogReducer(
      state,
      pushEvent({ source: "USR", severity: "user", message: "x" }),
    );
    const after = Date.now();
    expect(state.events[0].ts).toBeGreaterThanOrEqual(before);
    expect(state.events[0].ts).toBeLessThanOrEqual(after);
  });

  it("uses the supplied ts when provided", () => {
    let state = initialState();
    state = eventLogReducer(
      state,
      pushEvent({
        source: "SIM",
        severity: "info",
        message: "fixed",
        ts: 1234567,
      }),
    );
    expect(state.events[0].ts).toBe(1234567);
  });

  it("caps the buffer at 200 entries (bounded-memory contract)", () => {
    let state: Slice = initialState();
    for (let i = 0; i < 250; i++) {
      state = eventLogReducer(
        state,
        pushEvent({ source: "USR", severity: "user", message: `m${i}` }),
      );
    }
    expect(state.events.length).toBe(200);
    // Newest at head — most recent push survives.
    expect(state.events[0].message).toBe("m249");
    // Oldest 50 dropped.
    const messages = state.events.map((e) => e.message);
    expect(messages).not.toContain("m0");
    expect(messages).not.toContain("m49");
    expect(messages).toContain("m50");
    // ids continue to climb past the cap (no recycling).
    expect(state.nextId).toBe(251);
  });
});

describe("EventLogSlice — setEventFilter", () => {
  it("updates the filter", () => {
    let state = initialState();
    state = eventLogReducer(state, setEventFilter("SIM"));
    expect(state.filter).toBe("SIM");
    state = eventLogReducer(state, setEventFilter("ALL"));
    expect(state.filter).toBe("ALL");
  });
});

describe("EventLogSlice — clearEvents", () => {
  it("empties events but preserves nextId so ids never collide", () => {
    let state = initialState();
    state = eventLogReducer(
      state,
      pushEvent({ source: "USR", severity: "user", message: "a" }),
    );
    state = eventLogReducer(
      state,
      pushEvent({ source: "USR", severity: "user", message: "b" }),
    );
    state = eventLogReducer(state, clearEvents());
    expect(state.events).toEqual([]);
    expect(state.nextId).toBe(3);
  });
});
