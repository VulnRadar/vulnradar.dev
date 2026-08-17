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
    expect(result).toEqual({ acquired: true, queued: false });
    expect(_getInFlightForTests()).toBe(1);
  });

  it("never queues when the cap is disabled (-1)", async () => {
    settingsFor(-1);
    for (let i = 0; i < 10; i++) {
      const result = await acquireConcurrencySlot(false);
      expect(result).toEqual({ acquired: true, queued: false });
    }
    // Disabled cap never increments the in-flight counter at all.
    expect(_getInFlightForTests()).toBe(0);
  });

  it("queues a request once the cap is reached, and admits it after a release", async () => {
    settingsFor(1);
    const first = await acquireConcurrencySlot(false);
    expect(first).toEqual({ acquired: true, queued: false });
    expect(_getInFlightForTests()).toBe(1);

    const secondPromise = acquireConcurrencySlot(false);
    // Give the queued call a tick to actually enqueue before releasing.
    await new Promise((r) => setTimeout(r, 10));

    await releaseConcurrencySlot();
    const second = await secondPromise;
    expect(second).toEqual({ acquired: true, queued: true });
    expect(_getInFlightForTests()).toBe(1);
  });

  it("gives up and returns acquired: false once the queue wait times out", async () => {
    settingsFor(1, 50);
    await acquireConcurrencySlot(false); // fills the only slot, never released
    const result = await acquireConcurrencySlot(false);
    expect(result).toEqual({ acquired: false, queued: true });
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
