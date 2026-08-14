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
}

/** "3m ago" -> "3m", "just now" stays as-is -- reads as a duration, not a timestamp. */
export function formatAge(ageMs: number | null): string | null {
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
