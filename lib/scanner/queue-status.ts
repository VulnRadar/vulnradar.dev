/**
 * The reads behind Admin > System > Scanner Queue.
 *
 * They live here and not in app/api/v3/admin/queue-status/route.ts so that the
 * integration tier can run the SQL against a real database: which rows land in
 * which count is a claim about Postgres (a GROUP BY over a nullable column, a
 * boolean in an ORDER BY), and a faked pool answers any query however the test
 * told it to. The route keeps auth and the shape of the response.
 */

import pool from "@/lib/database/db";
import {
  ENGINE_FAILURE_KINDS,
  isEngineFailure,
} from "@/lib/scanner/failure-kinds";

const RECENT_WINDOW = "24 hours";

/** Enough to see the shape of an incident without turning this into a log
 *  viewer. If an operator needs more than the last 25 failures, the failure
 *  is systemic and the server logs are the right tool. */
export const FAILED_SAMPLE_LIMIT = 25;

/** The same idea for the live list: it is for finding the one scan that is
 *  stuck, not for browsing the queue. */
export const INFLIGHT_LIMIT = 50;

export interface QueueCounts {
  pending: number;
  running: number;
  completedLast24h: number;
  failedLast24h: number;
  cancelledLast24h: number;
  refusedLast24h: number;
  notRunLast24h: number;
  targetFailedLast24h: number;
}

export interface QueueSnapshot {
  counts: QueueCounts;
  oldestPendingAt: string | null;
  oldestRunningAt: string | null;
}

type QueueStatusRow = {
  status: "pending" | "running" | "completed" | "failed";
  failure_kind?: string | null;
  count: string | number;
  oldest_at: string | null;
};

export type FailedScanRow = {
  id: number;
  user_id: number;
  url: string;
  error_message: string | null;
  failure_kind: string | null;
  source: string;
  duration: number;
  scanned_at: string | null;
};

export type InflightScanRow = {
  id: number;
  user_id: number;
  url: string;
  source: string;
  status: "pending" | "running";
  started_at: string | null;
  current_category: string | null;
};

/**
 * Which count a failed row lands in.
 *
 * There was one number, "Failed", and it was every row with status = 'failed':
 * a user pressing Cancel, a daily limit turning a bulk URL away, a URL its
 * batch never reached, a target that was simply down, and the scanner actually
 * breaking. A busy day looked like an incident and a real incident was lost
 * among the cancels. Only the engine's own kinds are a failure; the rest are
 * the product working, counted separately so they can still be seen. A row
 * with no recorded kind counts as the engine: undercounting real failures is
 * the worse mistake for a health check.
 */
const FAILED_COUNT_KEY = {
  engine: "failedLast24h",
  cancelled: "cancelledLast24h",
  refused: "refusedLast24h",
  notRun: "notRunLast24h",
  target: "targetFailedLast24h",
} as const;

function failedCountKey(
  kind: string | null | undefined,
): (typeof FAILED_COUNT_KEY)[keyof typeof FAILED_COUNT_KEY] {
  if (isEngineFailure(kind)) return FAILED_COUNT_KEY.engine;
  if (kind === "cancelled" || kind === "admin_cancelled") {
    return FAILED_COUNT_KEY.cancelled;
  }
  if (kind === "quota_refused") return FAILED_COUNT_KEY.refused;
  if (kind === "not_run") return FAILED_COUNT_KEY.notRun;
  return FAILED_COUNT_KEY.target;
}

/** The earlier of two timestamps; either may be absent. */
function older(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
}

/**
 * pending/running counts are all-time (backed by the partial index
 * idx_scan_history_status_pending_running -- a healthy queue keeps both near
 * zero, so scanning the whole table for just those two statuses is cheap).
 * completed/failed are capped to the last 24h (backed by
 * idx_scan_history_scanned_at) so this stays a fast, bounded query on a
 * scan_history table that otherwise grows without limit.
 *
 * started_at is set to NOW() at INSERT time for every scan, including ones
 * still 'pending', so it doubles as "when this row entered the queue" for both
 * pending and running rows. scanned_at is only meaningful once a scan
 * finishes, and is stamped when a failure is recorded, so the 24h window counts
 * a failed scan from when it failed rather than from when it was queued.
 */
export async function readQueueSnapshot(): Promise<QueueSnapshot> {
  const result = await pool.query<QueueStatusRow>(
    `SELECT
       status,
       failure_kind,
       COUNT(*)::int AS count,
       MIN(COALESCE(started_at, scanned_at)) AS oldest_at
     FROM scan_history
     WHERE status IN ('pending', 'running')
        OR (status IN ('completed', 'failed')
            AND scanned_at > NOW() - INTERVAL '${RECENT_WINDOW}')
     GROUP BY status, failure_kind`,
  );

  const counts: QueueCounts = {
    pending: 0,
    running: 0,
    completedLast24h: 0,
    failedLast24h: 0,
    cancelledLast24h: 0,
    refusedLast24h: 0,
    notRunLast24h: 0,
    targetFailedLast24h: 0,
  };
  let oldestPendingAt: string | null = null;
  let oldestRunningAt: string | null = null;

  for (const row of result.rows) {
    const count = Number(row.count) || 0;
    if (row.status === "pending") {
      counts.pending += count;
      oldestPendingAt = older(oldestPendingAt, row.oldest_at);
    } else if (row.status === "running") {
      counts.running += count;
      oldestRunningAt = older(oldestRunningAt, row.oldest_at);
    } else if (row.status === "completed") {
      counts.completedLast24h += count;
    } else if (row.status === "failed") {
      counts[failedCountKey(row.failure_kind)] += count;
    }
  }

  return { counts, oldestPendingAt, oldestRunningAt };
}

/**
 * The rows behind the failure counts. That tile was a bare number with nothing
 * underneath it, so an operator could see THAT scans were failing and never
 * what failed or why - the one question the panel exists to answer.
 *
 * The engine's own failures sort first. A bulk batch cut off by a limit can
 * write dozens of rows at once, and in a flat newest-first sample they pushed
 * the one real fault out of the 25.
 *
 * error_message is selected RAW, deliberately. See the route for why it must
 * not go through publicScanErrorMessage.
 */
export async function readFailureSample(): Promise<FailedScanRow[]> {
  const failed = await pool.query<FailedScanRow>(
    `SELECT id, user_id, url, error_message, failure_kind, source,
            duration, scanned_at
       FROM scan_history
      WHERE status = 'failed'
        AND scanned_at > NOW() - INTERVAL '${RECENT_WINDOW}'
      ORDER BY (failure_kind IS NULL OR failure_kind = ANY($1::text[])) DESC,
               scanned_at DESC
      LIMIT ${FAILED_SAMPLE_LIMIT}`,
    [[...ENGINE_FAILURE_KINDS]],
  );
  return failed.rows;
}

/**
 * Which scans are in flight right now, oldest first: the stuck one is the one
 * that has been going longest. The counts say how many; this is what an
 * operator needs to act on one of them.
 */
export async function readInflight(): Promise<InflightScanRow[]> {
  const live = await pool.query<InflightScanRow>(
    `SELECT id, user_id, url, source, status, started_at, current_category
       FROM scan_history
      WHERE status IN ('pending', 'running')
      ORDER BY started_at ASC NULLS LAST
      LIMIT ${INFLIGHT_LIMIT}`,
  );
  return live.rows;
}
