/**
 * Background scan job bookkeeping, shared by `app/api/v3/scan/route.ts` and
 * `app/api/v3/scan/crawl/route.ts`.
 *
 * A scan now runs detached from the HTTP request that started it (see those
 * route files for why that is safe in this single-process deployment). This
 * module is the small set of primitives both routes need to make that
 * honest: persisting real progress as `runSyncChecks` / `runAsyncChecksDetailed`
 * report it, a cancellation flag checked between categories, and a watchdog
 * that fails a scan that runs past its time budget instead of leaving it
 * stuck at "running" forever.
 *
 * Cancellation is in-memory and per-process. It is not durable across a
 * restart, and a scan whose process dies mid-run is left at "running" with
 * no in-process timer left to rescue it — a documented limitation of a
 * single, persistent Node process, not a bug within one process's lifetime.
 */

import pool from "@/lib/database/db";
import type { ScanProgressHook, Vulnerability } from "./types";
import { upsertHostReputation } from "./host-reputation";
import { saveAutoTags, maybeSuggestAiTag } from "@/lib/tags/auto-tags";

/** Thrown by a progress hook when the scan it belongs to has been cancelled. */
export class ScanCancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "ScanCancelledError";
  }
}

const cancelledScans = new Set<number>();

/** Flag a scan for cancellation. Checked the next time it reports progress. */
export function requestCancel(scanId: number): void {
  cancelledScans.add(scanId);
}

export function isCancelled(scanId: number): boolean {
  return cancelledScans.has(scanId);
}

/** Forget a scan's cancellation flag once it has reached a terminal state. */
export function clearCancel(scanId: number): void {
  cancelledScans.delete(scanId);
}

export interface ProgressTracker {
  /** Pass to `runSyncChecks` / `runAsyncChecksDetailed` (or both). */
  onProgress: ScanProgressHook;
  /**
   * Set (or update) the progress denominator. Safe to call before any
   * progress has been reported (the scan route knows it up front) or, for
   * a crawl, once page discovery has finished and the real total is known.
   */
  setTotal: (total: number) => void;
}

/**
 * Build a progress tracker for one scan job. The returned hook persists
 * `current_category` / `categories_completed` / `categories_total` to
 * `scan_history` as real "start"/"done" events arrive, and throws
 * `ScanCancelledError` on a "start" event if the scan has been flagged for
 * cancellation — which aborts `runSyncChecks` / `runAsyncChecksDetailed`
 * immediately, before the next unit of work begins.
 *
 * Persistence is fire-and-forget (matches every other non-critical-path
 * write in this codebase, e.g. webhook delivery in scan/route.ts): a
 * missed or out-of-order progress write only makes the progress bar
 * briefly stale, never the final result wrong, and the `WHERE status IN
 * ('pending','running')` guard means a write that lands after the scan
 * already reached a terminal state is a harmless no-op.
 */
export function createProgressTracker(scanId: number): ProgressTracker {
  let total = 0;
  let completed = 0;

  const onProgress: ScanProgressHook = (category, phase) => {
    if (phase === "start") {
      if (isCancelled(scanId)) throw new ScanCancelledError();
      void pool
        .query(
          `UPDATE scan_history
           SET current_category = $1, categories_total = $2
           WHERE id = $3 AND status IN ('pending', 'running')`,
          [category, total, scanId],
        )
        .catch(() => {});
      return;
    }
    completed++;
    void pool
      .query(
        `UPDATE scan_history
         SET categories_completed = $1, categories_total = $2
         WHERE id = $3 AND status IN ('pending', 'running')`,
        [completed, total, scanId],
      )
      .catch(() => {});
  };

  return {
    onProgress,
    setTotal: (t: number) => {
      total = t;
    },
  };
}

/**
 * Start the watchdog for a scan job. If the job has not reached a terminal
 * state within `timeoutMs`, this marks it `failed` with `reason`. The
 * `WHERE status IN ('pending','running')` guard means a scan that finishes
 * (successfully or not) just before the timer fires is left alone — the
 * real completion always wins the race.
 *
 * The caller must `clearTimeout` the returned handle once the job settles,
 * or the timer (and the closure holding `scanId`/`reason`) leaks for the
 * full `timeoutMs` on every scan.
 */
export function startWatchdog(
  scanId: number,
  timeoutMs: number,
  reason: string,
): NodeJS.Timeout {
  return setTimeout(() => {
    void finalizeScanFailure(scanId, reason);
  }, timeoutMs);
}

export interface ScanSuccessData {
  summary: Record<string, unknown>;
  findings: unknown[];
  duration: number;
  scannedAt: string;
  responseHeaders: Record<string, string>;
  /** Fields that don't have their own column: checksRun, dangerScore, etc. */
  resultMeta: Record<string, unknown>;
}

/**
 * Commit a scan's final result and flip it to `completed`. Only takes
 * effect if the row is still `pending`/`running` — a scan already marked
 * `failed` (watchdog timeout, cancellation) keeps that status even if the
 * underlying work eventually finishes and calls this. Returns whether the
 * write actually applied.
 */
export async function finalizeScanSuccess(
  scanId: number,
  data: ScanSuccessData,
): Promise<boolean> {
  // The status-flip UPDATE and the auto-tags INSERT run on the same
  // client inside one transaction so they commit atomically -- see
  // saveAutoTags' own doc comment (lib/tags/auto-tags.ts) for the race
  // this closes: two separate autocommitted pool.query() calls left a
  // real window where a client polling GET /api/v3/scan/status/[id]
  // could observe status='completed' before the tags existed yet.
  const client = await pool.connect();
  let result: {
    rowCount: number | null;
    rows: {
      id: number;
      url: string;
      user_id: number;
      is_public: boolean;
      authenticated: boolean;
    }[];
  };
  // Populated inside the transaction below when saveAutoTags actually runs;
  // read afterward (outside the transaction) to decide whether to fire the
  // AI follow-up -- see that call's own comment.
  let savedTags: string[] = [];
  try {
    await client.query("BEGIN");
    result = await client.query<{
      id: number;
      url: string;
      user_id: number;
      is_public: boolean;
      authenticated: boolean;
    }>(
      `UPDATE scan_history
       SET status = 'completed',
           findings = $1,
           findings_count = $2,
           summary = $3,
           duration = $4,
           scanned_at = $5,
           response_headers = $6,
           result_meta = $7,
           current_category = NULL,
           categories_completed = categories_total,
           error_message = NULL
       WHERE id = $8 AND status IN ('pending', 'running')
       RETURNING id, url, user_id, is_public, authenticated`,
      [
        JSON.stringify(data.findings),
        data.findings.length,
        JSON.stringify(data.summary),
        data.duration,
        data.scannedAt,
        JSON.stringify(data.responseHeaders),
        JSON.stringify(data.resultMeta),
        scanId,
      ],
    );

    const appliedInTx = (result.rowCount ?? 0) > 0;
    const txUserId = result.rows[0]?.user_id;
    if (appliedInTx && txUserId) {
      // Auto tags (lib/tags/auto-tags.ts), unlike host_reputation below:
      // not gated on isPublic/url -- they're personal to the user's own
      // scan record, not the public reputation cache, so a private scan
      // still gets tagged. saveAutoTags never throws (catches and logs
      // internally), so a tag-save failure can't abort this transaction
      // or stop the scan from completing. Captured so the AI follow-up
      // below can decide whether it's worth firing, once this transaction
      // has actually committed -- see that call's own comment for why it
      // must not happen any earlier than that.
      savedTags = await saveAutoTags(
        scanId,
        txUserId,
        data.findings as Vulnerability[],
        client,
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  clearCancel(scanId);
  const applied = (result.rowCount ?? 0) > 0;

  // AI tag suggestion (lib/tags/auto-tags.ts's maybeSuggestAiTag), the
  // other half of the layered auto-tag design -- fired here, deliberately
  // OUTSIDE the try block above and only after `await client.query("COMMIT")`
  // has already resolved: the scan's completed status and its deterministic
  // tags are both durably committed and visible to a polling client before
  // this ever runs. Fire-and-forget (never awaited) and itself a no-op
  // unless savedTags is exactly ["Needs Hardening"], so this never delays
  // or risks the response finalizeScanSuccess's own callers return.
  const txUserIdForAi = result.rows[0]?.user_id;
  if (applied && txUserIdForAi && savedTags.length > 0) {
    void maybeSuggestAiTag(
      scanId,
      txUserIdForAi,
      savedTags,
      data.findings as Vulnerability[],
    );
  }

  // Host-level reputation cache for the browser extension's popup and the
  // public /host/[hostname] page. Covers both single-URL scans
  // (lib/scanner/execute-scan.ts) and crawl scans
  // (lib/scanner/execute-crawl-scan.ts), the two callers of this function,
  // regardless of whether the scan was run from the web app or via API key.
  // Skipped entirely for a scan the owner asked to keep private -- see
  // scan_history.is_public in instrumentation.ts. Fire-and-forget: never
  // blocks or fails the scan itself.
  const url = result.rows[0]?.url;
  const isPublic = result.rows[0]?.is_public !== false;
  if (applied && url && isPublic) {
    void upsertHostReputation({
      url,
      findings: data.findings as Vulnerability[],
      summary: data.summary as Partial<{
        critical: number;
        high: number;
        medium: number;
        low: number;
        info: number;
      }>,
      responseHeaders: data.responseHeaders,
      scanId,
      scannedAt: data.scannedAt,
      resultMeta: data.resultMeta,
      authenticated: result.rows[0]?.authenticated ?? false,
    });
  }

  return applied;
}

/** Cap on how much of an error message is stored, matching other free-text columns. */
const MAX_ERROR_MESSAGE_LENGTH = 2000;

/**
 * Mark a scan `failed` with a real reason. Only takes effect if the row is
 * still `pending`/`running`, same guard and reasoning as
 * `finalizeScanSuccess`. Returns whether the write actually applied.
 */
export async function finalizeScanFailure(
  scanId: number,
  reason: string,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE scan_history
     SET status = 'failed',
         error_message = $1,
         current_category = NULL,
         duration = COALESCE(
           (EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::INTEGER,
           duration
         )
     WHERE id = $2 AND status IN ('pending', 'running')
     RETURNING id`,
    [reason.slice(0, MAX_ERROR_MESSAGE_LENGTH), scanId],
  );
  clearCancel(scanId);
  return (result.rowCount ?? 0) > 0;
}

/** Flip a scan from `pending` to `running` and record when execution began. */
export async function markScanRunning(scanId: number): Promise<void> {
  await pool
    .query(
      `UPDATE scan_history
       SET status = 'running'
       WHERE id = $1 AND status = 'pending'`,
      [scanId],
    )
    .catch(() => {});
}
