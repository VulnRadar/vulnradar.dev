// QUEUE STATUS UI UTILITIES
//
// Pure, DOM-free logic for queue-status-manager.tsx, split out the same
// way settings-registry-utils.ts is: this project's Vitest runs in a
// plain node environment with no jsdom/React-Testing-Library set up, and
// esbuild can't strip JSX out of a .tsx file under this repo's
// "jsx": "preserve" tsconfig, so a .tsx file can't be imported directly
// from a test. Real decision logic lives here instead, in a plain .ts
// file, so it's actually exercised by a test rather than left untested.

import { formatRelativeTime } from "@/components/admin/utils";
import { CONFIG_BULK_SCAN_TIMEOUT_SECONDS } from "@/lib/config/config-values";

// A healthy queue starts a 'pending' scan within seconds (see
// app/api/v3/scan/route.ts: the background job kicks off immediately
// after the INSERT). A pending row older than this is a real signal the
// scanner is backed up, not scan variance.
export const STALE_PENDING_MS = 60_000;

// No legitimate scan runs longer than the longest configured scan
// timeout (bulk scans, the longest of the three -- see
// CONFIG_SCAN_TIMEOUT_SECONDS / CONFIG_CRAWL_SCAN_TIMEOUT_SECONDS /
// CONFIG_BULK_SCAN_TIMEOUT_SECONDS in lib/config/config-values.ts). A
// 'running' row older than that is stuck, not just slow.
export const STALE_RUNNING_MS = CONFIG_BULK_SCAN_TIMEOUT_SECONDS * 1000;

/**
 * One row behind the "Failed (24h)" count.
 *
 * `error` is the RAW `scan_history.error_message`, not the sanitized string
 * lib/api/scan-error-message.ts produces for the person who ran the scan.
 * That is deliberate and is the point of this list - see the comment on the
 * query in app/api/v3/admin/queue-status/route.ts. It means the field can
 * hold driver text naming an internal host or table, so it belongs in this
 * panel and must not be rendered anywhere a non-operator can reach.
 */
export interface FailedScan {
  id: number;
  userId: number;
  url: string;
  error: string | null;
  source: string;
  durationMs: number;
  failedAt: string | null;
  /** Wall time between started_at and scanned_at, when both are present. */
  ranForMs: number | null;
}

export interface QueueStatusResponse {
  counts: {
    pending: number;
    running: number;
    completedLast24h: number;
    failedLast24h: number;
  };
  oldestPendingAgeMs: number | null;
  oldestRunningAgeMs: number | null;
  recentWindowHours: number;
  generatedAt: string;
  /** Only present on a `?failures=1` request. */
  failures?: FailedScan[];
  /** True when the list hit the query's LIMIT, so there are more. */
  failuresTruncated?: boolean;
}

/**
 * Group failures by their error text so an operator sees the SHAPE of an
 * incident instead of counting rows.
 *
 * Twenty-five separate "the target did not respond in time" lines and
 * twenty-five different errors are the same number and completely different
 * problems, and that is the first thing worth knowing when a queue starts
 * failing. Sorted by count so the dominant cause is first; ties keep the
 * most recent first, because the query already arrives newest-first and a
 * stable sort preserves it.
 */
export function groupFailures(
  failures: FailedScan[],
): { error: string; count: number; scans: FailedScan[] }[] {
  const byError = new Map<string, FailedScan[]>();
  for (const scan of failures) {
    const key = (scan.error ?? "").trim() || "No error message recorded";
    const bucket = byError.get(key);
    if (bucket) bucket.push(scan);
    else byError.set(key, [scan]);
  }
  return [...byError.entries()]
    .map(([error, scans]) => ({ error, count: scans.length, scans }))
    .sort((a, b) => b.count - a.count);
}

/**
 * "3m ago" -> "3m", "just now" stays as-is: reads as a duration, not a
 * timestamp. Named formatAgeMs, not formatAge, because
 * lib/ui/relative-time.ts already exports a formatAge that takes an ISO
 * STRING. Two same-named helpers with different argument types were both
 * live in components/, which is a mis-import waiting to happen.
 */
export function formatAgeMs(ageMs: number | null): string | null {
  if (ageMs === null) return null;
  return formatRelativeTime(new Date(Date.now() - ageMs)).replace(/ ago$/, "");
}

/**
 * Pure "is the scanner backed up" verdict: a pending row waiting past
 * STALE_PENDING_MS, or a running row past STALE_RUNNING_MS, either
 * counts. A zero count for a status never counts, regardless of its age
 * field (that field is only meaningful when there's actually a row it
 * came from).
 */
export function computeBackedUp(
  data: Pick<
    QueueStatusResponse,
    "counts" | "oldestPendingAgeMs" | "oldestRunningAgeMs"
  > | null,
): boolean {
  if (!data) return false;
  const pendingStale =
    data.counts.pending > 0 &&
    (data.oldestPendingAgeMs ?? 0) > STALE_PENDING_MS;
  const runningStale =
    data.counts.running > 0 &&
    (data.oldestRunningAgeMs ?? 0) > STALE_RUNNING_MS;
  return pendingStale || runningStale;
}
