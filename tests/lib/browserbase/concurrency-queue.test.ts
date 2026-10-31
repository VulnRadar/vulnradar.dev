import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSetting = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

// Module-load-time reconcileFromDb() calls pool.query -- give it a
// resolved value before the very first import touches the module.
mockQuery.mockResolvedValue({ rows: [{ count: 0 }] });

const {
  acquireConcurrencySlot,
  releaseConcurrencySlot,
  _resetConcurrencyQueueForTests,
  _getInFlightForTests,
} = await import("@/lib/browserbase/concurrency-queue");

function settingsFor(maxConcurrent: number, maxWaitMs = 300) {
  mockGetSetting.mockImplementation(async (key: string) => {
    if (key === "BROWSERBASE_MAX_CONCURRENT_SESSIONS") return maxConcurrent;
    if (key === "BROWSERBASE_QUEUE_MAX_WAIT_MS") return maxWaitMs;
    throw new Error(`unexpected setting: ${key}`);
  });
}

beforeEach(() => {
  _resetConcurrencyQueueForTests();
  mockGetSetting.mockReset();
});

describe("acquireConcurrencySlot", () => {
  it("acquires immediately when under the concurrency cap", async () => {
    settingsFor(5);
    const result = await acquireConcurrencySlot(false);
    expect(result).toEqual({ acquired: true, queued: false, counted: true });
    expect(_getInFlightForTests()).toBe(1);
  });

  it("never queues when the cap is disabled (-1), but still counts each session", async () => {
    settingsFor(-1);
    for (let i = 0; i < 10; i++) {
      const result = await acquireConcurrencySlot(false);
      expect(result).toEqual({ acquired: true, queued: false, counted: true });
    }
    // The cap comparison is skipped, the count is not: every one of these
    // sessions will release a unit when it ends.
    expect(_getInFlightForTests()).toBe(10);
  });

  it("queues a request once the cap is reached, and admits it after a release", async () => {
    settingsFor(1);
    const first = await acquireConcurrencySlot(false);
    expect(first).toEqual({ acquired: true, queued: false, counted: true });
    expect(_getInFlightForTests()).toBe(1);

    const secondPromise = acquireConcurrencySlot(false);
    // Give the queued call a tick to actually enqueue before releasing.
    await new Promise((r) => setTimeout(r, 10));

    await releaseConcurrencySlot();
    const second = await secondPromise;
    expect(second).toEqual({ acquired: true, queued: true, counted: true });
    expect(_getInFlightForTests()).toBe(1);
  });

  it("gives up and returns acquired: false once the queue wait times out", async () => {
    settingsFor(1, 50);
    await acquireConcurrencySlot(false); // fills the only slot, never released
    const result = await acquireConcurrencySlot(false);
    expect(result).toEqual({ acquired: false, queued: true, counted: false });
    // The timed-out waiter never actually consumed a slot.
    expect(_getInFlightForTests()).toBe(1);
  });

  it("admits a priority (paid-plan) waiter before a non-priority one queued earlier", async () => {
    settingsFor(1, 2000);
    await acquireConcurrencySlot(false); // fills the only slot

    const freeWaiter = acquireConcurrencySlot(false);
    await new Promise((r) => setTimeout(r, 10));
    const paidWaiter = acquireConcurrencySlot(true);
    await new Promise((r) => setTimeout(r, 10));

    await releaseConcurrencySlot(); // exactly one slot frees

    const paidResult = await paidWaiter;
    expect(paidResult.acquired).toBe(true);

    // The still-waiting free caller has not been admitted -- release once
    // more to let it through and clean up the test.
    await releaseConcurrencySlot();
    const freeResult = await freeWaiter;
    expect(freeResult.acquired).toBe(true);
  });

  it("releaseConcurrencySlot never goes negative when nothing was acquired", async () => {
    settingsFor(3);
    await releaseConcurrencySlot();
    await releaseConcurrencySlot();
    expect(_getInFlightForTests()).toBe(0);
  });
});

describe("releaseConcurrencySlot with the acquire's result", () => {
  it("gives back the unit a counted acquire took", async () => {
    settingsFor(5);
    const slot = await acquireConcurrencySlot(false);
    expect(slot.counted).toBe(true);
    await releaseConcurrencySlot(slot);
    expect(_getInFlightForTests()).toBe(0);
  });

  it("gives back nothing for a request that timed out waiting, so it cannot free a running session's slot", async () => {
    settingsFor(1, 30);
    const running = await acquireConcurrencySlot(false);
    expect(running.counted).toBe(true);

    const timedOut = await acquireConcurrencySlot(false);
    expect(timedOut).toEqual({ acquired: false, queued: true, counted: false });

    // A caller that releases unconditionally in a finally block would have
    // taken the running session's slot here.
    await releaseConcurrencySlot(timedOut);
    expect(_getInFlightForTests()).toBe(1);
  });

  it("releases one unit when called with no result, for the callers that end a session in a later request", async () => {
    settingsFor(5);
    await acquireConcurrencySlot(false);
    await acquireConcurrencySlot(false);
    await releaseConcurrencySlot();
    expect(_getInFlightForTests()).toBe(1);
  });
});

describe("a cap turned on while sessions opened without one are still running", () => {
  // The drift this guards against: with the cap disabled, acquires were not
  // counted, so when one of those sessions ended it released a unit that a
  // different, capped session held. The counter then under-read and more than
  // the cap ran at once.
  it("keeps the cap exact when the uncapped sessions end", async () => {
    settingsFor(-1);
    const uncapped = await acquireConcurrencySlot(false);
    expect(uncapped.counted).toBe(true);

    // The admin sets a cap of one. The uncapped session is still open, so the
    // next request has to wait for it.
    settingsFor(1, 2000);
    const capped = acquireConcurrencySlot(false);
    await new Promise((r) => setTimeout(r, 10));
    expect(_getInFlightForTests()).toBe(1);

    // The uncapped session ends in a later request, with no result in hand.
    await releaseConcurrencySlot();
    const cappedResult = await capped;
    expect(cappedResult).toEqual({
      acquired: true,
      queued: true,
      counted: true,
    });
    expect(_getInFlightForTests()).toBe(1);

    // The capped session is running now. A third request must wait: with the
    // old accounting the uncapped session's release had already taken this
    // slot back, and a third session ran alongside it.
    settingsFor(1, 30);
    const third = await acquireConcurrencySlot(false);
    expect(third.acquired).toBe(false);
    expect(_getInFlightForTests()).toBe(1);
  });

  it("keeps counting sessions that end after the cap is turned back off", async () => {
    settingsFor(2);
    const a = await acquireConcurrencySlot(false);
    const b = await acquireConcurrencySlot(false);
    settingsFor(-1);
    const c = await acquireConcurrencySlot(false);
    expect([a, b, c].every((s) => s.counted)).toBe(true);
    expect(_getInFlightForTests()).toBe(3);

    await releaseConcurrencySlot();
    await releaseConcurrencySlot();
    await releaseConcurrencySlot();
    expect(_getInFlightForTests()).toBe(0);
  });
});
