/**
 * Route-level tests for GET /api/v3/badge/scans.
 *
 * Authenticated endpoint that backs the "create a badge" UI. It must only
 * ever return the logged-in user's own scans.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: () => mockGetSession() };
});

const { GET } = await import("@/app/api/v3/badge/scans/route");

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
});

describe("GET /api/v3/badge/scans", () => {
  it("rejects an unauthenticated request with 401 before querying the database", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    const json = await res.json();
    const scans = json.scans;
    expect(json).toEqual({ error: "Unauthorized" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("scopes the query to the logged-in user's own scans", async () => {
    mockGetSession.mockResolvedValue({ userId: 42 });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await GET();

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("WHERE sh.user_id = $1");
    expect(params).toEqual([42]);
  });

  it("returns the user's scans with summary and findings parsed from JSON strings", async () => {
    mockGetSession.mockResolvedValue({ userId: 42 });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          url: "https://example.com",
          share_token: "tok",
          findings_count: 2,
          scanned_at: "2026-01-15T00:00:00.000Z",
          summary: JSON.stringify({ total: 2 }),
          findings: JSON.stringify([{ severity: "low", title: "x" }]),
        },
      ],
    });

    const res = await GET();

    expect(res.status).toBe(200);
    const json = await res.json();
    const scans = json.scans;
    expect(scans).toEqual([
      {
        id: 1,
        url: "https://example.com",
        share_token: "tok",
        findings_count: 2,
        scanned_at: "2026-01-15T00:00:00.000Z",
        summary: { total: 2 },
        findings: [{ severity: "low", title: "x" }],
      },
    ]);
  });

  it("handles rows where summary/findings are already objects and findings is null", async () => {
    mockGetSession.mockResolvedValue({ userId: 7 });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 2,
          url: "https://example.com",
          share_token: null,
          findings_count: 0,
          scanned_at: "2026-01-15T00:00:00.000Z",
          summary: { total: 0 },
          findings: null,
        },
      ],
    });

    const res = await GET();

    const json = await res.json();
    const scans = json.scans;
    expect(scans[0].summary).toEqual({ total: 0 });
    expect(scans[0].findings).toEqual([]);
  });

  it("returns an empty array when the user has no scans", async () => {
    mockGetSession.mockResolvedValue({ userId: 42 });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await GET();

    const json = await res.json();
    const scans = json.scans;
    expect(scans).toEqual([]);
  });

  it("includes the auto-updating site_badge_token when one is already issued for that URL", async () => {
    mockGetSession.mockResolvedValue({ userId: 42 });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          url: "https://example.com",
          share_token: null,
          site_badge_token: "a".repeat(64),
          site_badge_scope: "global",
          findings_count: 0,
          scanned_at: "2026-01-15T00:00:00.000Z",
          summary: { total: 0 },
          findings: [],
        },
      ],
    });

    const res = await GET();
    const json = await res.json();
    const scans = json.scans;
    expect(scans[0].site_badge_token).toBe("a".repeat(64));
    expect(scans[0].site_badge_scope).toBe("global");

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("LEFT JOIN host_badges");
    expect(sql).toContain("hb.scope AS site_badge_scope");
  });

  it("dedupes to one row per URL, keeping the newest scan", async () => {
    mockGetSession.mockResolvedValue({ userId: 42 });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await GET();

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("DISTINCT ON (sh.url)");
    expect(sql).toContain("ORDER BY sh.url, sh.scanned_at DESC");
  });
});
