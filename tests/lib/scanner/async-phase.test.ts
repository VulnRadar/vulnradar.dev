import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { AsyncCheckResult } from "@/lib/scanner/async-checks";

// ScanCancelledError lives in scan-jobs.ts, which imports the pool.
vi.mock("@/lib/database/db", () => ({ default: { query: vi.fn() } }));

const mockRunAsyncChecksDetailed = vi.fn();
const mockGetPlannedAsyncBranches = vi.fn();
vi.mock("@/lib/scanner/async-checks", () => ({
  runAsyncChecksDetailed: (...args: unknown[]) =>
    mockRunAsyncChecksDetailed(...args),
  getPlannedAsyncBranches: (...args: unknown[]) =>
    mockGetPlannedAsyncBranches(...args),
}));

const { startAsyncPhase, asyncOuterTimeoutMs } =
  await import("@/lib/scanner/async-phase");
const { ScanCancelledError } = await import("@/lib/scanner/scan-jobs");

const PLANNED = ["dns", "tls", "live-fetch"];

/** The signal the phase handed to runAsyncChecksDetailed. */
function signalPassed(): AbortSignal {
  return mockRunAsyncChecksDetailed.mock.calls[0][3] as AbortSignal;
}

beforeEach(() => {
  vi.useFakeTimers();
  mockRunAsyncChecksDetailed.mockReset();
  mockGetPlannedAsyncBranches.mockReset();
  mockGetPlannedAsyncBranches.mockReturnValue(PLANNED);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("asyncOuterTimeoutMs", () => {
  it("keeps the outer ceiling at least 2s past the branch timeout", () => {
    // Configured below the branch timeout: the outer race would fire first
    // and discard branches that had already finished.
    expect(asyncOuterTimeoutMs(3_000, 12_000)).toBe(14_000);
    expect(asyncOuterTimeoutMs(12_000, 12_000)).toBe(14_000);
  });

  it("leaves a ceiling that is already clear of the branch timeout alone", () => {
    expect(asyncOuterTimeoutMs(15_000, 12_000)).toBe(15_000);
  });
});

describe("startAsyncPhase", () => {
  it("returns what the checks reported when they settle in time", async () => {
    const finding = { id: "dns-1" };
    mockRunAsyncChecksDetailed.mockResolvedValue({
      findings: [finding],
      incomplete: ["tls"],
    } satisfies Partial<AsyncCheckResult> as unknown as AsyncCheckResult);

    const result = await startAsyncPhase({
      url: "https://example.com",
      scanners: null,
      checksTimeoutMs: 15_000,
    });

    expect(result).toEqual({
      findings: [finding],
      incomplete: ["tls"],
      timedOut: false,
    });
  });

  it("passes the url, scanners, progress hook and scope through to the checks", async () => {
    mockRunAsyncChecksDetailed.mockResolvedValue({
      findings: [],
      incomplete: [],
    });
    const onProgress = vi.fn();

    await startAsyncPhase({
      url: "https://example.com/a",
      scanners: ["dns"],
      scope: "page",
      onProgress,
      checksTimeoutMs: 15_000,
    });

    const [url, scanners, hook, , scope] =
      mockRunAsyncChecksDetailed.mock.calls[0];
    expect(url).toBe("https://example.com/a");
    expect(scanners).toEqual(["dns"]);
    expect(hook).toBe(onProgress);
    expect(scope).toBe("page");
    expect(mockGetPlannedAsyncBranches).toHaveBeenCalledWith(
      "https://example.com/a",
      ["dns"],
      "page",
    );
  });

  it("reports every planned branch as not completed when the ceiling wins, and aborts the checks", async () => {
    mockRunAsyncChecksDetailed.mockReturnValue(new Promise(() => {}));

    const phase = startAsyncPhase({
      url: "https://example.com",
      scanners: null,
      checksTimeoutMs: 15_000,
    });
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(phase).resolves.toEqual({
      findings: [],
      incomplete: PLANNED,
      timedOut: true,
    });
    // Nobody is waiting for the live-fetch battery any more, so it must
    // stop hitting the target.
    expect(signalPassed().aborted).toBe(true);
  });

  it("clamps the ceiling to stay above the branch timeout", async () => {
    mockRunAsyncChecksDetailed.mockReturnValue(new Promise(() => {}));

    const phase = startAsyncPhase({
      url: "https://example.com",
      scanners: null,
      checksTimeoutMs: 3_000,
      branchTimeoutMs: 12_000,
    });
    let settled = false;
    void phase.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(13_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });

  it("uses the configured ceiling as is when no branch timeout is given", async () => {
    mockRunAsyncChecksDetailed.mockReturnValue(new Promise(() => {}));

    const phase = startAsyncPhase({
      url: "https://example.com",
      scanners: null,
      checksTimeoutMs: 3_000,
    });
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(phase).resolves.toMatchObject({ timedOut: true });
  });

  it("clears its timer when the checks win, so it cannot fire late", async () => {
    mockRunAsyncChecksDetailed.mockResolvedValue({
      findings: [],
      incomplete: [],
    });

    await startAsyncPhase({
      url: "https://example.com",
      scanners: null,
      checksTimeoutMs: 15_000,
    });

    expect(vi.getTimerCount()).toBe(0);
    expect(signalPassed().aborted).toBe(true);
  });

  it("reports every planned branch as not completed when the checks fail outright", async () => {
    mockRunAsyncChecksDetailed.mockRejectedValue(new Error("boom"));

    await expect(
      startAsyncPhase({
        url: "https://example.com",
        scanners: null,
        checksTimeoutMs: 15_000,
      }),
    ).resolves.toEqual({ findings: [], incomplete: PLANNED, timedOut: false });
  });

  it("rethrows a cancel instead of reporting it as an incomplete scan", async () => {
    mockRunAsyncChecksDetailed.mockRejectedValue(new ScanCancelledError());

    await expect(
      startAsyncPhase({
        url: "https://example.com",
        scanners: null,
        checksTimeoutMs: 15_000,
      }),
    ).rejects.toBeInstanceOf(ScanCancelledError);
  });

  it("joins the parent signal, so cancelling the scan aborts the checks", async () => {
    mockRunAsyncChecksDetailed.mockReturnValue(new Promise(() => {}));
    const parent = new AbortController();

    void startAsyncPhase({
      url: "https://example.com",
      scanners: null,
      parentSignal: parent.signal,
      checksTimeoutMs: 15_000,
    });
    expect(signalPassed().aborted).toBe(false);
    parent.abort();
    expect(signalPassed().aborted).toBe(true);
  });

  it("never aborts the parent signal itself", async () => {
    mockRunAsyncChecksDetailed.mockResolvedValue({
      findings: [],
      incomplete: [],
    });
    const parent = new AbortController();

    await startAsyncPhase({
      url: "https://example.com",
      scanners: null,
      parentSignal: parent.signal,
      checksTimeoutMs: 15_000,
    });

    expect(parent.signal.aborted).toBe(false);
  });

  it("does not leave an unhandled rejection when a cancel lands before anyone awaits", async () => {
    vi.useRealTimers();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      mockRunAsyncChecksDetailed.mockRejectedValue(new ScanCancelledError());
      const phase = startAsyncPhase({
        url: "https://example.com",
        scanners: null,
        checksTimeoutMs: 15_000,
      });
      // A turn of the event loop, which is when Node reports a rejection
      // nobody handled.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).not.toHaveBeenCalled();
      await expect(phase).rejects.toBeInstanceOf(ScanCancelledError);
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
