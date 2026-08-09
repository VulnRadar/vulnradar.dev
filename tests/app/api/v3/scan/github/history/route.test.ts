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

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
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
  mockQuery.mockReset();
});

describe("GET /api/v3/scan/github/history", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET(getRequest());
    expect(res.status).toBe(401);
  });

  it("returns one summary row per repo when no repo is given", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ plan: "free", role: "user" }] });
    mockQuery.mockResolvedValueOnce({
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

    const [sql] = mockQuery.mock.calls[1];
    expect(sql).toContain("scan_type = 'github'");
    expect(sql).toContain("PARTITION BY url");
  });

  it("returns the full timeline for a single repo", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ plan: "free", role: "user" }] });
    mockQuery.mockResolvedValueOnce({
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

    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain("scan_type = 'github'");
    expect(sql).toContain("url = $2");
    expect(params).toEqual([7, "octocat/hello-world", 30]);
  });

  it("skips the retention window for staff roles", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "free", role: "admin" }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await GET(getRequest("?repo=octocat/hello-world"));

    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).not.toContain("scanned_at >");
    expect(params).toEqual([7, "octocat/hello-world"]);
  });

  it("returns 500 on a database error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await GET(getRequest());
    expect(res.status).toBe(500);
  });
});
