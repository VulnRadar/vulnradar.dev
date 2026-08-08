/**
 * Route-level tests for GET /api/v3/data-request/download, which serves the
 * most recently prepared data export back to its owner.
 *
 * The database is mocked (network/DB boundary) and getSession is mocked
 * (auth boundary). This is a privacy-sensitive PII response, so the
 * Cache-Control/Pragma headers are asserted directly rather than trusted
 * from reading the source.
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

const { GET } = await import("@/app/api/v3/data-request/download/route");

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
});

describe("GET /api/v3/data-request/download", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("scopes the lookup to the caller's own user id, most recent first", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await GET();

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain(
      "WHERE user_id = $1 AND downloaded_at IS NOT NULL AND data IS NOT NULL",
    );
    expect(sql).toContain("ORDER BY downloaded_at DESC");
    expect(params).toEqual([42]);
  });

  it("returns 404 when no export exists for this user", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("No data export found.");
  });

  it("returns 404 when the row is found but data is falsy", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ data: null }] });
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("returns the export with private, no-store cache headers", async () => {
    const exported = {
      account: { email: "user@example.com" },
      scanHistory: [],
    };
    mockQuery.mockResolvedValueOnce({ rows: [{ data: exported }] });

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual(exported);
    expect(res.headers.get("Cache-Control")).toBe(
      "no-store, no-cache, must-revalidate, private",
    );
    expect(res.headers.get("Pragma")).toBe("no-cache");
  });
});
