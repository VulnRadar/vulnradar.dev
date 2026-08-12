/**
 * Route-level tests for GET /api/v3/dashboard.
 *
 * Mocks the database pool and session; the route's own auth-gating,
 * disabled-account check, and per-user query scoping run for real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

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
    if (sql.includes("COUNT(*)::int as count FROM scan_history")) {
      return { rows: [{ count: 12 }] };
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
          { day: "2024-01-01", scans: 2 },
          { day: "2024-01-02", scans: 0 },
        ],
      };
    }
    if (sql.includes("GROUP BY source")) {
      return {
        rows: [
          { source: "web", count: 8 },
          { source: "api", count: 4 },
        ],
      };
    }
    if (sql.includes("COUNT(DISTINCT url)")) {
      return { rows: [{ count: 3 }] };
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

    // disabled_at check + 7 dashboard queries run inside Promise.all.
    expect(mockQuery.mock.calls.length).toBe(8);
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
    expect(json.dailyActivity).toEqual([
      { day: "2024-01-01", scans: 2, issues: 0 },
      { day: "2024-01-02", scans: 0, issues: 0 },
    ]);
    expect(json.sourceBreakdown).toEqual([
      { source: "web", count: 8 },
      { source: "api", count: 4 },
    ]);
    expect(json.uniqueSites).toBe(3);
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
