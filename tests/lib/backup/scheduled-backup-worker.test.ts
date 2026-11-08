/**
 * Tests for lib/backup/scheduled-backup-worker.ts (AUDIT-010, prodready-05):
 * a periodic pg_dump backup independent of a migration running or an admin
 * clicking the manual-backup button.
 *
 * node:child_process is mocked (same as tests/lib/backup/run-backup.test.ts,
 * which this reuses runBackupJob's real, unmocked implementation against),
 * so runScheduledBackupPass exercises the real job-store single-flight logic
 * without ever spawning a real pg_dump process.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const mockSpawn = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

const mockGetSetting = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

// Not called directly by this module, but createFailureEscalator's import
// chain (lib/admin/alert-webhook.ts -> lib/webhooks/delivery.ts) reaches
// lib/database/db.ts, which throws at import time when DATABASE_URL isn't
// set -- same reason tests/lib/notifications/posture-digest.test.ts mocks
// this boundary even though its own assertions never touch it.
const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockReaddir = vi.fn();
const mockStat = vi.fn();
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  readdir: (...args: unknown[]) => mockReaddir(...args),
  stat: (...args: unknown[]) => mockStat(...args),
}));

const {
  BACKUP_BOOT_CHECK_DELAY_MS,
  BACKUP_TICK_MS,
  runScheduledBackupPass,
  schedulePeriodicBackup,
  stopPeriodicBackup,
} = await import("@/lib/backup/scheduled-backup-worker");
const { createJob, getActiveJobId, getLatestJob, __resetForTests } =
  await import("@/lib/backup/job-store");
const { CONFIG_SCHEDULED_BACKUP_INTERVAL_MS } =
  await import("@/lib/config/config-values");

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: (signal?: string) => void;
}

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

beforeEach(() => {
  __resetForTests();
  mockSpawn.mockReset();
  mockGetSetting.mockReset();
  mockReaddir.mockReset();
  mockStat.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  // No backups on disk unless a test says otherwise: a missing directory is
  // what a fresh install has.
  mockReaddir.mockRejectedValue(new Error("ENOENT"));
});

const HOUR = 60 * 60 * 1000;

/** Put files of the given ages (in hours) in the backup directory. */
function backupsAged(files: Record<string, number>) {
  const now = Date.now();
  mockReaddir.mockResolvedValue(Object.keys(files));
  mockStat.mockImplementation(async (full: string) => {
    const name = Object.keys(files).find((f) => full.endsWith(f));
    if (!name) throw new Error("ENOENT");
    return { mtimeMs: now - files[name] * HOUR };
  });
}

describe("runScheduledBackupPass", () => {
  it("returns 'disabled' and never spawns anything when SCHEDULED_BACKUP_ENABLED is off", async () => {
    mockGetSetting.mockResolvedValue(false);
    const outcome = await runScheduledBackupPass();
    expect(outcome).toBe("disabled");
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(getActiveJobId()).toBeNull();
  });

  it("starts a job with no user attached (system-triggered) when enabled", async () => {
    mockGetSetting.mockResolvedValue(true);
    const child = fakeChild();
    mockSpawn.mockReturnValue(child);

    const promise = runScheduledBackupPass();
    // Unlike run-backup.test.ts's direct call, runScheduledBackupPass has an
    // `await getSetting(...)` before it ever reaches runBackupJob's spawn()
    // call, so the child process doesn't exist yet on the very next
    // synchronous line -- wait for the spawn to actually happen before
    // emitting the exit event it's listening for.
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    child.emit("close", 0);
    const outcome = await promise;

    expect(outcome).toBe("started");
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const latest = getLatestJob();
    expect(latest?.startedByUserId).toBeNull();
    expect(latest?.status).toBe("success");
  });

  it("returns 'failed' (not 'started') when the pg_dump exits non-zero", async () => {
    // Regression for AUDIT-012 obs-02: runBackupJob never rejects, so the pass
    // used to return "started" for a backup that failed on every run and the
    // interval below reported a clean pass to the failure escalator. A broken
    // backup must be distinguishable from a working one.
    mockGetSetting.mockResolvedValue(true);
    const child = fakeChild();
    mockSpawn.mockReturnValue(child);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const promise = runScheduledBackupPass();
      await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
      child.emit("close", 1);
      expect(await promise).toBe("failed");
      expect(getLatestJob()?.status).toBe("failed");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("skips (does not spawn a second pg_dump) when a job is already active", async () => {
    mockGetSetting.mockResolvedValue(true);
    // An admin's manual run is already occupying the single-flight slot.
    createJob(7);

    const outcome = await runScheduledBackupPass();
    expect(outcome).toBe("skipped_job_active");
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});

describe("catch-up against the newest backup on disk", () => {
  it("runs when the newest file is older than the interval", async () => {
    mockGetSetting.mockResolvedValue(true);
    backupsAged({ "vulnradar-backup-a.sql.gz": 30 });
    const child = fakeChild();
    mockSpawn.mockReturnValue(child);

    const promise = runScheduledBackupPass();
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    child.emit("close", 0);

    await expect(promise).resolves.toBe("started");
  });

  it("skips when the newest file is inside the interval", async () => {
    mockGetSetting.mockResolvedValue(true);
    backupsAged({
      "vulnradar-backup-old.sql.gz": 30,
      "vulnradar-backup-new.sql.gz.enc": 2,
    });

    await expect(runScheduledBackupPass()).resolves.toBe("skipped_recent");
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("does not count an encryption sidecar or an unrelated file as a backup", async () => {
    mockGetSetting.mockResolvedValue(true);
    backupsAged({
      "vulnradar-backup-a.sql.gz.enc": 30,
      "vulnradar-backup-a.sql.gz.enc.json": 1,
      "pre-migration": 1,
      "notes.txt": 1,
    });
    const child = fakeChild();
    mockSpawn.mockReturnValue(child);

    const promise = runScheduledBackupPass();
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    child.emit("close", 0);

    await expect(promise).resolves.toBe("started");
  });

  it("runs on a fresh install with no backup directory yet", async () => {
    mockGetSetting.mockResolvedValue(true);
    const child = fakeChild();
    mockSpawn.mockReturnValue(child);

    const promise = runScheduledBackupPass();
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    child.emit("close", 0);

    await expect(promise).resolves.toBe("started");
  });

  it("reads BACKUP_DIR, the same directory the script writes to", async () => {
    mockGetSetting.mockResolvedValue(true);
    vi.stubEnv("BACKUP_DIR", "/mnt/dumps");
    backupsAged({ "vulnradar-backup-a.sql.gz": 2 });
    try {
      await runScheduledBackupPass();
      expect(String(mockReaddir.mock.calls[0][0])).toMatch(
        /[\\/]mnt[\\/]dumps$/,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("judges the file against the interval it was given", async () => {
    mockGetSetting.mockResolvedValue(true);
    backupsAged({ "vulnradar-backup-a.sql.gz": 2 });
    const child = fakeChild();
    mockSpawn.mockReturnValue(child);

    const promise = runScheduledBackupPass(HOUR);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    child.emit("close", 0);

    await expect(promise).resolves.toBe("started");
  });
});

describe("schedulePeriodicBackup / stopPeriodicBackup", () => {
  // A plain interval from boot never fired on a deployment that restarts more
  // often than the interval, so the contract is a short poll plus a check
  // shortly after boot, both asking the disk whether a backup is due.
  it("polls on the short tick and clears that exact handle on stop", () => {
    vi.useFakeTimers();
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    try {
      const timer = schedulePeriodicBackup(60_000);

      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy.mock.calls[0][1]).toBe(BACKUP_TICK_MS);
      expect(setSpy.mock.results[0].value).toBe(timer);
      expect(BACKUP_TICK_MS).toBe(15 * 60 * 1000);

      stopPeriodicBackup();
      expect(clearSpy).toHaveBeenCalledTimes(1);
      expect(clearSpy).toHaveBeenCalledWith(timer);

      // Idempotent, not merely non-throwing: the second stop must find the
      // handle already released rather than clear it again.
      stopPeriodicBackup();
      expect(clearSpy).toHaveBeenCalledTimes(1);
    } finally {
      setSpy.mockRestore();
      clearSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  async function afterBoot(run: () => Promise<void>) {
    vi.useFakeTimers();
    mockGetSetting.mockResolvedValue(true);
    try {
      schedulePeriodicBackup();
      await run();
    } finally {
      stopPeriodicBackup();
      vi.useRealTimers();
    }
  }

  it("runs a 30-hour-old backup right after boot", async () => {
    backupsAged({ "vulnradar-backup-a.sql.gz": 30 });
    mockSpawn.mockReturnValue(fakeChild());
    await afterBoot(async () => {
      expect(mockSpawn).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(BACKUP_BOOT_CHECK_DELAY_MS);
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });
    expect(BACKUP_BOOT_CHECK_DELAY_MS).toBeLessThan(BACKUP_TICK_MS);
  });

  it("skips a 2-hour-old backup after boot and on every tick", async () => {
    backupsAged({ "vulnradar-backup-a.sql.gz": 2 });
    await afterBoot(async () => {
      await vi.advanceTimersByTimeAsync(BACKUP_BOOT_CHECK_DELAY_MS);
      await vi.advanceTimersByTimeAsync(BACKUP_TICK_MS * 3);
      expect(mockReaddir.mock.calls.length).toBeGreaterThanOrEqual(4);
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  it("stop also cancels the check that was waiting on boot", async () => {
    backupsAged({ "vulnradar-backup-a.sql.gz": 30 });
    vi.useFakeTimers();
    mockGetSetting.mockResolvedValue(true);
    try {
      schedulePeriodicBackup();
      stopPeriodicBackup();
      await vi.advanceTimersByTimeAsync(BACKUP_BOOT_CHECK_DELAY_MS * 2);
      expect(mockGetSetting).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the shipped interval instead of treating every file as overdue", async () => {
    // An interval of 0 would make every backup overdue, and the worker would
    // start a pg_dump on every tick.
    backupsAged({ "vulnradar-backup-a.sql.gz": 2 });
    vi.useFakeTimers();
    mockGetSetting.mockResolvedValue(true);
    try {
      for (const bad of [0, Number.NaN]) {
        schedulePeriodicBackup(bad);
        await vi.advanceTimersByTimeAsync(BACKUP_TICK_MS);
        expect(mockSpawn, String(bad)).not.toHaveBeenCalled();
      }
      expect(CONFIG_SCHEDULED_BACKUP_INTERVAL_MS).toBeGreaterThan(2 * HOUR);
    } finally {
      stopPeriodicBackup();
      vi.useRealTimers();
    }
  });
});
