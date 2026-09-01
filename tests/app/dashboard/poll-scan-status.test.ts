/**
 * The scan status poll loop (app/dashboard/poll-scan-status.ts).
 *
 * This is the piece of the scanning flow with real logic in it: a retry
 * budget that has to tell a dropped request apart from a failed scan, a
 * per-request deadline for a request that hangs without erroring, abort
 * handling for a cancelled or navigated-away-from scan, and the adaptive
 * interval that decides how soon to look again. It had no tests at all
 * (AUDIT-014#scanui-09), because it lived inside the dashboard page and
 * could not be imported without the whole component tree.
 *
 * Real timers with a tiny pollIntervalMs rather than fake ones: the loop
 * awaits a fetch between every sleep, so a fake clock has to be advanced
 * from outside an async loop it cannot see into, and the resulting tests
 * assert scheduling rather than behaviour. The delay policy itself is a
 * pure function (nextPollDelayMs) and is tested directly below.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  pollScanStatus,
  PollAbortedError,
  nextPollDelayMs,
  type ScanStatusResponse,
} from "@/app/dashboard/poll-scan-status";

/** A poll interval short enough that a multi-iteration test stays quick. */
const FAST = 5;

function jsonResponse(body: ScanStatusResponse, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** Queues one response (or thrown error) per call, in order. */
function fetchSequence(items: (Response | Error)[]) {
  let i = 0;
  return vi.fn(async () => {
    const item = items[Math.min(i, items.length - 1)];
    i++;
    if (item instanceof Error) throw item;
    return item;
  });
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("pollScanStatus", () => {
  it("returns as soon as the scan reports completed", async () => {
    const fetchMock = fetchSequence([
      jsonResponse({ status: "completed", result: { url: "https://a.test" } }),
    ]);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const data = await pollScanStatus(1, 5000, undefined, FAST);

    expect(data.status).toBe("completed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a failed scan rather than treating it as a poll error", async () => {
    globalThis.fetch = fetchSequence([
      jsonResponse({ status: "failed", error: "DNS lookup failed" }),
    ]) as unknown as typeof fetch;

    const data = await pollScanStatus(1, 5000, undefined, FAST);

    expect(data.status).toBe("failed");
    expect(data.error).toBe("DNS lookup failed");
  });

  it("keeps polling while the scan is still running", async () => {
    const fetchMock = fetchSequence([
      jsonResponse({ status: "pending" }),
      jsonResponse({ status: "running" }),
      jsonResponse({ status: "completed" }),
    ]);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const data = await pollScanStatus(7, 5000, undefined, FAST);

    expect(data.status).toBe("completed");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports the server's own progress counters, defaulting the missing ones", async () => {
    globalThis.fetch = fetchSequence([
      jsonResponse({
        status: "running",
        currentCategory: "headers",
        categoriesCompleted: 3,
        categoriesTotal: 20,
      }),
      jsonResponse({ status: "completed" }),
    ]) as unknown as typeof fetch;

    const progress: unknown[] = [];
    await pollScanStatus(1, 5000, (p) => progress.push(p), FAST);

    expect(progress[0]).toEqual({
      currentCategory: "headers",
      categoriesCompleted: 3,
      categoriesTotal: 20,
    });
    // A terminal response that carries no counters must not report NaN.
    expect(progress[1]).toEqual({
      currentCategory: null,
      categoriesCompleted: 0,
      categoriesTotal: 0,
    });
  });

  it("survives isolated failures: the strike count resets on any success", async () => {
    // Five failures, a success, then five more. Six *consecutive* failures
    // is the give-up threshold, so this must still finish rather than
    // abandoning a scan that is running perfectly well server-side.
    const fetchMock = fetchSequence([
      new Error("network"),
      new Error("network"),
      new Error("network"),
      new Error("network"),
      new Error("network"),
      jsonResponse({ status: "running" }),
      new Error("network"),
      new Error("network"),
      jsonResponse({ status: "completed" }),
    ]);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const data = await pollScanStatus(1, 10_000, undefined, FAST);

    expect(data.status).toBe("completed");
  });

  it("gives up after six consecutive failures, and says the scan is still running", async () => {
    globalThis.fetch = fetchSequence([
      new Error("network"),
    ]) as unknown as typeof fetch;

    await expect(pollScanStatus(1, 10_000, undefined, FAST)).rejects.toThrow(
      /still running/i,
    );
  });

  it("treats a non-ok status response as a failed poll, not a failed scan", async () => {
    globalThis.fetch = fetchSequence([
      jsonResponse({ status: "running" }, false, 502),
    ]) as unknown as typeof fetch;

    await expect(pollScanStatus(1, 10_000, undefined, FAST)).rejects.toThrow(
      /still running/i,
    );
  });

  it("throws PollAbortedError immediately when the caller's signal is already aborted", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const controller = new AbortController();
    controller.abort();

    await expect(
      pollScanStatus(1, 5000, undefined, FAST, controller.signal),
    ).rejects.toBeInstanceOf(PollAbortedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws PollAbortedError, not the give-up message, when aborted mid-request", async () => {
    const controller = new AbortController();
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      // A real fetch rejects when its signal aborts; the loop must read that
      // as "the user cancelled", not as one more network strike.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
        setTimeout(() => controller.abort(), 1);
      });
    }) as unknown as typeof fetch;

    await expect(
      pollScanStatus(1, 5000, undefined, FAST, controller.signal),
    ).rejects.toBeInstanceOf(PollAbortedError);
  });

  it("aborts a request that hangs past its own deadline instead of stalling forever", async () => {
    let started = 0;
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      started++;
      // Never resolves on its own. Only the loop's per-request deadline can
      // end it, which is the whole point: a hung request throws nothing, so
      // without the deadline the retry budget never fires.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("deadline")),
        );
      });
    }) as unknown as typeof fetch;

    await expect(pollScanStatus(1, 10_000, undefined, FAST)).rejects.toThrow(
      /still running/i,
    );
    // Six strikes, so six requests were started and each was cut off.
    expect(started).toBe(6);
  });

  it("stops at maxWaitMs with a message that points at history", async () => {
    globalThis.fetch = fetchSequence([
      jsonResponse({ status: "running" }),
    ]) as unknown as typeof fetch;

    await expect(pollScanStatus(1, 30, undefined, FAST)).rejects.toThrow(
      /taking longer than expected/i,
    );
  });
});

describe("nextPollDelayMs", () => {
  it("polls fast for the first couple of seconds, for a result that is effectively immediate", () => {
    expect(nextPollDelayMs(0, false, 2000)).toBe(500);
    expect(nextPollDelayMs(2499, false, 2000)).toBe(500);
  });

  it("drops back to the configured interval once past that window", () => {
    expect(nextPollDelayMs(2500, false, 2000)).toBe(2000);
    expect(nextPollDelayMs(60_000, false, 2000)).toBe(2000);
  });

  it("tightens up again once the server reports the final check family", () => {
    // This is the window the result actually lands in, and a flat interval
    // spent up to a full 2s of it showing a progress bar for a finished scan.
    expect(nextPollDelayMs(60_000, true, 2000)).toBe(500);
  });

  it("never polls faster than a deployment's own configured interval", () => {
    // A self-host that sets a deliberately long interval is not overridden,
    // and one that sets a short one is not slowed down.
    expect(nextPollDelayMs(0, false, 200)).toBe(200);
    expect(nextPollDelayMs(60_000, true, 200)).toBe(200);
  });
});
