import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const stopped = vi.hoisted(() => ({
  stopPeriodicCleanup: vi.fn(),
  stopPeriodicStaleScanSweep: vi.fn(),
  stopPeriodicPostureDigest: vi.fn(),
  stopPeriodicDomainReverify: vi.fn(),
  stopPeriodicBackup: vi.fn(),
}));
const performDatabaseCleanup = vi.hoisted(() => vi.fn());

vi.mock("@/lib/database/cleanup", () => ({
  performDatabaseCleanup,
  formatCleanupStats: vi.fn(),
  schedulePeriodicCleanup: armed.schedulePeriodicCleanup,
  stopPeriodicCleanup: stopped.stopPeriodicCleanup,
}));
vi.mock("@/lib/scanner/stale-scan-sweep", () => ({
  schedulePeriodicStaleScanSweep: armed.schedulePeriodicStaleScanSweep,
  stopPeriodicStaleScanSweep: stopped.stopPeriodicStaleScanSweep,
}));
vi.mock("@/lib/scanner/scheduled-scans-worker", () => ({
  schedulePeriodicScheduledScans: armed.schedulePeriodicScheduledScans,
}));
vi.mock("@/lib/notifications/posture-digest", () => ({
  schedulePeriodicPostureDigest: armed.schedulePeriodicPostureDigest,
  stopPeriodicPostureDigest: stopped.stopPeriodicPostureDigest,
}));
vi.mock("@/lib/domains/reverify-worker", () => ({
  schedulePeriodicDomainReverify: armed.schedulePeriodicDomainReverify,
  stopPeriodicDomainReverify: stopped.stopPeriodicDomainReverify,
}));

// register() itself, for the case where the first cleanup pass is still going.
vi.mock("@/lib/config/env", () => ({ validateEnv: vi.fn() }));
vi.mock("@/lib/database/db", () => ({ default: { end: vi.fn() } }));
vi.mock("@/lib/database/error-log-capture", () => ({
  installErrorLogCapture: vi.fn(),
}));
vi.mock("@/lib/database/boot/schema-version", () => ({
  ensureSchemaVersion: vi.fn(async () => {}),
}));
vi.mock("@/lib/database/boot/release-check", () => ({
  reportRunningVersion: vi.fn(async () => {}),
}));
vi.mock("@/lib/database/boot/schema-lock", () => ({
  acquireBootSchemaLock: vi.fn(async () => null),
  releaseBootSchemaLock: vi.fn(async () => {}),
}));
vi.mock("@/lib/database/boot/apply-boot-schema", () => ({
  applyBootSchema: vi.fn(async () => {}),
}));
vi.mock("@/lib/database/boot/backfills", () => ({
  runBootBackfills: vi.fn(async () => {}),
}));
vi.mock("@/lib/database/boot/safety-nets", () => ({
  runBootSafetyNets: vi.fn(async () => {}),
}));
vi.mock("@/lib/database/boot/app-url-drift", () => ({
  reportAppUrlDrift: vi.fn(async () => {}),
}));

vi.mock("@/lib/backup/scheduled-backup-worker", () => ({
  schedulePeriodicBackup: armed.schedulePeriodicBackup,
  stopPeriodicBackup: stopped.stopPeriodicBackup,
}));

const { runInitialCleanup, startBackgroundWorkers, stopBackgroundWorkers } =
  await import("@/lib/database/boot/workers");
const { register } = await import("@/instrumentation");

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

describe("stopBackgroundWorkers", () => {
  it("stops every timer it armed, the scheduled-scans one by its handle", async () => {
    const timer = setInterval(() => {}, 60_000);
    const clear = vi.spyOn(globalThis, "clearInterval");
    armed.schedulePeriodicScheduledScans.mockReturnValueOnce(timer);
    try {
      await startBackgroundWorkers("VulnRadar");
      await stopBackgroundWorkers("VulnRadar");

      for (const [name, fn] of Object.entries(stopped)) {
        expect(fn, name).toHaveBeenCalledTimes(1);
      }
      expect(clear).toHaveBeenCalledWith(timer);
    } finally {
      clear.mockRestore();
      clearInterval(timer);
    }
  });

  it("keeps stopping the rest when one stop throws", async () => {
    stopped.stopPeriodicCleanup.mockImplementationOnce(() => {
      throw new Error("no timer");
    });
    await stopBackgroundWorkers("VulnRadar");
    expect(stopped.stopPeriodicBackup).toHaveBeenCalledTimes(1);
  });
});

describe("the first cleanup pass does not hold up the boot", () => {
  const original = process.env.NEXT_RUNTIME;

  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = original;
  });

  it("register() resolves while the cleanup promise is still pending", async () => {
    // A retention pass on a large database takes minutes, and Next serves
    // nothing until register() resolves, so the health probe waited on it and
    // a slow pass read as a dead container.
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.DATABASE_URL ??= "postgresql://u:p@localhost/db";
    let finish!: (stats: unknown) => void;
    performDatabaseCleanup.mockReturnValueOnce(
      new Promise((resolve) => (finish = resolve)),
    );

    const outcome = await Promise.race([
      register().then(() => "resolved"),
      new Promise((resolve) => setTimeout(() => resolve("waited"), 1_000)),
    ]);

    expect(outcome).toBe("resolved");
    expect(performDatabaseCleanup).toHaveBeenCalledTimes(1);
    expect(armed.schedulePeriodicCleanup).toHaveBeenCalledTimes(1);
    finish({});
  });

  it("swallows a failed first pass rather than rejecting a promise nobody awaits", async () => {
    performDatabaseCleanup.mockRejectedValueOnce(new Error("timeout"));
    await expect(runInitialCleanup("VulnRadar")).resolves.toBeUndefined();
    const errors = vi.mocked(console.error).mock.calls.map((c) => String(c[0]));
    expect(errors).toContain("[VulnRadar] Initial cleanup failed (non-fatal):");
  });
});
