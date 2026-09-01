/**
 * Background drain for POST /api/v3/scan/bulk.
 *
 * The bulk route used to run every URL's scan INLINE, sequentially, inside
 * the HTTP request, bounded only by BULK_SCAN_TIMEOUT_SECONDS (1800 by
 * default). POST /api/v3/scan has been an immediate-return dispatcher since
 * the background-job split, so the two entry points had opposite contracts:
 * a ten-URL batch was a multi-minute blocking request that a proxy in front
 * of the app (Cloudflare cuts at 100s) severed while the scans kept running
 * and kept charging the account's daily quota, and the caller got nothing
 * back at all -- no scan ids, no way to poll, no way to find the rows that
 * were still being written. ref: AUDIT-011#drift-06
 *
 * Now the route admits the batch, writes one 'pending' scan_history row per
 * URL, returns those ids immediately, and hands the list here. Each URL runs
 * through the same `executeScan` the single-URL route dispatches, so bulk
 * scans get the real engine, the real watchdog, real progress reporting, and
 * the same finalize path instead of the second, separately-audited scan
 * implementation this route used to carry.
 *
 * Detached from the request lifecycle, which is safe for the same reason
 * `executeScan` itself is: VulnRadar runs as one persistent Node process, not
 * serverless functions, so work continues after the response is sent.
 */

import { executeScan, type ProtocolType } from "./execute-scan";
import { finalizeScanFailure } from "./scan-jobs";
import { APP_NAME } from "@/lib/config/constants";

/** One admitted URL: its reserved row plus everything executeScan needs. */
export interface BulkQueuedScan {
  scanId: number;
  /** The URL exactly as the caller submitted it (used in emails/webhooks). */
  url: string;
  normalizedUrl: string;
  protocolType: ProtocolType;
  isRawIpTarget: boolean;
  categoriesTotal: number;
}

export interface RunBulkBatchParams {
  scans: BulkQueuedScan[];
  authedUserId: number;
  /** BULK_SCAN_TIMEOUT_SECONDS: the whole batch's wall-clock budget. */
  timeoutSeconds: number;
}

/**
 * Run an admitted batch one URL at a time.
 *
 * Sequential on purpose, exactly as the inline version was: this process has
 * no job queue and every in-flight scan shares its resources, so a batch of
 * 100 must never become 100 concurrent scans. The account's concurrency cap
 * governs how many scans run at once, and one at a time is inside it for
 * every plan.
 *
 * Every row this is handed is already 'pending', so any row that does not get
 * to run has to be closed out explicitly or it sits at 'pending' forever,
 * holding a concurrency slot and showing as a stuck scan on the owner's
 * dashboard until the next process restart sweeps it. The `finally` below is
 * that guarantee: it covers the batch deadline, an unexpected throw, and a
 * caller that abandons the promise.
 */
export async function runBulkBatch({
  scans,
  authedUserId,
  timeoutSeconds,
}: RunBulkBatchParams): Promise<void> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  const unstarted = new Set(scans.map((s) => s.scanId));

  try {
    for (const scan of scans) {
      if (Date.now() >= deadline) break;
      unstarted.delete(scan.scanId);
      try {
        await executeScan({
          scanId: scan.scanId,
          url: scan.url,
          normalizedUrl: scan.normalizedUrl,
          protocolType: scan.protocolType,
          isRawIpTarget: scan.isRawIpTarget,
          selectedScanners: null,
          authedUserId,
          categoriesTotal: scan.categoriesTotal,
        });
      } catch (err) {
        // executeScan finalizes its own failures; reaching here means the
        // dispatch itself threw (e.g. settings resolution failed before the
        // watchdog was armed), which would otherwise leave this row 'pending'.
        const message =
          err instanceof Error ? err.message : "Scan failed to start.";
        console.error(`[${APP_NAME}] Bulk scan job failed:`, message);
        await finalizeScanFailure(scan.scanId, message).catch(() => {});
      }
    }
  } finally {
    if (unstarted.size > 0) {
      const timedOut = Date.now() >= deadline;
      const reason = timedOut
        ? `Bulk scan batch exceeded its ${timeoutSeconds}s time limit before this URL ran.`
        : "The bulk scan batch this URL belonged to stopped before it ran.";
      await Promise.all(
        [...unstarted].map((scanId) =>
          finalizeScanFailure(scanId, reason).catch(() => {}),
        ),
      );
    }
  }
}
