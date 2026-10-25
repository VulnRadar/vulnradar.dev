/**
 * Route-level tests for GET /api/v3/dashboard.
 *
 * Mocks the database pool and session; the route's own auth-gating,
 * disabled-account check, and per-user query scoping run for real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { publicScanErrorMessage } from "@/lib/api/scan-error-message";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

// The route reads the Recent Scans / Top Vulnerabilities row cap from the
// settings resolver, which otherwise pulls in the real DB pool. Mock the
// resolver directly (key-aware, matching its real default from
// lib/config/config-values.ts) rather than the whole pool.
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: vi.fn(async (key: string) =>
    key === "DASHBOARD_WIDGET_LIMIT" ? 5 : undefined,
  ),
}));

const { GET } = await import("@/app/api/v3/dashboard/route");

function installDefaultQueryMock() {
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT disabled_at FROM users")) {
      return { rows: [{ disabled_at: null }] };
    }
    // One query now answers total scans, unique sites and the source split:
    // three whole-table aggregates over the same rows used to take three of
    // the pool's ten connections on their own.
    if (sql.includes("WITH base AS")) {
      return {
        rows: [
          {
            total_scans: 12,
            unique_sites: 3,
            source_breakdown: [
              { source: "web", count: 8 },
              { source: "api", count: 4 },
            ],
          },
        ],
      };
    }
    if (sql.includes("ORDER BY scanned_at DESC LIMIT $2")) {
      return {
        rows: [
          {
            id: 1,
            url: "https://a.com",
            summary: {},
            findings_count: 2,
            duration: 500,
            scanned_at: "2024-01-01",
            source: "web",
          },
        ],
      };
    }
    if (sql.includes("COALESCE(SUM((summary->>'critical')")) {
      return { rows: [{ critical: 1, high: 2, medium: 3, low: 4, info: 5 }] };
    }
    if (sql.includes("jsonb_array_elements(findings)")) {
      return { rows: [{ title: "Missing CSP", severity: "medium", count: 4 }] };
    }
    if (sql.includes("generate_series")) {
      return {
        rows: [
          { day: "2024-01-01", scans: 2, issues: 7 },
          { day: "2024-01-02", scans: 0, issues: 0 },
        ],
      };
    }
    return { rows: [] };
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  installDefaultQueryMock();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
});

describe("GET /api/v3/dashboard", () => {
  it("returns 401 before running any query when unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 403 for a disabled account without running the dashboard queries", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT disabled_at FROM users")) {
        return { rows: [{ disabled_at: "2024-01-01T00:00:00Z" }] };
      }
      throw new Error(
        "dashboard queries should not run for a disabled account",
      );
    });

    const res = await GET();

    expect(res.status).toBe(403);
  });

  it("scopes every query, including the disabled-account check, to the session's own userId", async () => {
    await GET();

    // disabled_at check + 5 dashboard queries run inside Promise.all. It was
    // 7 before the three whole-table aggregates were folded into one.
    expect(mockQuery.mock.calls.length).toBe(6);
    for (const [, params] of mockQuery.mock.calls) {
      // Every query is scoped by the session's userId as the first param;
      // the Recent Scans and Top Vulnerabilities queries also pass the
      // configurable row limit as a second param.
      expect(params[0]).toBe(42);
    }
  });

  it("returns the aggregated dashboard payload", async () => {
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.totalScans).toBe(12);
    expect(json.recentScans).toHaveLength(1);
    expect(json.severityBreakdown).toEqual({
      critical: 1,
      high: 2,
      medium: 3,
      low: 4,
      info: 5,
    });
    expect(json.topVulnerabilities).toEqual([
      { title: "Missing CSP", severity: "medium", count: 4 },
    ]);
    // issues comes from the query now. It used to be hardcoded to 0, so the
    // activity tooltip read "N scans - 0 issues" for every day on the main
    // dashboard no matter what the scans actually found.
    expect(json.dailyActivity).toEqual([
      { day: "2024-01-01", scans: 2, issues: 7 },
      { day: "2024-01-02", scans: 0, issues: 0 },
    ]);
    expect(json.sourceBreakdown).toEqual([
      { source: "web", count: 8 },
      { source: "api", count: 4 },
    ]);
    expect(json.uniqueSites).toBe(3);
  });

  it("picks each target's latest COMPLETED scan for both posture widgets", async () => {
    // A scan row exists as 'pending' with summary '{}' from the moment it is
    // queued, and a failed or cancelled one keeps those defaults. The two
    // DISTINCT ON CTEs used to pick the newest row of any status, so a rescan
    // in flight (or one that died) replaced the last real result with zeros.
    // The SQL itself is run against PostgreSQL in
    // tests/integration/list-reads.test.ts; this pins that both CTEs carry the
    // filter and that the no-op NOT NULL predicates it replaced are gone.
    await GET();

    const posture = mockQuery.mock.calls
      .map(([sql]) => String(sql))
      .filter((sql) => sql.includes("latest_per_target"));
    expect(posture).toHaveLength(2);
    for (const sql of posture) {
      expect(sql).toContain("status = 'completed'");
      expect(sql).toContain("DISTINCT ON (url)");
      expect(sql).not.toContain("IS NOT NULL");
    }
  });

  it("sanitizes the error_message of a recent scan and projects the incomplete flag", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT disabled_at FROM users")) {
        return { rows: [{ disabled_at: null }] };
      }
      if (sql.includes("ORDER BY scanned_at DESC LIMIT $2")) {
        // The projection is part of the SELECT that returned these rows.
        expect(sql).toContain("AS incomplete");
        expect(sql).toContain("result_meta -> 'incomplete'");
        return {
          rows: [
            {
              id: "a",
              url: "https://a.com",
              status: "failed",
              error_message: "connect ECONNREFUSED 10.0.0.5:5432",
              incomplete: false,
            },
            {
              id: "b",
              url: "https://b.com",
              status: "completed",
              findings_count: 0,
              incomplete: true,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const json = await (await GET()).json();

    expect(json.recentScans[0].error_message).toBe(
      publicScanErrorMessage("connect ECONNREFUSED 10.0.0.5:5432"),
    );
    expect(JSON.stringify(json)).not.toContain("10.0.0.5");
    // A completed scan has no error_message, and gains none.
    expect("error_message" in json.recentScans[1]).toBe(false);
    expect(json.recentScans[1].incomplete).toBe(true);
  });

  it("falls back to 0 for totalScans and uniqueSites when the queries return no rows", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT disabled_at FROM users")) {
        return { rows: [{ disabled_at: null }] };
      }
      return { rows: [] };
    });

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.totalScans).toBe(0);
    expect(json.uniqueSites).toBe(0);
  });

  it("returns 500 when a dashboard query throws", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT disabled_at FROM users")) {
        return { rows: [{ disabled_at: null }] };
      }
      throw new Error("db unavailable");
    });

    const res = await GET();

    expect(res.status).toBe(500);
  });
});
