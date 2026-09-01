/**
 * Unit tests for the pure filter/sort helpers behind the history list.
 * They live in components/history/history-filter-utils.ts (plain .ts, no JSX)
 * specifically so they're importable here: tsconfig sets "jsx": "preserve" for
 * Next.js's own build pipeline, which vitest's esbuild-based transform can't
 * parse, so a .tsx file with real JSX in it can't be imported from a test at
 * all. Same split as tests/components/host/danger-score-trend.test.ts.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_HISTORY_QUERY,
  activeFilterCount,
  filterHistory,
  severityRank,
  type HistoryQuery,
} from "@/components/history/history-filter-utils";
import type { ScanRecord } from "@/components/history/history-types";

const NOW = Date.parse("2026-08-31T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW - days * 86_400_000).toISOString();
}

function scan(overrides: Partial<ScanRecord> = {}): ScanRecord {
  return {
    id: "abc",
    url: "https://example.com/",
    summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 },
    findings_count: 0,
    duration: 100,
    scanned_at: daysAgo(1),
    ...overrides,
  };
}

function query(overrides: Partial<HistoryQuery> = {}): HistoryQuery {
  return { ...DEFAULT_HISTORY_QUERY, ...overrides };
}

describe("severityRank", () => {
  it("ranks one critical above any number of lower findings", () => {
    const oneCritical = scan({ summary: { critical: 1 } });
    const manyHighs = scan({ summary: { high: 900, medium: 900, low: 900 } });
    expect(severityRank(oneCritical)).toBeGreaterThan(severityRank(manyHighs));
  });

  it("caps each band so a flood of info cannot reach the band above", () => {
    const flood = scan({ summary: { info: 10_000 } });
    const oneLow = scan({ summary: { low: 1 } });
    expect(severityRank(oneLow)).toBeGreaterThan(severityRank(flood));
  });

  it("treats a missing summary as no findings", () => {
    expect(severityRank(scan({ summary: {} }))).toBe(0);
  });
});

describe("filterHistory", () => {
  it("matches the URL search case-insensitively", () => {
    const rows = [
      scan({ id: "a", url: "https://Example.com/login" }),
      scan({ id: "b", url: "https://other.test/" }),
    ];
    expect(
      filterHistory(rows, query({ search: "EXAMPLE" }), NOW).map((s) => s.id),
    ).toEqual(["a"]);
  });

  it("filters by tag", () => {
    const rows = [
      scan({ id: "a", tags: [{ tag: "prod", source: "user" }] }),
      scan({ id: "b", tags: [{ tag: "staging", source: "user" }] }),
      scan({ id: "c" }),
    ];
    expect(
      filterHistory(rows, query({ tag: "prod" }), NOW).map((s) => s.id),
    ).toEqual(["a"]);
  });

  it("filters to scans with a critical", () => {
    const rows = [
      scan({ id: "a", summary: { critical: 2, high: 1 } }),
      scan({ id: "b", summary: { high: 4 } }),
    ];
    expect(
      filterHistory(rows, query({ severity: "critical" }), NOW).map(
        (s) => s.id,
      ),
    ).toEqual(["a"]);
  });

  it("high-and-above includes criticals", () => {
    const rows = [
      scan({ id: "a", summary: { critical: 1 } }),
      scan({ id: "b", summary: { high: 1 } }),
      scan({ id: "c", summary: { medium: 9 } }),
    ];
    expect(
      filterHistory(rows, query({ severity: "high" }), NOW).map((s) => s.id),
    ).toEqual(["a", "b"]);
  });

  it("counts a scan with only info findings as clean", () => {
    const rows = [
      scan({ id: "a", summary: { info: 12 } }),
      scan({ id: "b", summary: { low: 1 } }),
    ];
    expect(
      filterHistory(rows, query({ severity: "clean" }), NOW).map((s) => s.id),
    ).toEqual(["a"]);
  });

  it("applies the date window", () => {
    const rows = [
      scan({ id: "recent", scanned_at: daysAgo(2) }),
      scan({ id: "old", scanned_at: daysAgo(20) }),
    ];
    expect(
      filterHistory(rows, query({ date: "7d" }), NOW).map((s) => s.id),
    ).toEqual(["recent"]);
    expect(
      filterHistory(rows, query({ date: "30d" }), NOW)
        .map((s) => s.id)
        .sort(),
    ).toEqual(["old", "recent"]);
  });

  it("keeps a row whose timestamp cannot be parsed rather than hiding it", () => {
    const rows = [scan({ id: "broken", scanned_at: "not-a-date" })];
    expect(
      filterHistory(rows, query({ date: "7d" }), NOW).map((s) => s.id),
    ).toEqual(["broken"]);
  });

  it("sorts newest first by default and oldest first on request", () => {
    const rows = [
      scan({ id: "mid", scanned_at: daysAgo(5) }),
      scan({ id: "new", scanned_at: daysAgo(1) }),
      scan({ id: "old", scanned_at: daysAgo(9) }),
    ];
    expect(filterHistory(rows, query(), NOW).map((s) => s.id)).toEqual([
      "new",
      "mid",
      "old",
    ]);
    expect(
      filterHistory(rows, query({ sort: "oldest" }), NOW).map((s) => s.id),
    ).toEqual(["old", "mid", "new"]);
  });

  it("sorts by worst severity, then by most findings, then by host", () => {
    const rows = [
      scan({
        id: "low",
        url: "https://z.test/",
        summary: { low: 30 },
        findings_count: 30,
      }),
      scan({
        id: "crit",
        url: "https://a.test/",
        summary: { critical: 1 },
        findings_count: 1,
      }),
    ];
    expect(
      filterHistory(rows, query({ sort: "severity" }), NOW).map((s) => s.id),
    ).toEqual(["crit", "low"]);
    expect(
      filterHistory(rows, query({ sort: "findings" }), NOW).map((s) => s.id),
    ).toEqual(["low", "crit"]);
    expect(
      filterHistory(rows, query({ sort: "host" }), NOW).map((s) => s.id),
    ).toEqual(["crit", "low"]);
  });

  it("does not mutate the array it was given", () => {
    const rows = [
      scan({ id: "old", scanned_at: daysAgo(9) }),
      scan({ id: "new", scanned_at: daysAgo(1) }),
    ];
    filterHistory(rows, query({ sort: "newest" }), NOW);
    expect(rows.map((s) => s.id)).toEqual(["old", "new"]);
  });
});

describe("activeFilterCount", () => {
  it("is zero for the default query and counts each non-default filter", () => {
    expect(activeFilterCount(query())).toBe(0);
    // Sort is not a filter: reordering a list does not hide anything, so it
    // must not make the "nothing matches that filter" empty state appear.
    expect(activeFilterCount(query({ sort: "severity" }))).toBe(0);
    expect(
      activeFilterCount(
        query({ search: "a", tag: "prod", severity: "high", date: "7d" }),
      ),
    ).toBe(4);
  });

  it("ignores a search that is only whitespace", () => {
    expect(activeFilterCount(query({ search: "   " }))).toBe(0);
  });
});
