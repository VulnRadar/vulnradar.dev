import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Route-level tests for GET /api/v3/scan/github/history. Mocked at the
 * database boundary: this route's job is to prove the scan_type = 'github'
 * scoping and the two response shapes (grouped-by-repo vs single-repo
 * timeline), not to exercise real SQL.
 */

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

// This route now also resolves the caller's plan retention setting live via
// lib/config/runtime-config's getSettings(), which issues its own
// pool.query("SELECT key, value FROM system_settings") ahead of the
// business queries below. That call is intercepted here (returning empty
// rows -> shipped defaults, same numbers BILLING_HISTORY_RETENTION used to
// hardcode) so it doesn't consume a slot from mockBusinessQuery's
// mockResolvedValueOnce() queue and shift every other test's indices.
const mockBusinessQuery = vi.fn();
const mockQuery = vi.fn(async (sql: string, params?: unknown[]) => {
  if (sql.trim().startsWith("SELECT key, value FROM system_settings")) {
    return { rows: [] };
  }
  return mockBusinessQuery(sql, params);
});
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (...args: unknown[]) => mockQuery(...(args as [string, unknown[]?])),
  },
}));

const { GET } = await import("@/app/api/v3/scan/github/history/route");

function getRequest(search = "") {
  return new NextRequest(
    `http://localhost/api/v3/scan/github/history${search}`,
  );
}

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 7 });
  mockQuery.mockClear();
  mockBusinessQuery.mockReset();
});

describe("GET /api/v3/scan/github/history", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET(getRequest());
    expect(res.status).toBe(401);
  });

  it("returns one summary row per repo when no repo is given", async () => {
    mockBusinessQuery.mockResolvedValueOnce({
      rows: [{ plan: "free", role: "user" }],
    });
    mockBusinessQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 5,
          url: "octocat/hello-world",
          summary: { total: 2 },
          findings_count: 2,
          duration: 1200,
          scanned_at: "2026-01-02T00:00:00.000Z",
          scan_count: "3",
        },
      ],
    });

    const res = await GET(getRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.summaries).toEqual([
      {
        repo: "octocat/hello-world",
        lastScan: {
          id: 5,
          summary: { total: 2 },
          findingsCount: 2,
          duration: 1200,
          scannedAt: "2026-01-02T00:00:00.000Z",
        },
        scanCount: 3,
      },
    ]);

    const [sql] = mockBusinessQuery.mock.calls[1];
    expect(sql).toContain("scan_type = 'github'");
    expect(sql).toContain("PARTITION BY url");
  });

  it("returns the full timeline for a single repo", async () => {
    mockBusinessQuery.mockResolvedValueOnce({
      rows: [{ plan: "free", role: "user" }],
    });
    mockBusinessQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 5,
          summary: { total: 2 },
          findings_count: 2,
          duration: 1200,
          scanned_at: "2026-01-02T00:00:00.000Z",
        },
      ],
    });

    const res = await GET(getRequest("?repo=octocat/hello-world"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.scans).toEqual([
      {
        id: 5,
        summary: { total: 2 },
        findingsCount: 2,
        duration: 1200,
        scannedAt: "2026-01-02T00:00:00.000Z",
      },
    ]);

    const [sql, params] = mockBusinessQuery.mock.calls[1];
    expect(sql).toContain("scan_type = 'github'");
    expect(sql).toContain("url = $2");
    expect(params).toEqual([7, "octocat/hello-world", 30]);
  });

  it("skips the retention window for staff roles", async () => {
    mockBusinessQuery.mockResolvedValueOnce({
      rows: [{ plan: "free", role: "admin" }],
    });
    mockBusinessQuery.mockResolvedValueOnce({ rows: [] });

    await GET(getRequest("?repo=octocat/hello-world"));

    const [sql, params] = mockBusinessQuery.mock.calls[1];
    expect(sql).not.toContain("scanned_at >");
    expect(params).toEqual([7, "octocat/hello-world"]);
  });

  it("returns 500 on a database error", async () => {
    mockBusinessQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await GET(getRequest());
    expect(res.status).toBe(500);
  });
});
