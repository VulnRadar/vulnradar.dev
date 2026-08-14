import { NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { requirePermission } from "@/lib/auth/authorization";
import { STAFF_PERMISSIONS } from "@/lib/auth/permissions-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECENT_WINDOW = "24 hours";

type QueueStatusRow = {
  status: "pending" | "running" | "completed" | "failed";
  count: string;
  oldest_at: string | null;
};

/**
 * GET /api/v3/admin/queue-status
 *
 * AUDIT-010 admin-feature-gap: there was no way for an operator to tell
 * "is the scanner backed up right now" without direct DB access. One
 * grouped COUNT(*) over scan_history.status, plus the oldest pending/
 * running row's age, answers that. Powers
 * components/admin/features/queue-status-manager.tsx.
 *
 * pending/running counts are all-time (backed by the partial index
 * idx_scan_history_status_pending_running -- a healthy queue keeps both
 * near zero, so scanning the whole table for just those two statuses is
 * cheap). completed/failed are capped to the last 24h (backed by
 * idx_scan_history_scanned_at) so this stays a fast, bounded query on a
 * scan_history table that otherwise grows without limit -- an all-time
 * COUNT(*) grouped by every status would degrade into a full table scan
 * as history accumulates.
 *
 * started_at is set to NOW() at INSERT time for every scan (see
 * app/api/v3/scan/route.ts), including ones still 'pending', so it
 * doubles as "when this row entered the queue" for both pending and
 * running rows -- scanned_at is only meaningful once a scan finishes.
 */
export async function GET() {
  const admin = await requirePermission(STAFF_PERMISSIONS.VIEW_SYSTEM_STATS);
  if (!admin) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }

  try {
    const result = await pool.query<QueueStatusRow>(
      `SELECT
         status,
         COUNT(*)::int AS count,
         MIN(COALESCE(started_at, scanned_at)) AS oldest_at
       FROM scan_history
       WHERE status IN ('pending', 'running')
          OR (status IN ('completed', 'failed')
              AND scanned_at > NOW() - INTERVAL '${RECENT_WINDOW}')
       GROUP BY status`,
    );

    const counts = {
      pending: 0,
      running: 0,
      completedLast24h: 0,
      failedLast24h: 0,
    };
    let oldestPendingAt: string | null = null;
    let oldestRunningAt: string | null = null;

    for (const row of result.rows) {
      const count = Number(row.count) || 0;
      if (row.status === "pending") {
        counts.pending = count;
        oldestPendingAt = row.oldest_at;
      } else if (row.status === "running") {
        counts.running = count;
        oldestRunningAt = row.oldest_at;
      } else if (row.status === "completed") {
        counts.completedLast24h = count;
      } else if (row.status === "failed") {
        counts.failedLast24h = count;
      }
    }

    const now = Date.now();
    const ageMs = (at: string | null) =>
      at ? Math.max(0, now - new Date(at).getTime()) : null;

    return NextResponse.json({
      counts,
      oldestPendingAgeMs: ageMs(oldestPendingAt),
      oldestRunningAgeMs: ageMs(oldestRunningAt),
      recentWindowHours: 24,
      generatedAt: new Date(now).toISOString(),
    });
  } catch (error) {
    console.error(
      "[admin/queue-status] Failed to fetch scanner queue status:",
      error,
    );
    return NextResponse.json(
      { error: "Failed to fetch scanner queue status." },
      { status: 500 },
    );
  }
}
