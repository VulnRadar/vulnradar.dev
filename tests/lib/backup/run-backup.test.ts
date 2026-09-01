import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const mockSpawn = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

const { runBackupJob } = await import("@/lib/backup/run-backup");
const { createJob, getJob, __resetForTests } =
  await import("@/lib/backup/job-store");

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
});

describe("runBackupJob", () => {
  it("spawns node against scripts/backup-db.mjs, cwd'd at the given app root", async () => {
    const job = createJob(1)!;
    const child = fakeChild();
    mockSpawn.mockReturnValue(child);

    const promise = runBackupJob(job.id, "/app");
    child.emit("close", 0);
    await promise;

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [command, args, options] = mockSpawn.mock.calls[0];
    expect(command).toBe(process.execPath);
    expect(args).toEqual([expect.stringContaining("backup-db.mjs")]);
    expect(options).toMatchObject({ cwd: "/app", shell: false });
  });

  it("marks the job successful and captures stdout when the script exits 0", async () => {
    const job = createJob(1)!;
    const child = fakeChild();
    mockSpawn.mockReturnValue(child);

    const promise = runBackupJob(job.id, "/app");
    child.stdout.emit("data", Buffer.from("Backup complete.\n"));
    child.emit("close", 0);
    expect(await promise).toEqual({ ok: true });

    const finished = getJob(job.id)!;
    expect(finished.status).toBe("success");
    expect(finished.error).toBeNull();
    expect(finished.log).toContain("Backup complete.");
  });

  it("marks the job failed with the exit code, capturing stderr, on a non-zero exit", async () => {
    const job = createJob(1)!;
    const child = fakeChild();
    mockSpawn.mockReturnValue(child);

    const promise = runBackupJob(job.id, "/app");
    child.stderr.emit("data", Buffer.from("pg_dump: connection refused\n"));
    child.emit("close", 1);
    const result = await promise;

    // The resolved result is the only channel a caller has: the in-memory job
    // store is capped and wiped on restart, so a failure that is not reported
    // here is invisible to the scheduled worker's failure escalator.
    expect(result.ok).toBe(false);
    expect(result.error).toContain("exited with code 1");

    const finished = getJob(job.id)!;
    expect(finished.status).toBe("failed");
    expect(finished.error).toContain("exited with code 1");
    expect(finished.log).toContain("pg_dump: connection refused");
  });

  it("console.errors a non-zero exit so it reaches system_error_logs", async () => {
    const job = createJob(1)!;
    const child = fakeChild();
    mockSpawn.mockReturnValue(child);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const promise = runBackupJob(job.id, "/app");
      child.emit("close", 2);
      await promise;
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("exited with code 2"),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("marks the job failed when the process fails to spawn at all", async () => {
    const job = createJob(1)!;
    const child = fakeChild();
    mockSpawn.mockReturnValue(child);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const promise = runBackupJob(job.id, "/app");
      child.emit("error", new Error("ENOENT: node not found"));
      const result = await promise;

      expect(result).toEqual({ ok: false, error: "ENOENT: node not found" });
      expect(errorSpy).toHaveBeenCalled();
      const finished = getJob(job.id)!;
      expect(finished.status).toBe("failed");
      expect(finished.error).toBe("ENOENT: node not found");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("does not double-finish the job if both error and close fire", async () => {
    const job = createJob(1)!;
    const child = fakeChild();
    mockSpawn.mockReturnValue(child);

    const promise = runBackupJob(job.id, "/app");
    child.emit("error", new Error("spawn failure"));
    child.emit("close", 1);
    await promise;

    const finished = getJob(job.id)!;
    expect(finished.error).toBe("spawn failure");
  });
});
