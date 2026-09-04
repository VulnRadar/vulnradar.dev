/**
 * Route-level tests for GET/POST /api/v3/admin/backup (Admin > System >
 * Backups). Auth goes through the shared requireAdmin()
 * (lib/auth/authorization.ts), which calls getSession() and a
 * pool.query role lookup -- both mocked here, same "mock at the
 * getSession/db boundary" approach tests/app/api/v3/admin/error-logs/
 * route.test.ts uses. The actual child-process spawn
 * (lib/backup/run-backup.ts) is mocked too: that's the network/process
 * boundary for this route, tested on its own in
 * tests/lib/backup/run-backup.test.ts. The job-store itself is the real
 * module (reset between tests) since it's plain in-memory business
 * logic, not a boundary.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockLogAction = vi.fn();
vi.mock("@/lib/auth/authorization", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/authorization")>();
  return {
    ...actual,
    logAuditAction: (...args: unknown[]) => mockLogAction(...args),
    logAction: (...args: unknown[]) => mockLogAction(...args),
  };
});

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
}));

const mockRunBackupJob = vi.fn();
vi.mock("@/lib/backup/run-backup", () => ({
  runBackupJob: (...args: unknown[]) => mockRunBackupJob(...args),
}));

const mockReaddir = vi.fn();
const mockStat = vi.fn();
vi.mock("node:fs/promises", () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  stat: (...args: unknown[]) => mockStat(...args),
}));

const { GET, POST } = await import("@/app/api/v3/admin/backup/route");
const { __resetForTests } = await import("@/lib/backup/job-store");

function withAdmin(userId = 7, role = "admin") {
  mockGetSession.mockResolvedValue({ userId });
  mockQuery.mockResolvedValueOnce({ rows: [{ id: userId, role }] });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockLogAction.mockReset();
  mockRunBackupJob.mockReset();
  mockRunBackupJob.mockResolvedValue(undefined);
  mockReaddir.mockReset();
  mockReaddir.mockResolvedValue([]);
  mockStat.mockReset();
  __resetForTests();
});

describe("POST /api/v3/admin/backup", () => {
  it("requires a session", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(403);
    expect(mockRunBackupJob).not.toHaveBeenCalled();
  });

  it("rejects a caller below admin (e.g. support)", async () => {
    mockGetSession.mockResolvedValue({ userId: 3 });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 3, role: "support" }] });
    const res = await POST();
    expect(res.status).toBe(403);
    expect(mockRunBackupJob).not.toHaveBeenCalled();
  });

  it("starts a backup job, audit-logs it, and returns 202 with a jobId", async () => {
    withAdmin();
    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(202);
    expect(typeof json.jobId).toBe("string");
    expect(mockRunBackupJob).toHaveBeenCalledWith(json.jobId);
    expect(mockLogAction).toHaveBeenCalledWith(
      7,
      null,
      "backup_started",
      expect.stringContaining(json.jobId),
      "127.0.0.1",
    );
  });

  it("returns 409 when a backup is already running", async () => {
    withAdmin();
    await POST();

    withAdmin();
    const res = await POST();
    expect(res.status).toBe(409);
    expect(mockRunBackupJob).toHaveBeenCalledTimes(1);
  });

  it("still starts the job even when audit logging fails", async () => {
    withAdmin();
    mockLogAction.mockRejectedValueOnce(new Error("db exploded"));
    const res = await POST();
    expect(res.status).toBe(202);
    expect(mockRunBackupJob).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/v3/admin/backup", () => {
  it("requires a session", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("rejects a caller below admin", async () => {
    mockGetSession.mockResolvedValue({ userId: 3 });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 3, role: "support" }] });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns a null job and an empty backup list when nothing has ever run", async () => {
    withAdmin();
    mockReaddir.mockResolvedValueOnce([]);
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.job).toBeNull();
    expect(json.backups).toEqual([]);
    expect(json.lastBackupAt).toBeNull();
  });

  it("never returns the server's backup directory path to the client", async () => {
    withAdmin();
    mockReaddir.mockResolvedValueOnce([]);
    const res = await GET();
    const json = await res.json();

    expect(json.backupDir).toBeUndefined();
  });

  it("lists backup files newest-first and ignores unrelated files", async () => {
    withAdmin();
    mockReaddir.mockResolvedValueOnce([
      "vulnradar-backup-2026-08-10T00-00-00-000Z.sql.gz",
      "vulnradar-backup-2026-08-12T00-00-00-000Z.sql.gz",
      ".gitkeep",
    ]);
    mockStat.mockImplementation(async (path: string) => {
      if (path.includes("2026-08-10")) {
        return { size: 1000, mtime: new Date("2026-08-10T00:00:05Z") };
      }
      return { size: 2000, mtime: new Date("2026-08-12T00:00:05Z") };
    });

    const res = await GET();
    const json = await res.json();

    expect(json.backups).toHaveLength(2);
    expect(json.backups[0].name).toContain("2026-08-12");
    expect(json.backups[0].sizeBytes).toBe(2000);
    expect(json.lastBackupAt).toBe(json.backups[0].modifiedAt);
  });

  /**
   * An encrypted backup is written as TWO files: the dump, and a ~160 byte
   * `.json` sidecar holding the AES-256-GCM iv and authTag it cannot be
   * decrypted without. Both start with "vulnradar-backup-", so listing them
   * both made one backup render as two rows and the panel's count read
   * double. The owner saw "4 files" for two backups and reasonably read it as
   * the job having run twice.
   */
  it("counts an encrypted backup once, not once per file", async () => {
    withAdmin();
    mockReaddir.mockResolvedValueOnce([
      "vulnradar-backup-2026-09-02T04-44-24-897Z.sql.gz.enc",
      "vulnradar-backup-2026-09-02T04-44-24-897Z.sql.gz.enc.json",
      "vulnradar-backup-2026-09-03T23-58-34-163Z.sql.gz.enc",
      "vulnradar-backup-2026-09-03T23-58-34-163Z.sql.gz.enc.json",
    ]);
    mockStat.mockImplementation(async (path: string) => {
      const size = path.endsWith(".json") ? 161 : 3_100_000;
      const mtime = path.includes("2026-09-02")
        ? new Date("2026-09-02T04:44:25Z")
        : new Date("2026-09-03T23:58:35Z");
      return { size, mtime };
    });

    const res = await GET();
    const json = await res.json();

    expect(json.backups).toHaveLength(2);
    // Every row is a real dump, never a sidecar.
    for (const b of json.backups) {
      expect(b.name.endsWith(".json")).toBe(false);
      expect(b.sizeBytes).toBe(3_100_000);
      // The sidecar's existence is reported, since a copy of the dump alone
      // cannot be restored.
      expect(b.encrypted).toBe(true);
    }
    expect(json.backups[0].name).toContain("2026-09-03");
  });

  it("does not mark a backup encrypted when it has no key sidecar", async () => {
    withAdmin();
    mockReaddir.mockResolvedValueOnce([
      "vulnradar-backup-2026-08-10T00-00-00-000Z.sql.gz",
    ]);
    mockStat.mockResolvedValue({
      size: 1000,
      mtime: new Date("2026-08-10T00:00:05Z"),
    });

    const res = await GET();
    const json = await res.json();

    expect(json.backups).toHaveLength(1);
    expect(json.backups[0].encrypted).toBe(false);
  });

  it("ignores a stray .json that is not any backup's sidecar", async () => {
    withAdmin();
    mockReaddir.mockResolvedValueOnce([
      "vulnradar-backup-2026-08-10T00-00-00-000Z.sql.gz",
      // Matches the prefix and ends in .json, but is nobody's sidecar. It
      // must not be listed, and must not mark the unrelated dump encrypted.
      "vulnradar-backup-notes.json",
    ]);
    mockStat.mockResolvedValue({
      size: 1000,
      mtime: new Date("2026-08-10T00:00:05Z"),
    });

    const res = await GET();
    const json = await res.json();

    expect(json.backups).toHaveLength(1);
    expect(json.backups[0].name).toContain("2026-08-10");
    expect(json.backups[0].encrypted).toBe(false);
  });

  it("returns an empty backup list gracefully when BACKUP_DIR doesn't exist yet", async () => {
    withAdmin();
    mockReaddir.mockRejectedValueOnce(new Error("ENOENT"));
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.backups).toEqual([]);
  });

  it("reflects the latest job's status right after POST starts one", async () => {
    withAdmin();
    await POST();

    withAdmin();
    const res = await GET();
    const json = await res.json();

    expect(json.job).not.toBeNull();
    expect(json.job.status).toBe("running");
  });

  // The Backups tab grades the newest file's age against the configured
  // interval, the same way the health overview's backup row does, so that an
  // old file reads as "the timer is dead" rather than as a date the operator
  // has to do arithmetic on. It can only do that if the response says whether
  // anything is promising a cadence at all: without scheduledEnabled the panel
  // has to assume schedules are on, and cries wolf on a deployment that runs
  // backups by hand.
  it("reports the backup schedule so the panel can grade staleness", async () => {
    withAdmin();
    mockReaddir.mockResolvedValueOnce([]);
    const res = await GET();
    const json = await res.json();

    expect(json).toHaveProperty("scheduledEnabled");
    expect(typeof json.intervalMs).toBe("number");
    expect(json.intervalMs).toBeGreaterThan(0);
  });
});
