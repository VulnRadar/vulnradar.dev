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

const { runScheduledBackupPass, schedulePeriodicBackup, stopPeriodicBackup } =
  await import("@/lib/backup/scheduled-backup-worker");
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
});

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

describe("schedulePeriodicBackup / stopPeriodicBackup", () => {
  // These used to assert `expect(timer).toBeDefined()`, which any
  // `setInterval(fn, 0)` also satisfies. The contract worth pinning is the
  // interval the worker actually registers and the fact that stopping it
  // clears that same handle: a worker that silently registers a 0 ms timer
  // spawns pg_dump in a tight loop, and one whose stop clears a different
  // handle leaks a timer that keeps firing after shutdown.
  it("registers the interval it was given and clears that exact handle on stop", () => {
    vi.useFakeTimers();
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    try {
      const timer = schedulePeriodicBackup(60_000);

      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(setSpy.mock.calls[0][1]).toBe(60_000);
      expect(setSpy.mock.results[0].value).toBe(timer);

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

  it("falls back to the shipped interval instead of registering a 0 ms timer", () => {
    vi.useFakeTimers();
    const setSpy = vi.spyOn(globalThis, "setInterval");
    try {
      schedulePeriodicBackup(0);
      expect(setSpy.mock.calls[0][1]).toBe(CONFIG_SCHEDULED_BACKUP_INTERVAL_MS);

      setSpy.mockClear();
      schedulePeriodicBackup(Number.NaN);
      expect(setSpy.mock.calls[0][1]).toBe(CONFIG_SCHEDULED_BACKUP_INTERVAL_MS);
    } finally {
      stopPeriodicBackup();
      setSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
