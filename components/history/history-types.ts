"use client";

import type { ScanResult, Vulnerability } from "@/lib/scanner/types";

/**
 * One tag on a scan. `source` distinguishes a tag lib/tags/auto-tags.ts
 * derived from the scan's own findings ("auto") from one a user typed in
 * ("user") -- see app/api/v3/scan/tags/route.ts. Auto tags can't be
 * removed through that route, so the UI never shows a remove control on
 * one (see components/history/scan-tags.tsx).
 */
export interface ScanTag {
  tag: string;
  source: "auto" | "user";
}

/**
 * scan_history.status, as the list API projects it (see the CHECK constraint
 * in lib/database/schema/02-features.mjs). Optional because the read-only
 * surfaces that reuse ScanRecord (public scans, /host) select their own column
 * list; absent is treated as "completed" by scanRowState below, which is what
 * those surfaces only ever show.
 */
export type ScanRecordStatus = "pending" | "running" | "completed" | "failed";

export interface ScanRecord {
  // Opaque public_id (the list API aliases scan_history.public_id AS id), not
  // the sequential numeric primary key. Carried as-is into ?scan= links, the
  // detail fetch, and the tag body-param, all of which resolve it server-side.
  id: string;
  url: string;
  status?: ScanRecordStatus | string;
  summary: {
    critical?: number;
    high?: number;
    medium?: number;
    low?: number;
    info?: number;
    total?: number;
  };
  findings_count: number;
  duration: number;
  scanned_at: string;
  source?: string;
  tags?: ScanTag[];
}

export interface HistoryState {
  scans: ScanRecord[];
  loading: boolean;
  filter: string;
  tagFilter: string | null;
  allTags: string[];
  currentPage: number;
  pageSize: number;
}

export interface ScanDetailState {
  selectedScanId: string | null;
  scanDetail: ScanResult | null;
  detailLoading: boolean;
  selectedIssue: Vulnerability | null;
  scanOwnerId: number | null;
  scanNotes: string;
  editingNotes: boolean;
  savingNotes: boolean;
}

/**
 * What a history row is actually reporting.
 *
 * The row used to derive this from `findings_count === 0` alone, and a
 * scan_history row is inserted as 'pending' with summary '{}', findings_count
 * 0 and duration 0 BEFORE any work starts. So a scan that failed, or that the
 * user navigated away from, rendered with a green shield and the word "Clean":
 * "we found nothing" and "the scan died" were the same picture. The list API
 * has projected sh.status for exactly this reason (see the comment above the
 * SELECT in app/api/v3/history/route.ts); nothing on the client read it.
 *
 * "unfinished" mirrors ScanSummary's `VERDICT.partial` (components/scanner/
 * scan-summary.tsx): a result with nothing in it is not a result yet, and it
 * gets the warning hue rather than the success hue. A missing status is
 * "completed", which is what every pre-status row and every read-only surface
 * that reuses ScanRecord is.
 */
export type ScanRowState = "clean" | "findings" | "running" | "unfinished";

export function scanRowState(scan: {
  status?: string;
  findings_count: number;
}): ScanRowState {
  const status = scan.status ?? "completed";
  if (status === "failed") return "unfinished";
  if (status === "pending" || status === "running") return "running";
  return scan.findings_count === 0 ? "clean" : "findings";
}

// Canonical relative-time formatter (see lib/ui/relative-time.ts).
export { formatRelativeTime } from "@/lib/ui/relative-time";

export function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Whether a scan happened inside the last day, which is what the history row
 * uses to give a fresh scan full-strength type instead of the same muted
 * micro-text every other row gets.
 *
 * Lives here rather than inline in the row for the same reason
 * formatRelativeTime does: reading the clock is impure, and the React Compiler
 * lint (react-hooks/purity) refuses a bare Date.now() in a render body. Both
 * functions are equally "wrong" by that rule and equally fine in practice --
 * the value is re-derived on every render from a prop, and a row that crosses
 * the 24h line while the page is open simply keeps the weight it had until the
 * next render, which is exactly what the relative-time string beside it does.
 */
const DAY_MS = 86_400_000;

export function isRecentScan(scannedAt: string, now = Date.now()): boolean {
  const at = new Date(scannedAt).getTime();
  if (Number.isNaN(at)) return false;
  return now - at < DAY_MS;
}

export function displayUrl(url: string) {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname + u.search;
    return u.hostname + path;
  } catch {
    return url;
  }
}

export function getDomain(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * What a tag add/remove handler resolves to: `null` when the change was
 * persisted, the message to show when it was not.
 *
 * The plain `void` arm is deliberate. The read-only surfaces (/host,
 * /shared, the public-scans row) pass a no-op because `readOnly` already
 * hides every control that could call it, and they should not have to
 * invent a return value for a handler that never runs. `undefined` is
 * treated as success by ScanTags, same as `null`.
 */
export type TagMutationResult = void | Promise<string | null>;
