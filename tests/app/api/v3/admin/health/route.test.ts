/**
 * Route-level tests for GET /api/v3/admin/health (Admin > Operations >
 * Overview -- AUDIT-014 qols-02). The two behaviours worth pinning are the
 * ones a unit test of the pure verdict logic cannot reach: per-metric
 * permission gating (a specialist role must not receive counts for a tab it
 * cannot open), and the "one failing check must not take the page down"
 * guarantee, since the whole point of this screen is that it still renders
 * when something is broken.
 *
 * Auth is mocked at the getSession/db boundary, the same way
 * tests/app/api/v3/admin/queue-status/route.test.ts does it.
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

vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: vi.fn().mockResolvedValue(false),
}));

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn(),
}));

const { GET } = await import("@/app/api/v3/admin/health/route");

/** Dispatch on SQL text: the metric queries run in one Promise.all, so
 *  there is no fixed order to line mockResolvedValueOnce up against. An
 *  override that is an Error rejects instead of resolving. */
function respondByTable(overrides: Record<string, unknown> = {}) {
  const answer = (key: string, fallback: unknown) => {
    const value = key in overrides ? overrides[key] : fallback;
    return value instanceof Error
      ? Promise.reject(value)
      : Promise.resolve(value);
  };
  mockQuery.mockImplementation((sql: string) => {
    if (sql.includes("system_error_logs")) {
      return answer("errorLogs", { rows: [{ n: 2 }] });
    }
    if (sql.includes("email_logs")) {
      return answer("email", { rows: [{ failed: 0, total: 10 }] });
    }
    if (sql.includes("security_alerts")) {
      return answer("alerts", { rows: [{ n: 0, severe: 0 }] });
    }
    if (sql.includes("support_tickets")) {
      return answer("tickets", { rows: [{ awaiting: 1, open: 4 }] });
    }
    if (sql.includes("staff_invites")) {
      return answer("invites", { rows: [{ pending: 0, expired: 0 }] });
    }
    if (sql.includes("worker_failure_state")) {
      return answer("workers", { rows: [] });
    }
    if (sql.includes("scheduled_scans")) {
      return answer("overdue", { rows: [{ n: 0, oldest_at: null }] });
    }
    if (sql.includes("scan_history")) {
      return answer("queue", {
        rows: [{ status: "pending", count: 2, oldest_at: null }],
      });
    }
    return Promise.resolve({ rows: [] });
  });
}

function signInAs(role: string, userId = 7) {
  mockGetSession.mockResolvedValue({ userId });
  // The FIRST query requireStaff makes is the role lookup. totp_enabled:
  // true short-circuits the 2FA-enforcement check so it does not issue a
  // second settings query this suite does not care about.
  mockQuery.mockImplementationOnce(() =>
    Promise.resolve({ rows: [{ role, totp_enabled: true }] }),
  );
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
});

describe("GET /api/v3/admin/health", () => {
  it("requires a staff session", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("gives an admin every health metric", async () => {
    signInAs("admin");
    respondByTable();

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(Object.keys(json).sort()).toEqual(
      [
        "backup",
        "email",
        "errorLogs",
        "generatedAt",
        "overdueSchedules",
        "scanQueue",
        "securityAlerts",
        "staffInvites",
        "supportTickets",
        "workers",
      ].sort(),
    );
    expect(json.supportTickets).toEqual({ awaitingStaff: 1, open: 4 });
  });

  it("omits metrics a support role cannot open the tab for", async () => {
    // support holds MANAGE_SUPPORT_TICKETS but not TRIGGER_MAINTENANCE or
    // VIEW_ERROR_LOGS, so the mail, backup, alert and error rows must not be
    // in the payload at all -- absent, not null, so the client renders no
    // row rather than an "unknown" one.
    signInAs("support");
    respondByTable();

    const json = await (await GET()).json();

    expect(json).toHaveProperty("supportTickets");
    expect(json).not.toHaveProperty("email");
    expect(json).not.toHaveProperty("backup");
    expect(json).not.toHaveProperty("securityAlerts");
    expect(json).not.toHaveProperty("errorLogs");
  });

  it("returns null for a metric whose query failed instead of failing the request", async () => {
    signInAs("admin");
    // A deployment that has never opened the staff tab may not have the
    // lazily-created staff_invites table yet.
    respondByTable({
      invites: new Error('relation "staff_invites" does not exist'),
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.staffInvites).toBeNull();
    expect(json.supportTickets).toEqual({ awaitingStaff: 1, open: 4 });
    consoleError.mockRestore();
  });

  it("reads the scan queue into the shape the overview expects", async () => {
    signInAs("admin");
    respondByTable({
      queue: {
        rows: [
          { status: "pending", count: 3, oldest_at: null },
          { status: "running", count: 1, oldest_at: null },
          { status: "completed", count: 40, oldest_at: null },
          { status: "failed", count: 5, oldest_at: null },
        ],
      },
    });

    const json = await (await GET()).json();

    expect(json.scanQueue).toMatchObject({
      pending: 3,
      running: 1,
      completedLast24h: 40,
      failedLast24h: 5,
    });
  });

  // The defect behind the Overview going red on a busy day: Cancel, a quota
  // refusal and a down target all end `failed`, and every one was counted as
  // the engine failing. failedLast24h now counts engine kinds (and a legacy
  // row with no kind) and the rest are reported in their own fields.
  it("counts only engine failures as failures and reports the rest apart", async () => {
    signInAs("admin");
    respondByTable({
      queue: {
        rows: [
          { status: "completed", failure_kind: null, count: 40 },
          { status: "failed", failure_kind: "internal", count: 2 },
          { status: "failed", failure_kind: "timeout", count: 1 },
          { status: "failed", failure_kind: "stale", count: 1 },
          { status: "failed", failure_kind: "interrupted", count: 1 },
          // A row the boot backfill has not classified yet counts: undercounting
          // real failures is the worse mistake for a health check.
          { status: "failed", failure_kind: null, count: 3 },
          { status: "failed", failure_kind: "cancelled", count: 20 },
          { status: "failed", failure_kind: "admin_cancelled", count: 4 },
          { status: "failed", failure_kind: "quota_refused", count: 7 },
          { status: "failed", failure_kind: "not_run", count: 5 },
          { status: "failed", failure_kind: "target_unreachable", count: 9 },
          { status: "failed", failure_kind: "target_timeout", count: 2 },
          { status: "failed", failure_kind: "target_tls", count: 1 },
          { status: "failed", failure_kind: "target_blocked", count: 1 },
          {
            status: "failed",
            failure_kind: "target_redirect_offhost",
            count: 1,
          },
        ],
      },
    });

    const json = await (await GET()).json();

    expect(json.scanQueue).toMatchObject({
      completedLast24h: 40,
      failedLast24h: 8,
      cancelledLast24h: 24,
      refusedLast24h: 12,
      targetFailedLast24h: 14,
    });
  });

  it("asks for the failure kind, so the buckets come from the database", async () => {
    signInAs("admin");
    respondByTable();

    await GET();

    const queueSql = mockQuery.mock.calls
      .map((c) => String(c[0]))
      .find((sql) => sql.includes("FROM scan_history"));
    expect(queueSql).toContain("GROUP BY status, failure_kind");
  });

  it("sums a status that now arrives as several rows", async () => {
    // GROUP BY failure_kind splits one status into one row per kind. Pending
    // and running are always NULL-kind, but the reader must not rely on it.
    signInAs("admin");
    respondByTable({
      queue: {
        rows: [
          {
            status: "pending",
            failure_kind: null,
            count: 2,
            oldest_at: new Date(Date.now() - 5 * 60_000).toISOString(),
          },
          {
            status: "pending",
            failure_kind: "internal",
            count: 1,
            oldest_at: new Date(Date.now() - 60_000).toISOString(),
          },
        ],
      },
    });

    const json = await (await GET()).json();

    expect(json.scanQueue.pending).toBe(3);
    // The older of the two groups wins.
    expect(json.scanQueue.oldestPendingAgeMs).toBeGreaterThan(4 * 60_000);
  });
});

describe("GET /api/v3/admin/health: background workers", () => {
  const ago = (ms: number) => new Date(Date.now() - ms);

  it("returns one entry per registered worker, with nulls for one that never ticked", async () => {
    signInAs("admin");
    respondByTable({
      workers: {
        rows: [
          {
            event: "scheduled_scans_worker_failing",
            consecutive_failures: 4,
            alerted: true,
            last_success_at: ago(3_600_000),
            last_failure_at: ago(60_000),
            last_error: "Every due scheduled scan is failing",
            updated_at: ago(60_000),
          },
        ],
      },
    });

    const json = await (await GET()).json();

    expect(json.workers.workersRun).toBe(true);
    const rows = json.workers.rows;
    // The registry's workers, not only the ones that have a row.
    expect(rows.map((r: { event: string }) => r.event)).toEqual([
      "cleanup_worker_failing",
      "stale_scan_sweep_failing",
      "scheduled_scans_worker_failing",
      "posture_digest_worker_failing",
      "domain_reverify_worker_failing",
      "scheduled_backup_worker_failing",
    ]);
    const scans = rows.find(
      (r: { event: string }) => r.event === "scheduled_scans_worker_failing",
    );
    expect(scans).toMatchObject({
      label: "Scheduled scans",
      consecutiveFailures: 4,
      alerted: true,
      lastError: "Every due scheduled scan is failing",
    });
    expect(scans.intervalMs).toBeGreaterThan(0);
    expect(new Date(scans.updatedAt).toString()).not.toBe("Invalid Date");

    const cleanup = rows.find(
      (r: { event: string }) => r.event === "cleanup_worker_failing",
    );
    expect(cleanup).toMatchObject({
      consecutiveFailures: 0,
      alerted: false,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: null,
      updatedAt: null,
    });
  });

  it("asks only for the registered events", async () => {
    signInAs("admin");
    respondByTable();

    await GET();

    const call = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("worker_failure_state"),
    );
    expect(call?.[1]?.[0]).toContain("cleanup_worker_failing");
    expect(call?.[1]?.[0]).toHaveLength(6);
  });

  it("reports overdue schedules with how late the oldest is", async () => {
    signInAs("admin");
    respondByTable({
      overdue: { rows: [{ n: 3, oldest_at: ago(2 * 60 * 60_000) }] },
    });

    const json = await (await GET()).json();

    expect(json.overdueSchedules.count).toBe(3);
    expect(json.overdueSchedules.workersRun).toBe(true);
    expect(json.overdueSchedules.oldestOverdueMs).toBeGreaterThan(119 * 60_000);
  });

  it("only counts schedules that are active and more than 30 minutes late", async () => {
    signInAs("admin");
    respondByTable();

    await GET();

    const sql = String(
      mockQuery.mock.calls.find((c) =>
        String(c[0]).includes("FROM scheduled_scans"),
      )?.[0],
    );
    expect(sql).toContain("active = true");
    expect(sql).toContain("INTERVAL '30 minutes'");
  });

  it("flags a serverless host so the client does not call a worker that cannot tick stale", async () => {
    signInAs("admin");
    respondByTable();
    vi.stubEnv("VERCEL", "1");
    try {
      const json = await (await GET()).json();
      expect(json.workers.workersRun).toBe(false);
      expect(json.overdueSchedules.workersRun).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("gives the ops role the worker rows it can act on, and not the maintenance ones", async () => {
    // ops holds VIEW_SYSTEM_STATS and VIEW_ERROR_LOGS, not TRIGGER_MAINTENANCE.
    signInAs("ops");
    respondByTable();

    const json = await (await GET()).json();

    expect(json).toHaveProperty("workers");
    expect(json).toHaveProperty("overdueSchedules");
    expect(json).toHaveProperty("scanQueue");
    expect(json).not.toHaveProperty("backup");
    expect(json).not.toHaveProperty("email");
  });

  it("withholds the worker rows from a role without VIEW_SYSTEM_STATS", async () => {
    signInAs("support");
    respondByTable();

    const json = await (await GET()).json();

    expect(json).not.toHaveProperty("workers");
    expect(json).not.toHaveProperty("overdueSchedules");
  });

  it("returns null for the workers read failing without losing the rest", async () => {
    signInAs("admin");
    respondByTable({
      workers: new Error('relation "worker_failure_state" does not exist'),
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.workers).toBeNull();
    expect(json.overdueSchedules.count).toBe(0);
    consoleError.mockRestore();
  });
});
