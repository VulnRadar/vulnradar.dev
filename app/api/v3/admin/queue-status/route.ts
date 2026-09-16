import { NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { requirePermission } from "@/lib/auth/authorization";
import { STAFF_PERMISSIONS } from "@/lib/auth/permissions-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECENT_WINDOW = "24 hours";

/** Enough to see the shape of an incident without turning this into a log
 *  viewer. If an operator needs more than the last 25 failures, the failure
 *  is systemic and the server logs are the right tool. */
const FAILED_SAMPLE_LIMIT = 25;

type QueueStatusRow = {
  status: "pending" | "running" | "completed" | "failed";
  count: string;
  oldest_at: string | null;
};

type FailedScanRow = {
  id: number;
  user_id: number;
  url: string;
  error_message: string | null;
  source: string;
  duration: number;
  started_at: string | null;
  scanned_at: string | null;
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
export async function GET(request: Request) {
  const admin = await requirePermission(STAFF_PERMISSIONS.VIEW_SYSTEM_STATS);
  if (!admin) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }

  // Opt-in, and deliberately not part of the polled payload.
  //
  // The card behind this polls every 45 seconds, and the counts above are
  // aggregate: they name no user and no target. The failure rows are the
  // opposite - a URL somebody scanned, tied to their user id - so shipping
  // them on every poll would put customer targets on the wire continuously
  // to render a section that is collapsed most of the time. The operator
  // asks for them when they open the list, and not before.
  const wantFailures =
    new URL(request.url).searchParams.get("failures") === "1";

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

    // The rows behind the "Failed (24h)" count. That tile was a bare number
    // with nothing underneath it, so an operator could see THAT scans were
    // failing and never what failed or why - the one question the panel
    // exists to answer.
    //
    // error_message is returned RAW, which is the deliberate part. The
    // sanitizer in lib/api/scan-error-message.ts exists because the scan
    // pipeline persists `error.message` verbatim and that string can name an
    // internal host, port or table; it is applied where the row is shown to
    // the person who RAN the scan. Its docblock says the raw string stays in
    // the row "which is where an operator debugging the failure should be
    // looking anyway", and this is that surface. Collapsing a pg driver error
    // to "an internal error occurred" here would hide exactly the detail the
    // reader is here for, from a reader who already holds
    // VIEW_SYSTEM_STATS. Do not route this through publicScanErrorMessage.
    //
    // Same reason the response carries user_id and not an email: an operator
    // triaging a spike needs to know whether it is one account or fifty, and
    // an id answers that. Putting a name to the id is VIEW_USERS' job, in the
    // Users tab, and joining users here would quietly widen what this
    // endpoint's own permission grants.
    let failures: FailedScanRow[] | undefined;
    if (wantFailures) {
      const failed = await pool.query<FailedScanRow>(
        `SELECT id, user_id, url, error_message, source, duration,
                started_at, scanned_at
           FROM scan_history
          WHERE status = 'failed'
            AND scanned_at > NOW() - INTERVAL '${RECENT_WINDOW}'
          ORDER BY scanned_at DESC
          LIMIT ${FAILED_SAMPLE_LIMIT}`,
      );
      failures = failed.rows;
    }

    return NextResponse.json({
      counts,
      oldestPendingAgeMs: ageMs(oldestPendingAt),
      oldestRunningAgeMs: ageMs(oldestRunningAt),
      recentWindowHours: 24,
      generatedAt: new Date(now).toISOString(),
      ...(failures
        ? {
            failures: failures.map((row) => ({
              id: row.id,
              userId: row.user_id,
              url: row.url,
              error: row.error_message,
              source: row.source,
              durationMs: row.duration,
              failedAt: row.scanned_at,
              ranForMs:
                row.started_at && row.scanned_at
                  ? Math.max(
                      0,
                      new Date(row.scanned_at).getTime() -
                        new Date(row.started_at).getTime(),
                    )
                  : null,
            })),
            failuresTruncated: failures.length === FAILED_SAMPLE_LIMIT,
          }
        : {}),
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
