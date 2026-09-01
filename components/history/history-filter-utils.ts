import type { ScanRecord } from "@/components/history/history-types";

/**
 * Filtering and ordering for the history list.
 *
 * Split out of history-filters.tsx as plain .ts so it is importable from a
 * test: tsconfig sets "jsx": "preserve" for Next's own pipeline, which
 * vitest's transform cannot parse, so a .tsx module with real JSX in it
 * cannot be imported from a test at all. Same split as
 * components/host/danger-score-trend-utils.ts.
 *
 * These run over the rows the page already loaded, which the API caps. That
 * cap is a real limitation and the page says so above the list; pushing all of
 * this into SQL is the proper fix and belongs with server-side search.
 */

export type HistorySeverityFilter = "any" | "critical" | "high" | "clean";
export type HistoryDateFilter = "any" | "7d" | "30d";
export type HistorySort =
  "newest" | "oldest" | "severity" | "findings" | "host";

export interface HistoryQuery {
  search: string;
  tag: string | null;
  severity: HistorySeverityFilter;
  date: HistoryDateFilter;
  sort: HistorySort;
}

export const DEFAULT_HISTORY_QUERY: HistoryQuery = {
  search: "",
  tag: null,
  severity: "any",
  date: "any",
  sort: "newest",
};

export const SEVERITY_FILTER_LABELS: Record<HistorySeverityFilter, string> = {
  any: "Any severity",
  critical: "Has a critical",
  high: "High and above",
  clean: "Clean",
};

export const DATE_FILTER_LABELS: Record<HistoryDateFilter, string> = {
  any: "Any time",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

export const SORT_LABELS: Record<HistorySort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  severity: "Worst severity",
  findings: "Most findings",
  host: "Host A to Z",
};

const DAY_MS = 86_400_000;

function counts(scan: ScanRecord) {
  const s = scan.summary ?? {};
  return {
    critical: s.critical ?? 0,
    high: s.high ?? 0,
    medium: s.medium ?? 0,
    low: s.low ?? 0,
    info: s.info ?? 0,
  };
}

/**
 * A single number that orders scans worst-first without ever letting a pile of
 * lows outrank one critical: each severity gets its own decimal band, capped
 * at 999 so a run with a thousand info findings cannot bleed into the band
 * above it.
 */
export function severityRank(scan: ScanRecord): number {
  const c = counts(scan);
  const cap = (n: number) => Math.min(n, 999);
  return (
    cap(c.critical) * 1e12 +
    cap(c.high) * 1e9 +
    cap(c.medium) * 1e6 +
    cap(c.low) * 1e3 +
    cap(c.info)
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function matchesSeverity(
  scan: ScanRecord,
  severity: HistorySeverityFilter,
): boolean {
  if (severity === "any") return true;
  const c = counts(scan);
  if (severity === "critical") return c.critical > 0;
  if (severity === "high") return c.critical > 0 || c.high > 0;
  // "Clean" means nothing actionable came back. Info findings are
  // observations, not problems, so a scan with only those still counts.
  return c.critical === 0 && c.high === 0 && c.medium === 0 && c.low === 0;
}

function matchesDate(
  scan: ScanRecord,
  date: HistoryDateFilter,
  now: number,
): boolean {
  if (date === "any") return true;
  const at = new Date(scan.scanned_at).getTime();
  // An unparseable timestamp is kept rather than silently dropped: hiding a
  // row because its date could not be read is the failure mode that makes a
  // user think a scan was deleted.
  if (Number.isNaN(at)) return true;
  const windowDays = date === "7d" ? 7 : 30;
  return now - at <= windowDays * DAY_MS;
}

export function filterHistory(
  scans: ScanRecord[],
  query: HistoryQuery,
  now: number = Date.now(),
): ScanRecord[] {
  const search = query.search.trim().toLowerCase();
  const filtered = scans.filter((scan) => {
    if (search && !scan.url.toLowerCase().includes(search)) return false;
    if (query.tag && !(scan.tags?.some((t) => t.tag === query.tag) ?? false)) {
      return false;
    }
    if (!matchesSeverity(scan, query.severity)) return false;
    if (!matchesDate(scan, query.date, now)) return false;
    return true;
  });

  // Copied before sorting: the array handed in is the page's own state and
  // sorting in place would mutate it.
  const sorted = [...filtered];
  switch (query.sort) {
    case "oldest":
      sorted.sort(
        (a, b) =>
          new Date(a.scanned_at).getTime() - new Date(b.scanned_at).getTime(),
      );
      break;
    case "severity":
      sorted.sort((a, b) => severityRank(b) - severityRank(a));
      break;
    case "findings":
      sorted.sort((a, b) => (b.findings_count ?? 0) - (a.findings_count ?? 0));
      break;
    case "host":
      sorted.sort((a, b) =>
        hostOf(a.url).localeCompare(hostOf(b.url), undefined, {
          sensitivity: "base",
        }),
      );
      break;
    default:
      sorted.sort(
        (a, b) =>
          new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime(),
      );
  }
  return sorted;
}

/** How many non-default filters are on, for the mobile trigger's badge. */
export function activeFilterCount(query: HistoryQuery): number {
  let n = 0;
  if (query.search.trim()) n++;
  if (query.tag) n++;
  if (query.severity !== "any") n++;
  if (query.date !== "any") n++;
  return n;
}
