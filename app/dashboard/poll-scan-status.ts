/**
 * The scan status poll loop, lifted out of app/dashboard/page.tsx.
 *
 * It lives in its own module for one reason: it is the piece of the
 * scanning flow with real logic in it (retry budget, per-request deadline,
 * abort handling, the adaptive interval below) and it had no tests at all,
 * because importing it meant importing the whole dashboard page and every
 * component under it. Nothing about its behaviour changed in the move.
 */

import { API, SCANNING } from "@/lib/config/constants";
import type { Vulnerability } from "@/lib/scanner/types";
import {
  normalizePartialFindings,
  type PartialFinding,
} from "@/lib/scanner/partial-findings";
import type { ScanAuthReport } from "@/lib/scanner/auth/types";
import type { CrawlInfo } from "@/components/scanner/crawl-pages-info";
import type { ScanTag } from "@/components/history";

/**
 * Scans run as background jobs (see app/api/v3/scan/route.ts and
 * app/api/v3/scan/crawl/route.ts): the POST that kicks one off only
 * returns { scanId, status: "running" }, never the final result. The
 * real result has to be polled for from /api/v3/scan/status/[id] until
 * it reaches a terminal state. Shares its interval with the server's
 * admin-configurable CONFIG_SCAN_STATUS_POLL_INTERVAL_MS
 * (lib/config/config-values.ts) instead of a separate literal.
 */
export const SCAN_POLL_INTERVAL_MS = SCANNING.STATUS_POLL_INTERVAL_MS;
export interface ScanStatusResult {
  url: string;
  findings?: Vulnerability[];
  crawl?: CrawlInfo;
  authReport?: ScanAuthReport;
  scanHistoryId?: number;
  /** Opaque id for the ?scan= URL, distinct from the numeric scanHistoryId. */
  scanPublicId?: string | null;
  tags?: ScanTag[];
  [key: string]: unknown;
}

export interface ScanStatusResponse {
  status: "pending" | "running" | "completed" | "failed";
  error?: string;
  result?: ScanStatusResult;
  currentCategory?: string | null;
  categoriesCompleted?: number;
  categoriesTotal?: number;
  /** Only on a pending/running response. See PartialFinding. */
  partialFindings?: unknown;
}

/** The real, server-measured progress of a running scan (see scan-jobs.ts). */
export interface ScanProgressState {
  currentCategory: string | null;
  categoriesCompleted: number;
  categoriesTotal: number;
  /**
   * What the scan has found so far. The scan engine has reported this per
   * completed category since progress tracking landed, the status route has
   * returned it, and the OpenAPI spec documented it -- this poll loop simply
   * never declared the field, so through a three-minute crawl the only thing
   * on screen was a counter. Empty array, never undefined, so a consumer can
   * render it without a guard.
   */
  partialFindings: PartialFinding[];
}

/**
 * A single failed status check (a dropped request, a brief 5xx, a proxy
 * hiccup) does not mean the scan itself failed -- it's an independent
 * background job that keeps running server-side regardless of whether this
 * particular poll landed. Only give up after several consecutive misses,
 * so a one-off network blip doesn't show "scan failed" for a scan that
 * finishes moments later in the background.
 */
// Raised from 3. At a 2s interval three strikes meant roughly six seconds of
// flaky connectivity was enough to abandon a scan that was running perfectly
// well server-side. Six gives about 12 to 20 seconds of tolerance, which
// covers a phone handing off between cells or a hotel wifi stall.
const MAX_CONSECUTIVE_POLL_FAILURES = 6;

/** Message used for both give-up paths. The scan is a background job, so it
 *  survives the client losing track of it, and saying so is the difference
 *  between "your scan is gone" and "look in History in a minute". */
const POLL_GAVE_UP_MESSAGE =
  "Lost the connection to this scan. It is still running, and the result will be in your history in a few minutes.";

/** How long after a scan starts the status poll runs at FAST_POLL_INTERVAL_MS
 *  before dropping back to the configured interval. Covers the case where the
 *  result is effectively immediate (a cached scan, a host that fails DNS). */
const FAST_POLL_WINDOW_MS = 2500;
/** Used during that window and again once the server reports the final check
 *  family is running, so a finished scan is picked up within a fraction of a
 *  second rather than up to a whole poll interval later. */
const FAST_POLL_INTERVAL_MS = 500;

export class PollAbortedError extends Error {}

/**
 * How long to wait before the next status check.
 *
 * This used to be a flat `pollIntervalMs` for every iteration, so a scan
 * that finished a tenth of a second after a status check sat
 * finished-but-unshown for the rest of the interval: up to two seconds of
 * the user watching a progress bar for a scan that was already done. Two
 * windows get a tighter interval instead of raising the rate for the whole
 * scan (which would multiply authenticated requests against the very
 * process that is running it):
 *   - the first couple of seconds, which is where a result that was already
 *     cached, or a host that fails DNS outright, lands;
 *   - once the server says it is on its last check family, which is the
 *     window the real result lands in.
 *
 * Never slower than the caller's interval, and never faster than it either:
 * a deployment that deliberately configures a long poll interval is not
 * overridden by the fast path.
 */
export function nextPollDelayMs(
  elapsedMs: number,
  nearlyDone: boolean,
  pollIntervalMs: number,
): number {
  if (elapsedMs < FAST_POLL_WINDOW_MS || nearlyDone) {
    return Math.min(FAST_POLL_INTERVAL_MS, pollIntervalMs);
  }
  return pollIntervalMs;
}

export async function pollScanStatus(
  scanId: number,
  maxWaitMs: number,
  onProgress?: (progress: ScanProgressState) => void,
  // Caller (a component) resolves the live, admin-configurable value via
  // useClientConfig() and passes it in -- this module-level function can't
  // call a hook itself. Defaults to the compiled constant so any other
  // caller keeps today's behavior.
  pollIntervalMs: number = SCAN_POLL_INTERVAL_MS,
  // Aborted when the user cancels or navigates away from the dashboard.
  // Without it the loop kept polling every 2s for up to 16 minutes after the
  // component that could use the result was gone: up to 480 authenticated
  // requests to the same process that is running the scan.
  signal?: AbortSignal,
): Promise<ScanStatusResponse> {
  const startedAt = Date.now();
  let consecutiveFailures = 0;
  /** Set once the server reports it is running its final check family. */
  let nearlyDone = false;
  while (Date.now() - startedAt < maxWaitMs) {
    if (signal?.aborted) throw new PollAbortedError("aborted");
    try {
      // A per-request deadline. The max-wait ceiling is only evaluated
      // between iterations, so one request that stalled without ever
      // erroring hung the loop indefinitely: the bar froze at the last
      // reported family while the elapsed clock kept climbing, and the
      // three-strike budget never fired because a hanging request never
      // throws. An aborted fetch does throw, so it feeds the existing
      // failure path with no other change.
      //
      // Built from a plain AbortController rather than AbortSignal.any /
      // AbortSignal.timeout, which are recent enough that a browser one or
      // two versions behind would throw here and break scanning outright.
      const requestAbort = new AbortController();
      const deadline = setTimeout(
        () => requestAbort.abort(),
        pollIntervalMs * 4,
      );
      const forwardAbort = () => requestAbort.abort();
      signal?.addEventListener("abort", forwardAbort, { once: true });
      let res: Response;
      try {
        res = await fetch(API.SCAN_STATUS(scanId), {
          signal: requestAbort.signal,
        });
      } finally {
        clearTimeout(deadline);
        signal?.removeEventListener("abort", forwardAbort);
      }
      if (!res.ok) throw new Error(`Status check failed (${res.status})`);
      const data: ScanStatusResponse = await res.json();
      consecutiveFailures = 0;
      onProgress?.({
        currentCategory: data.currentCategory ?? null,
        categoriesCompleted: data.categoriesCompleted ?? 0,
        categoriesTotal: data.categoriesTotal ?? 0,
        partialFindings: normalizePartialFindings(data.partialFindings),
      });
      if (data.status === "completed" || data.status === "failed") {
        return data;
      }
      const total = data.categoriesTotal ?? 0;
      nearlyDone = total > 0 && (data.categoriesCompleted ?? 0) >= total - 1;
    } catch {
      if (signal?.aborted) throw new PollAbortedError("aborted");
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        throw new Error(POLL_GAVE_UP_MESSAGE);
      }
    }
    const delay = nextPollDelayMs(
      Date.now() - startedAt,
      nearlyDone,
      pollIntervalMs,
    );
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error(
    "This scan is taking longer than expected. Check your history in a few minutes, it may still finish.",
  );
}
