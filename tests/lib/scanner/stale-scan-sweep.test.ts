/**
 * Tests for lib/scanner/stale-scan-sweep.ts: the stale-scan reaper's two
 * callers, the boot pass and the repeating timer.
 *
 * The sweep's own SQL (and its age guard) belongs to sweepStaleScans and is
 * covered by tests/lib/scanner/scan-jobs.test.ts, so it is mocked here. What
 * this file is responsible for is that the sweep runs at all on a timer, that
 * an operator can tell a boot sweep from an in-process one, and that a pass
 * which throws is reported as a failed pass rather than a healthy one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSweepStaleScans = vi.fn();
vi.mock("@/lib/scanner/scan-jobs", () => ({
  sweepStaleScans: (...args: unknown[]) => mockSweepStaleScans(...args),
}));

const mockSendAdminAlert = vi.fn();
vi.mock("@/lib/admin/alert-webhook", () => ({
  sendAdminAlert: (...args: unknown[]) => mockSendAdminAlert(...args),
}));

const mockRecordSuccess = vi.fn();
const mockRecordFailure = vi.fn();
vi.mock("@/lib/admin/failure-escalation", () => ({
  createFailureEscalator: () => ({
    recordSuccess: mockRecordSuccess,
    recordFailure: mockRecordFailure,
  }),
}));

const {
  runStaleScanSweep,
  schedulePeriodicStaleScanSweep,
  stopPeriodicStaleScanSweep,
} = await import("@/lib/scanner/stale-scan-sweep");
const { CONFIG_STALE_SCAN_SWEEP_INTERVAL_MS } =
  await import("@/lib/config/config-values");

beforeEach(() => {
  mockSweepStaleScans.mockReset();
  mockSweepStaleScans.mockResolvedValue([]);
  mockSendAdminAlert.mockReset();
  mockSendAdminAlert.mockResolvedValue({ delivered: true, status: 200 });
  mockRecordSuccess.mockReset();
  mockRecordFailure.mockReset();
});

function sweptRows(ids: number[], category: string | null = null) {
  return ids.map((id) => ({
    id,
    user_id: id * 10,
    url: `https://customer-${id}.example/`,
    source: "web",
    current_category: category,
    started_at: "2026-08-13T10:00:00.000Z",
  }));
}

describe("runStaleScanSweep", () => {
  it("says nothing when there was nothing to sweep", async () => {
    const swept = await runStaleScanSweep("periodic");
    expect(swept).toBe(0);
    expect(mockSendAdminAlert).not.toHaveBeenCalled();
  });

  it("hands the trigger to the sweep, which picks the reason from it", async () => {
    await runStaleScanSweep("boot");
    await runStaleScanSweep("periodic");
    expect(mockSweepStaleScans.mock.calls).toEqual([["boot"], ["periodic"]]);
  });

  it("alerts about an unclean restart when the boot pass finds rows", async () => {
    mockSweepStaleScans.mockResolvedValue(sweptRows([5, 6, 7]));

    const swept = await runStaleScanSweep("boot");

    expect(swept).toBe(3);
    const alert = mockSendAdminAlert.mock.calls[0][0];
    expect(alert.event).toBe("stale_scans_swept");
    expect(alert.message).toContain("previous process");
    expect(alert.context).toEqual({
      count: 3,
      trigger: "boot",
      scanIds: [5, 6, 7],
    });
  });

  // The two cases are different bugs. A boot sweep means the process died
  // mid-scan; an in-process one means something finished a scan without ever
  // closing its row, which no restart explains and which the watchdog was
  // supposed to prevent.
  it("says the rows went stale while the server was up when the timer finds them", async () => {
    mockSweepStaleScans.mockResolvedValue(sweptRows([8, 9]));

    await runStaleScanSweep("periodic");

    const alert = mockSendAdminAlert.mock.calls[0][0];
    expect(alert.message).toContain("while the server was running");
    expect(alert.message).not.toContain("previous process");
    expect(alert.context).toEqual({
      count: 2,
      trigger: "periodic",
      scanIds: [8, 9],
    });
  });

  // A count says THAT scans went stale; the ids say which. The line and the
  // alert both used to carry only the count.
  it("names the scans in the log line as well as the alert", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSweepStaleScans.mockResolvedValue(sweptRows([41, 42], "dns"));

    await runStaleScanSweep("periodic");

    expect(spy).toHaveBeenCalledTimes(1);
    const [message, context] = spy.mock.calls[0];
    expect(String(message)).toContain("went stale");
    expect(context).toMatchObject({
      count: 2,
      trigger: "periodic",
      scanIds: "41,42",
      categories: "dns",
    });
    spy.mockRestore();
  });

  it("names at most twenty, and still reports the true count", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSweepStaleScans.mockResolvedValue(
      sweptRows(Array.from({ length: 30 }, (_, i) => i + 1)),
    );

    await runStaleScanSweep("periodic");

    const alert = mockSendAdminAlert.mock.calls[0][0];
    expect(alert.context.count).toBe(30);
    expect(alert.context.scanIds).toHaveLength(20);
    expect(alert.context.scanIds[0]).toBe(1);
    spy.mockRestore();
  });

  it("never puts a customer's URL or user id in the alert", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSweepStaleScans.mockResolvedValue(sweptRows([3]));

    await runStaleScanSweep("periodic");

    const alert = JSON.stringify(mockSendAdminAlert.mock.calls[0][0]);
    expect(alert).not.toContain("customer-3.example");
    expect(alert).not.toContain("user_id");
    spy.mockRestore();
  });

  it("propagates a sweep failure so its caller can count a failed pass", async () => {
    mockSweepStaleScans.mockRejectedValue(new Error("connection reset"));
    await expect(runStaleScanSweep("periodic")).rejects.toThrow(
      "connection reset",
    );
  });
});

describe("schedulePeriodicStaleScanSweep / stopPeriodicStaleScanSweep", () => {
  // The whole point of the fix: sweepStaleScans used to have exactly one
  // caller, the boot safety net, so a scan orphaned while the process was up
  // held its owner's concurrency slot until someone deployed.
  it("actually sweeps on every tick, not only at boot", async () => {
    vi.useFakeTimers();
    try {
      schedulePeriodicStaleScanSweep(60_000);
      await vi.advanceTimersByTimeAsync(180_000);
      expect(mockSweepStaleScans).toHaveBeenCalledTimes(3);
      expect(mockRecordSuccess).toHaveBeenCalledTimes(3);
      expect(mockRecordFailure).not.toHaveBeenCalled();
    } finally {
      stopPeriodicStaleScanSweep();
      vi.useRealTimers();
    }
  });

  it("records a failed pass when the sweep throws", async () => {
    vi.useFakeTimers();
    try {
      mockSweepStaleScans.mockRejectedValue(new Error("connection reset"));
      schedulePeriodicStaleScanSweep(60_000);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mockRecordFailure).toHaveBeenCalledTimes(1);
      expect(mockRecordSuccess).not.toHaveBeenCalled();
    } finally {
      stopPeriodicStaleScanSweep();
      vi.useRealTimers();
    }
  });

  it("registers the interval it was given and clears that exact handle on stop", () => {
    vi.useFakeTimers();
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    try {
      const timer = schedulePeriodicStaleScanSweep(60_000);

      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy.mock.calls[0][1]).toBe(60_000);
      expect(setSpy.mock.results[0].value).toBe(timer);

      stopPeriodicStaleScanSweep();
      expect(clearSpy).toHaveBeenCalledWith(timer);

      // Idempotent, not merely non-throwing.
      const clearedOnce = clearSpy.mock.calls.length;
      stopPeriodicStaleScanSweep();
      expect(clearSpy.mock.calls.length).toBe(clearedOnce);
    } finally {
      setSpy.mockRestore();
      clearSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("falls back to the shipped interval instead of registering a 0 ms timer", () => {
    vi.useFakeTimers();
    const setSpy = vi.spyOn(globalThis, "setInterval");
    try {
      schedulePeriodicStaleScanSweep(0);
      expect(setSpy.mock.calls[0][1]).toBe(CONFIG_STALE_SCAN_SWEEP_INTERVAL_MS);

      setSpy.mockClear();
      schedulePeriodicStaleScanSweep(Number.NaN);
      expect(setSpy.mock.calls[0][1]).toBe(CONFIG_STALE_SCAN_SWEEP_INTERVAL_MS);
    } finally {
      stopPeriodicStaleScanSweep();
      setSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("replaces a previously registered timer rather than running two", () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    try {
      const first = schedulePeriodicStaleScanSweep(60_000);
      schedulePeriodicStaleScanSweep(60_000);
      expect(clearSpy).toHaveBeenCalledWith(first);
    } finally {
      stopPeriodicStaleScanSweep();
      clearSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
