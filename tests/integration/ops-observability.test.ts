import {
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
} from "vitest";
import pool from "@/lib/database/db";
import {
  installErrorLogCapture,
  _resetErrorLogCaptureStateForTests,
} from "@/lib/database/error-log-capture";
import {
  runWithRequestId,
  runWithScanId,
} from "@/lib/database/request-context";
import { buildErrorLogWhere } from "@/lib/admin/error-log-filter";
import { createFailureEscalator } from "@/lib/admin/failure-escalation";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * The ops-observability SQL on a real PostgreSQL: the error log's request and
 * scan correlation, the worker state the health view reads, and the health
 * route's own aggregates.
 *
 * The unit tier fakes pool.query, so it answers an INSERT naming a column
 * that does not exist, an ON CONFLICT that targets the wrong key and a GROUP
 * BY that splits a status into the wrong buckets exactly as it answers the
 * correct ones. Every claim below is about what the database does.
 *
 * The health route is called for real, behind a stubbed session only. Its
 * counts cover every scan in the last day and every overdue schedule, rows
 * other suites leave behind included, so each assertion is a before/after
 * difference around rows this file inserted.
 */
const auth = vi.hoisted(() => ({ userId: 0 }));
vi.mock("@/lib/auth", () => ({
  getSession: async () => (auth.userId ? { userId: auth.userId } : null),
}));

const { GET: healthGet } = await import("@/app/api/v3/admin/health/route");

const realConsoleError = console.error;

interface LogRow {
  message: string;
  detail: string | null;
  request_id: string | null;
  scan_id: number | null;
}

async function rowsFor(
  filter: Parameters<typeof buildErrorLogWhere>[0],
): Promise<LogRow[]> {
  const { clause, params } = buildErrorLogWhere(filter);
  const { rows } = await pool.query<LogRow>(
    `SELECT message, detail, request_id, scan_id FROM system_error_logs ${clause}`,
    params,
  );
  return rows;
}

const messages = (rows: LogRow[]) => rows.map((r) => r.message).sort();

describeIntegration("system_error_logs correlation", () => {
  beforeEach(() => {
    _resetErrorLogCaptureStateForTests();
    // Silence the echo to the real console; the capture still wraps this.
    console.error = () => {};
    installErrorLogCapture();
  });

  afterEach(() => {
    console.error = realConsoleError;
    _resetErrorLogCaptureStateForTests();
    vi.useRealTimers();
  });

  it("stores the request and scan a failure ran under and filters on each", async () => {
    const tag = unique("capture");
    const requestId = unique("req");
    // Deliberately a scan that does not exist: the column has no foreign key,
    // because this table is the record of a failure and a scan deleted before
    // its error lands must not make the error fail to insert.
    const scanId = 1 + Math.floor(Math.random() * 1_000_000_000);

    runWithRequestId(requestId, () =>
      runWithScanId(scanId, () => {
        console.error(`${tag} first`);
        console.error(`${tag} second`);
      }),
    );
    console.error(`${tag} unrelated`);

    await vi.waitFor(async () =>
      expect((await rowsFor({ search: tag })).length).toBe(3),
    );

    expect(messages(await rowsFor({ requestId }))).toEqual([
      `${tag} first`,
      `${tag} second`,
    ]);
    expect(messages(await rowsFor({ scanId }))).toEqual([
      `${tag} first`,
      `${tag} second`,
    ]);
    // AND, not OR: a scan that is not this one narrows to nothing.
    expect(await rowsFor({ requestId, scanId: scanId + 1 })).toEqual([]);
    // The search is parenthesised, so it cannot swallow the id filter: the
    // unrelated row matches the search and must still be excluded.
    expect(messages(await rowsFor({ search: tag, requestId }))).toEqual([
      `${tag} first`,
      `${tag} second`,
    ]);
    const unrelated = await rowsFor({ search: `${tag} unrelated` });
    expect(unrelated[0].request_id).toBeNull();
    expect(unrelated[0].scan_id).toBeNull();
  });

  it("treats LIKE metacharacters in the search as text", async () => {
    const tag = unique("escape");
    for (const m of [`${tag} 100%_sure`, `${tag} 100abcsure`, `${tag} 100%`]) {
      await pool.query("INSERT INTO system_error_logs (message) VALUES ($1)", [
        m,
      ]);
    }

    expect(messages(await rowsFor({ search: `${tag} 100%_sure` }))).toEqual([
      `${tag} 100%_sure`,
    ]);
  });

  it("writes a summary row, with no ids of its own, for what the guard dropped", async () => {
    const tag = unique("flood");
    // Only Date is faked: the pool still needs its real timers.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-25T12:00:00.000Z"));

    runWithRequestId(unique("req"), () => {
      console.error(`${tag} flood`);
      console.error(`${tag} flood`);
      console.error(`${tag} flood`);
    });
    // Past the end of the window, so the next call reports it.
    vi.setSystemTime(new Date("2026-10-25T12:01:01.000Z"));
    console.error(`${tag} later`);

    await vi.waitFor(async () =>
      expect((await rowsFor({ search: tag })).length).toBe(3),
    );
    const rows = await rowsFor({ search: tag });
    const summary = rows.find((r) => r.message.startsWith("[error-capture]"));
    expect(summary).toBeDefined();
    expect(summary?.message).toContain("suppressed 2 errors");
    expect(summary?.message).toContain("2 repeats of");
    expect(summary?.request_id).toBeNull();
    expect(summary?.scan_id).toBeNull();
    expect(summary?.detail).toContain("still printed to the server console");
  });
});

describeIntegration("worker_failure_state", () => {
  const events: string[] = [];

  afterAll(async () => {
    if (events.length > 0) {
      await pool.query(
        "DELETE FROM worker_failure_state WHERE event = ANY($1)",
        [events],
      );
    }
  });

  async function stateOf(event: string) {
    const { rows } = await pool.query<{
      consecutive_failures: number;
      alerted: boolean;
      last_success_at: Date | null;
      last_failure_at: Date | null;
      last_error: string | null;
    }>(
      `SELECT consecutive_failures, alerted, last_success_at, last_failure_at, last_error
         FROM worker_failure_state WHERE event = $1`,
      [event],
    );
    return rows[0];
  }

  it("records when a worker last worked, when it last broke, and how", async () => {
    const event = unique("worker").slice(0, 100);
    events.push(event);
    // A threshold nothing reaches, so no alert is attempted.
    const escalator = createFailureEscalator(event, 1_000);

    // Each write is fire-and-forget on its own connection, so wait for one to
    // land before issuing the next; otherwise two could commit out of order.
    escalator.recordFailure("The first reason");
    await vi.waitFor(async () =>
      expect((await stateOf(event))?.consecutive_failures).toBe(1),
    );
    let state = await stateOf(event);
    expect(state.last_error).toBe("The first reason");
    expect(state.last_failure_at).not.toBeNull();
    expect(state.last_success_at).toBeNull();

    escalator.recordFailure("The second reason");
    await vi.waitFor(async () =>
      expect((await stateOf(event))?.consecutive_failures).toBe(2),
    );
    state = await stateOf(event);
    expect(state.last_error).toBe("The second reason");

    escalator.recordSuccess();
    await vi.waitFor(async () =>
      expect((await stateOf(event))?.consecutive_failures).toBe(0),
    );
    state = await stateOf(event);
    expect(state.last_success_at).not.toBeNull();
    // The history of the last break survives the recovery.
    expect(state.last_failure_at).not.toBeNull();
    expect(state.last_error).toBe("The second reason");
    expect(state.alerted).toBe(false);
  });
});

describeIntegration("GET /api/v3/admin/health", () => {
  let adminId: number;
  let ownerId: number;

  beforeAll(async () => {
    const admin = await createUser({ role: "admin" });
    adminId = admin.id;
    // Staff 2FA enforcement would otherwise refuse the account.
    await pool.query("UPDATE users SET totp_enabled = true WHERE id = $1", [
      adminId,
    ]);
    auth.userId = adminId;
    ownerId = (await createUser()).id;
  });

  afterAll(async () => {
    auth.userId = 0;
    await pool.query("DELETE FROM scan_history WHERE user_id = $1", [ownerId]);
    await pool.query("DELETE FROM scheduled_scans WHERE user_id = $1", [
      ownerId,
    ]);
    await pool.query(
      "DELETE FROM worker_failure_state WHERE event = 'scheduled_scans_worker_failing'",
    );
  });

  const health = async () => (await healthGet()).json();

  async function seedScan(status: string, failureKind: string | null) {
    await pool.query(
      `INSERT INTO scan_history (user_id, url, status, failure_kind, started_at, scanned_at)
       VALUES ($1, 'https://example.test/', $2, $3, NOW(), NOW())`,
      [ownerId, status, failureKind],
    );
  }

  it("counts only engine failures as failures and reports the rest apart", async () => {
    const before = (await health()).scanQueue;

    await seedScan("completed", null);
    await seedScan("completed", null);
    // Engine: a kind in ENGINE_FAILURE_KINDS, and a row the backfill never
    // classified, which counts because undercounting is the worse mistake.
    await seedScan("failed", "internal");
    await seedScan("failed", "timeout");
    await seedScan("failed", null);
    await seedScan("failed", "cancelled");
    await seedScan("failed", "cancelled");
    await seedScan("failed", "admin_cancelled");
    await seedScan("failed", "quota_refused");
    await seedScan("failed", "target_unreachable");

    const after = (await health()).scanQueue;

    expect(after.completedLast24h - before.completedLast24h).toBe(2);
    expect(after.failedLast24h - before.failedLast24h).toBe(3);
    expect(after.cancelledLast24h - before.cancelledLast24h).toBe(3);
    expect(after.refusedLast24h - before.refusedLast24h).toBe(1);
    expect(after.targetFailedLast24h - before.targetFailedLast24h).toBe(1);
  });

  it("counts an active schedule only once it is more than 30 minutes late", async () => {
    const before = (await health()).overdueSchedules;

    const insert = (active: boolean, nextRun: string) =>
      pool.query(
        `INSERT INTO scheduled_scans (user_id, url, active, next_run_at)
         VALUES ($1, 'https://example.test/', $2, NOW() + $3::interval)`,
        [ownerId, active, nextRun],
      );
    await insert(true, "-2 hours"); // overdue
    await insert(true, "-10 minutes"); // inside the grace period
    await insert(true, "+1 hour"); // not due
    await insert(false, "-2 hours"); // paused by its owner

    const after = (await health()).overdueSchedules;

    expect(after.count - before.count).toBe(1);
    expect(after.oldestOverdueMs).toBeGreaterThanOrEqual(119 * 60_000);
  });

  it("returns the stored worker state next to its registered interval", async () => {
    await pool.query(
      `INSERT INTO worker_failure_state
         (event, consecutive_failures, alerted, last_failure_at, last_error, updated_at)
       VALUES ('scheduled_scans_worker_failing', 5, true, NOW(), 'Due scans are not running', NOW())
       ON CONFLICT (event) DO UPDATE
         SET consecutive_failures = 5, alerted = true, last_failure_at = NOW(),
             last_error = 'Due scans are not running', updated_at = NOW()`,
    );

    const { workers } = await health();
    const row = workers.rows.find(
      (r: { event: string }) => r.event === "scheduled_scans_worker_failing",
    );

    expect(row).toMatchObject({
      label: "Scheduled scans",
      consecutiveFailures: 5,
      alerted: true,
      lastError: "Due scans are not running",
    });
    expect(row.intervalMs).toBe(2 * 60 * 1000);
    expect(row.updatedAt).not.toBeNull();
  });
});
