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
import {
  FAILURE_KIND_LABELS,
  isEngineFailure,
  isFailureKind,
  type FailureKind,
} from "@/lib/scanner/failure-kinds";

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
 * One row behind the failure counts.
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
  /** scan_history.failure_kind; null for a row the backfill has not reached. */
  kind: string | null;
  source: string;
  /** Wall time from start to the failure being recorded. */
  durationMs: number;
  failedAt: string | null;
}

/** One scan that is pending or running right now. */
export interface InflightScan {
  id: number;
  userId: number;
  url: string;
  source: string;
  status: "pending" | "running";
  startedAt: string | null;
  currentCategory: string | null;
}

/**
 * The 24h counts. `failedLast24h` is the engine's own failures only; every
 * other way a scan ends without a result has its own number, because a user
 * pressing Cancel is not an incident and a real incident must not hide among
 * the cancels.
 */
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

export interface QueueStatusResponse {
  counts: QueueCounts;
  oldestPendingAgeMs: number | null;
  oldestRunningAgeMs: number | null;
  recentWindowHours: number;
  generatedAt: string;
  /** Only present on a `?failures=1` request. */
  failures?: FailedScan[];
  /** True when the list hit the query's LIMIT, so there are more. */
  failuresTruncated?: boolean;
  /** Only present on a `?inflight=1` request. */
  inflight?: InflightScan[];
  inflightTruncated?: boolean;
}

/** Failures that ended in the 24h window without being the engine's fault. */
export function otherEndedCount(counts: QueueCounts): number {
  return (
    counts.cancelledLast24h +
    counts.refusedLast24h +
    counts.notRunLast24h +
    counts.targetFailedLast24h
  );
}

/** Every scan in the window that ended without a result, whatever the reason. */
export function endedWithoutResultCount(counts: QueueCounts): number {
  return counts.failedLast24h + otherEndedCount(counts);
}

/**
 * "12 cancelled, 3 refused by a limit, 40 never ran" for the non-zero parts of
 * the other counts, or null when there are none. Said in words, in one line,
 * rather than as four more tiles: they are context for the Failed number, and
 * a row of four zeros is the wrong amount of attention for a good day.
 */
export function describeOtherEndings(counts: QueueCounts): string | null {
  const parts: string[] = [];
  if (counts.cancelledLast24h > 0) {
    parts.push(`${counts.cancelledLast24h} cancelled`);
  }
  if (counts.refusedLast24h > 0) {
    parts.push(`${counts.refusedLast24h} refused by a limit`);
  }
  if (counts.notRunLast24h > 0) {
    parts.push(`${counts.notRunLast24h} never ran`);
  }
  if (counts.targetFailedLast24h > 0) {
    parts.push(`${counts.targetFailedLast24h} stopped by the target`);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

export interface FailureTextGroup {
  error: string;
  count: number;
  scans: FailedScan[];
}

export interface FailureKindGroup {
  /** The recorded kind, or null for a row with none. */
  kind: FailureKind | null;
  label: string;
  /** Whether this kind counts toward the Failed number (the engine's own). */
  engine: boolean;
  count: number;
  byText: FailureTextGroup[];
}

/**
 * Group failures by why they happened, then by what the error said, so an
 * operator sees the SHAPE of an incident instead of counting rows.
 *
 * The first question is never "which 25 scans", it is "did the scanner break,
 * or did people cancel": that is the kind. The second is "is this one problem
 * 25 times, or 25 problems": that is the error text. Twenty-five identical
 * timeouts and twenty-five different errors are the same tile and completely
 * different incidents.
 *
 * The engine's own kinds come first, then the rest by size. Within a kind the
 * dominant text is first; ties keep the most recent first, because the query
 * already arrives newest-first and a stable sort preserves it.
 */
export function groupFailures(failures: FailedScan[]): FailureKindGroup[] {
  const byKind = new Map<string, FailedScan[]>();
  for (const scan of failures) {
    const key = isFailureKind(scan.kind) ? scan.kind : "";
    const bucket = byKind.get(key);
    if (bucket) bucket.push(scan);
    else byKind.set(key, [scan]);
  }

  return [...byKind.entries()]
    .map(([key, scans]): FailureKindGroup => {
      const kind = key === "" ? null : (key as FailureKind);
      return {
        kind,
        label: kind ? FAILURE_KIND_LABELS[kind] : "Reason not recorded",
        engine: isEngineFailure(kind),
        count: scans.length,
        byText: groupByText(scans),
      };
    })
    .sort((a, b) => Number(b.engine) - Number(a.engine) || b.count - a.count);
}

function groupByText(scans: FailedScan[]): FailureTextGroup[] {
  const byError = new Map<string, FailedScan[]>();
  for (const scan of scans) {
    const key = (scan.error ?? "").trim() || "No error message recorded";
    const bucket = byError.get(key);
    if (bucket) bucket.push(scan);
    else byError.set(key, [scan]);
  }
  return [...byError.entries()]
    .map(([error, group]) => ({ error, count: group.length, scans: group }))
    .sort((a, b) => b.count - a.count);
}

/** Kinds whose recorded duration is time spent waiting, not time spent scanning. */
const NEVER_RAN: ReadonlySet<string> = new Set(["quota_refused", "not_run"]);

/**
 * "ran 4.2s", or null where the number would mislead.
 *
 * Read from the duration the failure write records (now minus started_at). The
 * panel used to subtract started_at from scanned_at, which were never apart
 * for a failed row, so every failure said "ran 0.0s". A scan that was refused
 * or never reached did not run at all, and its duration is queue time.
 */
export function ranForLabel(scan: FailedScan): string | null {
  if (scan.kind && NEVER_RAN.has(scan.kind)) return null;
  if (!Number.isFinite(scan.durationMs) || scan.durationMs < 0) return null;
  return `ran ${(scan.durationMs / 1000).toFixed(1)}s`;
}

/** Where the queue links an operator to look at one user. */
export function adminUserHref(userId: number): string {
  return `/admin?tab=users&user=${userId}`;
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
  data: {
    // Only the two live counts decide this; the 24h ones may be present.
    counts: Pick<QueueCounts, "pending" | "running"> & Partial<QueueCounts>;
    oldestPendingAgeMs: number | null;
    oldestRunningAgeMs: number | null;
  } | null,
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
