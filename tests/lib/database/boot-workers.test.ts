import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * startBackgroundWorkers arms every in-process timer, and the first of them is
 * the database cleanup. It used to pass a literal five minutes to
 * schedulePeriodicCleanup and ignore CONFIG_DB_CLEANUP_INTERVAL_MS, the
 * constant the admin worker overview judges the pass against, so a self-hoster
 * who changed the constant got a health overview that called a healthy worker
 * late (or never noticed a late one) and a log line that still said five
 * minutes.
 */

const TWO_MINUTES = 2 * 60 * 1000;

const armed = vi.hoisted(() => ({
  schedulePeriodicCleanup: vi.fn(),
  schedulePeriodicStaleScanSweep: vi.fn(),
  schedulePeriodicScheduledScans: vi.fn(),
  schedulePeriodicPostureDigest: vi.fn(),
  schedulePeriodicDomainReverify: vi.fn(),
  schedulePeriodicBackup: vi.fn(),
}));

vi.mock("@/lib/config/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config/constants")>()),
  DB_CLEANUP_INTERVAL: 2 * 60 * 1000,
}));
vi.mock("@/lib/database/cleanup", () => ({
  performDatabaseCleanup: vi.fn(),
  formatCleanupStats: vi.fn(),
  schedulePeriodicCleanup: armed.schedulePeriodicCleanup,
}));
vi.mock("@/lib/scanner/stale-scan-sweep", () => ({
  schedulePeriodicStaleScanSweep: armed.schedulePeriodicStaleScanSweep,
}));
vi.mock("@/lib/scanner/scheduled-scans-worker", () => ({
  schedulePeriodicScheduledScans: armed.schedulePeriodicScheduledScans,
}));
vi.mock("@/lib/notifications/posture-digest", () => ({
  schedulePeriodicPostureDigest: armed.schedulePeriodicPostureDigest,
}));
vi.mock("@/lib/domains/reverify-worker", () => ({
  schedulePeriodicDomainReverify: armed.schedulePeriodicDomainReverify,
}));
vi.mock("@/lib/backup/scheduled-backup-worker", () => ({
  schedulePeriodicBackup: armed.schedulePeriodicBackup,
}));

const { startBackgroundWorkers } = await import("@/lib/database/boot/workers");

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("startBackgroundWorkers", () => {
  it("arms the cleanup on the configured cadence, not on a literal", async () => {
    await startBackgroundWorkers("VulnRadar");
    expect(armed.schedulePeriodicCleanup).toHaveBeenCalledTimes(1);
    expect(armed.schedulePeriodicCleanup).toHaveBeenCalledWith(TWO_MINUTES);
  });

  it("logs the interval it armed, so the line cannot disagree with the timer", async () => {
    await startBackgroundWorkers("VulnRadar");
    const lines = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
    expect(lines).toContain(
      "[VulnRadar] Scheduled periodic database cleanup (2min interval).",
    );
  });

  it("arms every worker", async () => {
    await startBackgroundWorkers("VulnRadar");
    for (const [name, fn] of Object.entries(armed)) {
      expect(fn, name).toHaveBeenCalledTimes(1);
    }
  });

  it("keeps arming the rest when one worker fails to arm", async () => {
    armed.schedulePeriodicStaleScanSweep.mockImplementationOnce(() => {
      throw new Error("no pool");
    });
    await startBackgroundWorkers("VulnRadar");
    expect(armed.schedulePeriodicScheduledScans).toHaveBeenCalledTimes(1);
    expect(armed.schedulePeriodicBackup).toHaveBeenCalledTimes(1);
    const errors = vi.mocked(console.error).mock.calls.map((c) => String(c[0]));
    expect(errors).toContain(
      "[VulnRadar] Failed to schedule the stale-scan sweep:",
    );
  });
});
