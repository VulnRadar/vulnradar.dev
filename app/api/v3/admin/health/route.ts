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
    console.error(`[admin/health] ${label} failed:`, error);
    return null;
  }
}

export async function GET() {
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

  const [queue, backup, errorLogs, email, securityAlerts, tickets, invites] =
    await Promise.all([
      wantsQueue
        ? safe("scan queue", async () => {
            // Identical shape to /api/v3/admin/queue-status: pending/running
            // are all-time (partial index, near zero on a healthy queue),
            // completed/failed are capped to 24h so this stays bounded as
            // scan_history grows.
            const res = await pool.query<{
              status: string;
              count: string;
              oldest_at: string | null;
            }>(
              `SELECT status, COUNT(*)::int AS count,
                      MIN(COALESCE(started_at, scanned_at)) AS oldest_at
                 FROM scan_history
                WHERE status IN ('pending', 'running')
                   OR (status IN ('completed', 'failed')
                       AND scanned_at > NOW() - INTERVAL '24 hours')
                GROUP BY status`,
            );
            const now = Date.now();
            const ageMs = (at: string | null) =>
              at ? Math.max(0, now - new Date(at).getTime()) : null;
            let pending = 0;
            let running = 0;
            let completedLast24h = 0;
            let failedLast24h = 0;
            let oldestPendingAgeMs: number | null = null;
            let oldestRunningAgeMs: number | null = null;
            for (const row of res.rows) {
              const count = Number(row.count) || 0;
              if (row.status === "pending") {
                pending = count;
                oldestPendingAgeMs = ageMs(row.oldest_at);
              } else if (row.status === "running") {
                running = count;
                oldestRunningAgeMs = ageMs(row.oldest_at);
              } else if (row.status === "completed") {
                completedLast24h = count;
              } else if (row.status === "failed") {
                failedLast24h = count;
              }
            }
            return {
              pending,
              running,
              oldestPendingAgeMs,
              oldestRunningAgeMs,
              completedLast24h,
              failedLast24h,
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
    ...(wantsQueue ? { scanQueue: queue } : {}),
    ...(wantsMaintenance ? { backup } : {}),
    ...(wantsErrors ? { errorLogs } : {}),
    ...(wantsMaintenance ? { email } : {}),
    ...(wantsMaintenance ? { securityAlerts } : {}),
    ...(wantsTickets ? { supportTickets: tickets } : {}),
    ...(wantsInvites ? { staffInvites: invites } : {}),
    generatedAt: new Date().toISOString(),
  });
}
