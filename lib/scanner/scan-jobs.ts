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
import {
  saveAutoTags,
  maybeSuggestAiTag,
  loadPromotedRules,
} from "@/lib/tags/auto-tags";
import { getSettings } from "@/lib/config/runtime-config";

/** Thrown by a progress hook when the scan it belongs to has been cancelled. */
export class ScanCancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "ScanCancelledError";
  }
}

const cancelledScans = new Set<number>();

/**
 * Per-scan AbortControllers, lazily created by `getCancelSignal`. Separate
 * from `cancelledScans` above: that Set is checked between categories by
 * `onProgress`, which is enough for work that hasn't started yet, but does
 * nothing for a request already in flight (e.g. an active-probe form
 * submission mid-request when cancellation is requested). A signal aborts
 * that request itself instead of only stopping the next one from starting.
 */
const cancelControllers = new Map<number, AbortController>();

/** Flag a scan for cancellation. Checked the next time it reports progress,
 *  and immediately aborts any in-flight work holding this scan's signal
 *  (see `getCancelSignal`). */
export function requestCancel(scanId: number): void {
  cancelledScans.add(scanId);
  cancelControllers.get(scanId)?.abort();
}

export function isCancelled(scanId: number): boolean {
  return cancelledScans.has(scanId);
}

/** Forget a scan's cancellation flag once it has reached a terminal state. */
export function clearCancel(scanId: number): void {
  cancelledScans.delete(scanId);
  cancelControllers.delete(scanId);
}

/**
 * An AbortSignal that fires the instant `requestCancel(scanId)` is called,
 * for callers that need to actually interrupt an in-flight request rather
 * than just check a flag before starting the next unit of work. Pass this
 * into `safeFetch`'s `init.signal` (it combines a caller signal with its
 * own per-request timeout automatically) wherever a check makes real
 * requests to the scan target, most importantly the active-probe checks,
 * which submit real exploit-attempt payloads and must stop sending them the
 * moment a scan is cancelled.
 *
 * Lazily creates the controller on first call so a scan that's never
 * cancelled never pays for one, and immediately returns an already-aborted
 * signal if `requestCancel` already fired before this was first called
 * (closes the race between the two).
 */
export function getCancelSignal(scanId: number): AbortSignal {
  let controller = cancelControllers.get(scanId);
  if (!controller) {
    controller = new AbortController();
    if (isCancelled(scanId)) controller.abort();
    cancelControllers.set(scanId, controller);
  }
  return controller.signal;
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
  /**
   * Write any coalesced progress that has not been flushed yet and cancel the
   * pending flush timer. Call once from the job's `finally` block: it both
   * lands the last progress value (so a poll between the final check and
   * finalize sees the true count) and stops a timer from outliving the job.
   */
  flush: () => void;
}

/**
 * How long progress writes are coalesced for. The status poll runs on a 2s
 * interval (AUDIT-011#scan-03), so sub-second progress precision buys the
 * client nothing and costs a row rewrite of the widest table in the schema.
 */
const PROGRESS_FLUSH_INTERVAL_MS = 500;

/**
 * How many in-progress findings are carried on the status poll.
 *
 * They exist so the wait shows the scan producing something rather than an
 * empty bar, not so a client can read the result early: the authoritative
 * list is written once, by `finalizeScanSuccess`, after `dedupeFindings` has
 * run. That is also why a streamed count can end up HIGHER than the final
 * one, and why a consumer should present these as "found so far" and let the
 * completed result replace them wholesale rather than animating a number
 * downward. ref: AUDIT-014#scanui-02
 */
const MAX_PARTIAL_FINDINGS = 40;

/**
 * Build a progress tracker for one scan job. The returned hook persists
 * `current_category` / `categories_completed` / `categories_total` to
 * `scan_history` as real "start"/"done" events arrive, and throws
 * `ScanCancelledError` on a "start" event if the scan has been flagged for
 * cancellation — which aborts `runSyncChecks` / `runAsyncChecksDetailed`
 * immediately, before the next unit of work begins.
 *
 * Writes are coalesced rather than issued per event. Every event used to fire
 * its own UPDATE, two per category, roughly 40 per default scan and 40 per
 * page on a crawl. Because Postgres is MVCC and scan_history carries the
 * `findings`, `summary`, `response_headers` and `result_meta` JSONB columns,
 * each one wrote a whole new version of the widest row in the schema and left
 * a dead tuple behind, on the one table every list, dashboard and public page
 * reads from. The tracker now keeps the counters in memory and writes at most
 * once per PROGRESS_FLUSH_INTERVAL_MS, in one UPDATE that carries all three
 * columns. ref: AUDIT-012#perf-12
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
  let currentCategory: string | null = null;
  let lastWriteAt = 0;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const partialFindings: { severity: string; title: string }[] = [];

  const write = () => {
    dirty = false;
    lastWriteAt = Date.now();
    void pool
      .query(
        `UPDATE scan_history
         SET current_category = $1, categories_completed = $2, categories_total = $3,
             result_meta = COALESCE(result_meta, '{}'::jsonb) || $5::jsonb
         WHERE id = $4 AND status IN ('pending', 'running')`,
        [
          currentCategory,
          completed,
          total,
          scanId,
          JSON.stringify({ partialFindings }),
        ],
      )
      .catch(() => {});
  };

  /** Write now if the interval has elapsed, otherwise arm a trailing flush. */
  const schedule = () => {
    dirty = true;
    if (timer) return;
    const wait = PROGRESS_FLUSH_INTERVAL_MS - (Date.now() - lastWriteAt);
    if (wait <= 0) {
      write();
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      if (dirty) write();
    }, wait);
    // A progress timer must never be the reason the process stays alive.
    timer.unref?.();
  };

  const onProgress: ScanProgressHook = (category, phase, snapshot) => {
    if (phase === "start") {
      if (isCancelled(scanId)) throw new ScanCancelledError();
      currentCategory = category;
      schedule();
      return;
    }
    completed++;
    // Findings this category turned up, accumulated so a polling client can
    // show the scan producing something instead of a bar and nothing else.
    // Capped: the poll runs every 2 seconds and this rides along on a row
    // that is already the widest in the schema.
    if (snapshot?.newFindings?.length) {
      for (const f of snapshot.newFindings) {
        if (partialFindings.length >= MAX_PARTIAL_FINDINGS) break;
        partialFindings.push({ severity: f.severity, title: f.title });
      }
    }
    schedule();
  };

  return {
    onProgress,
    setTotal: (t: number) => {
      total = t;
    },
    flush: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (dirty) write();
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
    // Abort the work BEFORE flipping the row. Marking the row `failed`
    // immediately returns the concurrency slot (the limiter counts rows
    // `WHERE status IN ('pending','running')`), so without this the scan the
    // watchdog just declared dead kept issuing outbound requests against the
    // target with its slot already handed to someone else. requestCancel
    // aborts the AbortController the job holds via getCancelSignal, and it
    // has to run first: finalizeScanFailure calls clearCancel, which drops
    // that controller from the map, so a requestCancel afterwards would find
    // nothing left to abort. ref: AUDIT-012#abuse-06
    requestCancel(scanId);
    // Guard the rejection: the watchdog fires precisely when a scan is stuck,
    // which is disproportionately because the DB is already unhealthy -- the
    // moment finalizeScanFailure's query is most likely to reject. A bare
    // `void` here would surface as an unhandled rejection from a timer with no
    // handler and, on Node's default, terminate the whole persistent process.
    finalizeScanFailure(scanId, reason).catch(() => {});
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
  /**
   * The URL actually fetched, if safeFetch followed a same-host redirect
   * away from the URL the scan was requested with (e.g. https://host/ ->
   * https://host/landing). Only set when it differs from the requested
   * URL -- the COALESCE below leaves scan_history.url exactly as the
   * initial INSERT (app/api/v3/scan/route.ts) wrote it otherwise, so
   * every caller that doesn't pass this (crawl scans, which record each
   * page's own URL individually) is unaffected.
   */
  finalUrl?: string;
  /**
   * Set true by an authenticated crawl (lib/scanner/execute-crawl-scan.ts) to
   * record the non-secret fact that the crawl ran behind a login. Only the
   * boolean reaches this column -- never any credential material. Left
   * undefined by every other caller (single-URL scans), in which case the
   * COALESCE below leaves the column exactly as the tracker-row INSERT wrote
   * it (its false default).
   */
  authenticated?: boolean;
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
  // Warm the promoted-rules cache BEFORE taking a pool connection. saveAutoTags
  // below runs on the transaction's client, but its first statement is
  // loadPromotedRules, which on a cache miss queries the module-level pool: a
  // SECOND connection asked for while this function still holds the first one
  // inside an open transaction. With CONFIG_DB_POOL_MAX = 10, ten scans
  // finalizing inside the same cache-miss window each hold a client and each
  // wait for an eleventh that cannot exist, so all ten stall until
  // connectionTimeoutMillis fires and are marked failed after their work was
  // already done. The misses are real rather than theoretical: the cache has a
  // 5-minute TTL and is invalidated on every admin promotion. Doing the load
  // here makes the call inside the transaction an ordinary cache hit.
  // Failure is non-fatal, exactly as it is inside saveAutoTags: a rejected
  // warm-up must not stop a finished scan from being committed.
  await loadPromotedRules().catch(() => {});

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
           -- Whole-value assignment, not a merge: this is also what clears
           -- the in-progress partialFindings the tracker above writes into
           -- this column, so a poll of a finished scan can never carry two
           -- lists. ref: AUDIT-014#scanui-02
           result_meta = $7,
           url = COALESCE($8, url),
           authenticated = COALESCE($10, authenticated),
           current_category = NULL,
           categories_completed = categories_total,
           error_message = NULL
       WHERE id = $9 AND status IN ('pending', 'running')
       RETURNING id, url, user_id, is_public, authenticated`,
      [
        JSON.stringify(data.findings),
        data.findings.length,
        JSON.stringify(data.summary),
        data.duration,
        data.scannedAt,
        JSON.stringify(data.responseHeaders),
        JSON.stringify(data.resultMeta),
        data.finalUrl ?? null,
        scanId,
        data.authenticated ?? null,
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
         result_meta = COALESCE(result_meta, '{}'::jsonb) - 'partialFindings',
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

/**
 * Flip a scan from `pending` to `running` and record when execution began.
 *
 * `started_at` is re-stamped here rather than left as the INSERT wrote it,
 * because a row no longer necessarily starts running the moment it is created:
 * a bulk batch (lib/scanner/execute-bulk-scan.ts) reserves every URL's row up
 * front and then runs them one at a time, so the tenth URL's row can sit
 * `pending` for minutes. finalizeScanFailure derives a failed scan's duration
 * from `started_at`, and the watchdog budget is about execution, not queueing,
 * so without this a queued scan that later failed reported its queue wait as
 * scan time. For a single scan the two timestamps are a few milliseconds
 * apart, so nothing else changes.
 */
export async function markScanRunning(scanId: number): Promise<void> {
  await pool
    .query(
      `UPDATE scan_history
       SET status = 'running', started_at = NOW()
       WHERE id = $1 AND status = 'pending'`,
      [scanId],
    )
    .catch(() => {});
}

/**
 * Fail every scan_history row still `pending`/`running` from BEFORE this
 * process started. Called once at boot (see instrumentation.ts) as the
 * counterpart to the in-memory watchdog above: that watchdog dies with its
 * process, so a scan whose process was killed mid-run (a deploy, an OOM
 * kill, a crash) had nothing left to rescue it and stayed "running" forever
 * on the owner's dashboard until they manually noticed (AUDIT-010,
 * production-readiness #2). Every real completion path (finalizeScanSuccess/
 * finalizeScanFailure) already guards on `WHERE status IN ('pending',
 * 'running')`, so this can never race a scan that's genuinely still
 * in-flight in the CURRENT process.
 *
 * It CAN race another process, though, which is why the sweep is bounded by
 * an age guard rather than taking every non-terminal row. "There is no
 * current process yet when this runs" is only true of a single instance.
 * instrumentation.ts takes a boot advisory lock precisely because two
 * instances can start at once, and a rolling deploy has a booting instance
 * overlapping a draining one: an unbounded sweep marks the draining
 * instance's live scans `failed`, and because finalizeScanSuccess guards on
 * `WHERE status IN ('pending','running')` the real completion then matches
 * nothing. The owner is told their scan was interrupted by a restart, and
 * the results it actually produced are dropped. Returns the number of rows
 * swept.
 */
/**
 * Floor for the stale-scan sweep's age guard. A scan cannot outlive its
 * watchdog by more than its own budget, so fifteen minutes is comfortably
 * past any real scan while still clearing an orphaned row on the next boot.
 */
const STALE_SCAN_MIN_GRACE_SECONDS = 15 * 60;

export async function sweepStaleScans(): Promise<number> {
  const {
    SCAN_TIMEOUT_SECONDS: scanTimeoutSeconds,
    CRAWL_SCAN_TIMEOUT_SECONDS: crawlTimeoutSeconds,
  } = await getSettings([
    "SCAN_TIMEOUT_SECONDS",
    "CRAWL_SCAN_TIMEOUT_SECONDS",
  ] as const);
  // Twice the longest budget an admin has configured, so the in-process
  // watchdog always gets to fail its own scan first and this stays the safety
  // net it is documented as. The floor covers a deployment that has set both
  // budgets very low.
  const graceSeconds = Math.max(
    STALE_SCAN_MIN_GRACE_SECONDS,
    Math.max(scanTimeoutSeconds, crawlTimeoutSeconds) * 2,
  );
  const result = await pool.query(
    `UPDATE scan_history
     SET status = 'failed',
         error_message = 'Scan interrupted by a server restart. Please run it again.',
         current_category = NULL,
         duration = COALESCE(
           (EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::INTEGER,
           duration
         )
     WHERE status IN ('pending', 'running')
       AND COALESCE(started_at, scanned_at, TIMESTAMP 'epoch')
             < NOW() - ($1 || ' seconds')::interval
     RETURNING id`,
    [String(graceSeconds)],
  );
  return result.rowCount ?? 0;
}
