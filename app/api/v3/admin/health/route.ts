import { NextResponse } from "next/server";
import { join, resolve } from "node:path";
import { readdir, stat } from "node:fs/promises";
import pool from "@/lib/database/db";
import { requireStaff } from "@/lib/auth/authorization";
import {
  hasStaffPermission,
  STAFF_PERMISSIONS,
  type StaffPermission,
} from "@/lib/auth/permissions-client";
import { getSetting } from "@/lib/config/runtime-config";
import { CONFIG_SCHEDULED_BACKUP_INTERVAL_MS } from "@/lib/config/config-values";
import { withErrorHandling } from "@/lib/api/api-utils";
import { logError } from "@/lib/logging/log";
import {
  BACKGROUND_WORKERS,
  hostRunsWorkers,
} from "@/lib/admin/worker-registry";
import { isEngineFailure, type FailureKind } from "@/lib/scanner/failure-kinds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v3/admin/health
 *
 * AUDIT-014 qols-02: the admin panel's landing view was ten headcount
 * aggregates, none of which can go red, so nothing in the panel answered
 * "is anything wrong right now". Every signal that CAN go red already
 * existed, one nav click away each, and none was summarised anywhere: the
 * scanner backlog only while the Scanner Queue tab was mounted, backup
 * freshness as a raw date the operator had to reason about, error volume
 * and mail failures not at all.
 *
 * This returns RAW NUMBERS ONLY, the same division of labour
 * /api/v3/admin/queue-status uses: thresholds and the worst-first ordering
 * live in components/admin/features/health-overview-utils.ts, where they get
 * a test. Nothing here needs a new table; every figure comes from a bounded
 * aggregate over a table that already exists.
 *
 * Permission gating is per metric, matching the permission the owning tab
 * already enforces, so a specialist role only sees the rows it could act on.
 * A metric the caller may not read is ABSENT from the payload; a metric
 * whose query failed is present and null, because "cannot answer" and
 * "answered fine" must not render the same way.
 */

/**
 * The failed scans that are NOT the engine's fault, counted apart from the
 * failure rate so the Overview can say "12 cancelled, 3 refused" without
 * letting them turn the engine row red. A failed scan whose kind is in
 * neither set and is not an engine kind is a target problem (unreachable,
 * TLS, an off-host redirect, a blocked address). `satisfies` keeps a renamed
 * kind in lib/scanner/failure-kinds.ts from silently dropping out of its
 * bucket.
 */
const CANCELLED_KINDS = new Set<string>([
  "cancelled",
  "admin_cancelled",
] satisfies FailureKind[]);
const REFUSED_KINDS = new Set<string>([
  "quota_refused",
  "not_run",
] satisfies FailureKind[]);

/** Kept in step with app/api/v3/admin/backup/route.ts's copy: this is the
 *  directory scripts/backup-db.mjs actually writes into. */
function resolveBackupDir(): string {
  return resolve(process.env.BACKUP_DIR || join(process.cwd(), "backups"));
}

/** Newest backup file's mtime, or null when none exists. Only the newest is
 *  needed here, so this stats the directory rather than building the full
 *  listing GET /api/v3/admin/backup returns. */
async function newestBackupAt(dir: string): Promise<string | null> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  let newest: number | null = null;
  for (const name of names) {
    if (!name.startsWith("vulnradar-backup-")) continue;
    const s = await stat(join(dir, name)).catch(() => null);
    if (!s) continue;
    const t = s.mtime.getTime();
    if (newest === null || t > newest) newest = t;
  }
  return newest === null ? null : new Date(newest).toISOString();
}

/**
 * One failing metric must not take the whole health view down with it: the
 * point of this screen is that it still renders when something is broken.
 * A rejection becomes null, which the client renders as an "unknown" row.
 */
async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    logError("admin/health", `${label} check failed`, error);
    return null;
  }
}

export const GET = withErrorHandling(async () => {
  const session = await requireStaff();
  if (!session) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }

  const can = (permission: StaffPermission) =>
    hasStaffPermission(session.role, permission);

  const wantsQueue = can(STAFF_PERMISSIONS.VIEW_SYSTEM_STATS);
  // Backups, email logs and security alerts all sit behind the same
  // TRIGGER_MAINTENANCE grant their own tabs are gated on in NAV_GROUPS.
  const wantsMaintenance = can(STAFF_PERMISSIONS.TRIGGER_MAINTENANCE);
  const wantsErrors = can(STAFF_PERMISSIONS.VIEW_ERROR_LOGS);
  const wantsTickets = can(STAFF_PERMISSIONS.MANAGE_SUPPORT_TICKETS);
  // The Active Staff tab (where invites live) is gated on VIEW_AUDIT_LOG.
  const wantsInvites = can(STAFF_PERMISSIONS.VIEW_AUDIT_LOG);

  const [
    queue,
    workers,
    overdueSchedules,
    backup,
    errorLogs,
    email,
    securityAlerts,
    tickets,
    invites,
  ] = await Promise.all([
    wantsQueue
      ? safe("scan queue", async () => {
          // Same window as /api/v3/admin/queue-status: pending/running are
          // all-time (partial index, near zero on a healthy queue),
          // completed/failed are capped to 24h so this stays bounded as
          // scan_history grows. Grouped by failure_kind as well so a user's
          // Cancel, a quota refusal and a down target are counted apart from
          // the engine breaking; the buckets are decided here, in code, from
          // lib/scanner/failure-kinds.ts rather than restated in SQL.
          const res = await pool.query<{
            status: string;
            failure_kind: string | null;
            count: string;
            oldest_at: string | null;
          }>(
            `SELECT status, failure_kind, COUNT(*)::int AS count,
                    MIN(COALESCE(started_at, scanned_at)) AS oldest_at
               FROM scan_history
              WHERE status IN ('pending', 'running')
                 OR (status IN ('completed', 'failed')
                     AND scanned_at > NOW() - INTERVAL '24 hours')
              GROUP BY status, failure_kind`,
          );
          const now = Date.now();
          const ageMs = (at: string | null) =>
            at ? Math.max(0, now - new Date(at).getTime()) : null;
          let pending = 0;
          let running = 0;
          let completedLast24h = 0;
          let failedLast24h = 0;
          let cancelledLast24h = 0;
          let refusedLast24h = 0;
          let targetFailedLast24h = 0;
          let oldestPendingAgeMs: number | null = null;
          let oldestRunningAgeMs: number | null = null;
          const older = (a: number | null, b: number | null) =>
            a === null ? b : b === null ? a : Math.max(a, b);
          for (const row of res.rows) {
            const count = Number(row.count) || 0;
            if (row.status === "pending") {
              pending += count;
              oldestPendingAgeMs = older(
                oldestPendingAgeMs,
                ageMs(row.oldest_at),
              );
            } else if (row.status === "running") {
              running += count;
              oldestRunningAgeMs = older(
                oldestRunningAgeMs,
                ageMs(row.oldest_at),
              );
            } else if (row.status === "completed") {
              completedLast24h += count;
            } else if (row.status === "failed") {
              const kind = row.failure_kind;
              if (isEngineFailure(kind)) failedLast24h += count;
              else if (CANCELLED_KINDS.has(kind as string))
                cancelledLast24h += count;
              else if (REFUSED_KINDS.has(kind as string))
                refusedLast24h += count;
              else targetFailedLast24h += count;
            }
          }
          return {
            pending,
            running,
            oldestPendingAgeMs,
            oldestRunningAgeMs,
            completedLast24h,
            failedLast24h,
            cancelledLast24h,
            refusedLast24h,
            targetFailedLast24h,
          };
        })
      : Promise.resolve(undefined),
    wantsQueue
      ? safe("workers", async () => {
          // One entry per registered worker, in registry order, with nulls
          // for one that has never recorded a tick, so the client can tell
          // "has not reported" from "was not asked". Worker rows are written
          // by lib/admin/failure-escalation.ts on every tick.
          const res = await pool.query<{
            event: string;
            consecutive_failures: number;
            alerted: boolean;
            last_success_at: string | null;
            last_failure_at: string | null;
            last_error: string | null;
            updated_at: string | null;
          }>(
            `SELECT event, consecutive_failures, alerted, last_success_at,
                    last_failure_at, last_error, updated_at
               FROM worker_failure_state
              WHERE event = ANY($1)`,
            [BACKGROUND_WORKERS.map((w) => w.event)],
          );
          const byEvent = new Map(res.rows.map((r) => [r.event, r]));
          const iso = (value: string | Date | null | undefined) =>
            value ? new Date(value).toISOString() : null;
          return {
            workersRun: hostRunsWorkers(),
            rows: BACKGROUND_WORKERS.map((w) => {
              const row = byEvent.get(w.event);
              return {
                event: w.event,
                label: w.label,
                intervalMs: w.intervalMs,
                consecutiveFailures: Number(row?.consecutive_failures) || 0,
                alerted: row?.alerted ?? false,
                lastSuccessAt: iso(row?.last_success_at),
                lastFailureAt: iso(row?.last_failure_at),
                lastError: row?.last_error ?? null,
                updatedAt: iso(row?.updated_at),
              };
            }),
          };
        })
      : Promise.resolve(undefined),
    wantsQueue
      ? safe("overdue schedules", async () => {
          // Due more than 30 minutes ago and still not run. The worker polls
          // every two minutes and soft-locks a claimed row into the future,
          // so a schedule this late was not simply waiting its turn: the
          // worker is down, failing, or scanning is paused.
          const res = await pool.query<{
            n: string;
            oldest_at: string | null;
          }>(
            `SELECT COUNT(*)::int AS n, MIN(next_run_at) AS oldest_at
               FROM scheduled_scans
              WHERE active = true
                AND next_run_at < NOW() - INTERVAL '30 minutes'`,
          );
          const oldest = res.rows[0]?.oldest_at;
          return {
            workersRun: hostRunsWorkers(),
            count: Number(res.rows[0]?.n) || 0,
            oldestOverdueMs: oldest
              ? Math.max(0, Date.now() - new Date(oldest).getTime())
              : null,
          };
        })
      : Promise.resolve(undefined),
    wantsMaintenance
      ? safe("backup", async () => ({
          lastBackupAt: await newestBackupAt(resolveBackupDir()),
          scheduledEnabled: await getSetting("SCHEDULED_BACKUP_ENABLED"),
          // Source-only setting (see registry.ts's non-editable list: the
          // timer reads it once at registration), so the compiled constant
          // is the live value.
          intervalMs: CONFIG_SCHEDULED_BACKUP_INTERVAL_MS,
        }))
      : Promise.resolve(undefined),
    wantsErrors
      ? safe("error logs", async () => {
          const res = await pool.query<{ n: string }>(
            `SELECT COUNT(*)::int AS n FROM system_error_logs
                WHERE created_at > NOW() - INTERVAL '1 hour'`,
          );
          return { lastHour: Number(res.rows[0]?.n) || 0 };
        })
      : Promise.resolve(undefined),
    wantsMaintenance
      ? safe("email logs", async () => {
          const res = await pool.query<{ failed: string; total: string }>(
            `SELECT COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
                      COUNT(*)::int AS total
                 FROM email_logs
                WHERE created_at > NOW() - INTERVAL '24 hours'`,
          );
          return {
            failedLast24h: Number(res.rows[0]?.failed) || 0,
            totalLast24h: Number(res.rows[0]?.total) || 0,
          };
        })
      : Promise.resolve(undefined),
    wantsMaintenance
      ? safe("security alerts", async () => {
          const res = await pool.query<{ n: string; severe: string }>(
            `SELECT COUNT(*)::int AS n,
                      COUNT(*) FILTER (WHERE severity IN ('high', 'critical'))::int AS severe
                 FROM security_alerts
                WHERE resolved_at IS NULL`,
          );
          return {
            unresolved: Number(res.rows[0]?.n) || 0,
            unresolvedSevere: Number(res.rows[0]?.severe) || 0,
          };
        })
      : Promise.resolve(undefined),
    wantsTickets
      ? safe("support tickets", async () => {
          const res = await pool.query<{
            awaiting: string;
            open: string;
          }>(
            `SELECT COUNT(*) FILTER (WHERE status IN ('open', 'awaiting_staff'))::int AS awaiting,
                      COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed'))::int AS open
                 FROM support_tickets`,
          );
          return {
            awaitingStaff: Number(res.rows[0]?.awaiting) || 0,
            open: Number(res.rows[0]?.open) || 0,
          };
        })
      : Promise.resolve(undefined),
    wantsInvites
      ? safe("staff invites", async () => {
          // instrumentation.ts creates staff_invites at boot, but a
          // database whose boot-time DDL failed (that path only
          // console.errors and continues) will not have it. safe() turns
          // that into an "unknown" row rather than a 500 for the whole
          // page; REQUIRED_TABLES is what actually reports it as a fault.
          const res = await pool.query<{ pending: string; expired: string }>(
            `SELECT COUNT(*) FILTER (WHERE expires_at > NOW())::int AS pending,
                      COUNT(*) FILTER (WHERE expires_at <= NOW())::int AS expired
                 FROM staff_invites
                WHERE accepted_at IS NULL`,
          );
          return {
            pending: Number(res.rows[0]?.pending) || 0,
            expired: Number(res.rows[0]?.expired) || 0,
          };
        })
      : Promise.resolve(undefined),
  ]);

  return NextResponse.json({
    ...(wantsQueue ? { scanQueue: queue, workers, overdueSchedules } : {}),
    ...(wantsMaintenance ? { backup } : {}),
    ...(wantsErrors ? { errorLogs } : {}),
    ...(wantsMaintenance ? { email } : {}),
    ...(wantsMaintenance ? { securityAlerts } : {}),
    ...(wantsTickets ? { supportTickets: tickets } : {}),
    ...(wantsInvites ? { staffInvites: invites } : {}),
    generatedAt: new Date().toISOString(),
  });
});
