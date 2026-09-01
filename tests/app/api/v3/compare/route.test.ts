/**
 * Route-level tests for GET /api/v3/compare.
 *
 * Mocks the database pool and session; the route's own auth-gating,
 * ownership scoping, and diff computation run for real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const { GET } = await import("@/app/api/v3/compare/route");

function compareRequest(a?: string, b?: string): NextRequest {
  const params = new URLSearchParams();
  if (a !== undefined) params.set("a", a);
  if (b !== undefined) params.set("b", b);
  return new NextRequest(
    `http://localhost/api/v3/compare?${params.toString()}`,
  );
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
});

describe("GET /api/v3/compare", () => {
  it("requires authentication before touching the database", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await GET(compareRequest("1", "2"));

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("requires both scan IDs", async () => {
    const res = await GET(compareRequest("1"));

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("scopes the lookup query to the session's own user_id", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await GET(compareRequest("1", "2"));

    const [sql, params] = mockQuery.mock.calls[0];
    // Scoped to the caller. This is the assertion that matters: without it
    // the route would read another user's scans.
    expect(sql).toContain("user_id = $5");
    // Both id shapes resolve, because the history list hands the client
    // public_id while older bookmarks still carry the numeric id.
    expect(sql).toContain("public_id = $1");
    expect(sql).toContain("public_id = $2");
    expect(sql).toContain("id = $3");
    expect(sql).toContain("id = $4");
    // "1" and "2" are legacy numeric ids, so they resolve on both arms.
    expect(params).toEqual(["1", "2", 1, 2, 42]);
  });

  it("rejects comparing a scan owned by another user instead of silently allowing it", async () => {
    // The caller owns scan "1". Scan "99" belongs to a different user, so
    // the route's "AND user_id = $3" clause excludes it from the result
    // set entirely: the query comes back with only 1 row instead of 2.
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "1",
          public_id: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
          url: "https://example.com",
          summary: { critical: 0 },
          findings: [],
          findings_count: 0,
          duration: 100,
          scanned_at: "2024-01-01T00:00:00Z",
          source: "web",
        },
      ],
    });

    const res = await GET(compareRequest("1", "99"));

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("One or both scans not found");
  });

  it("looks scans up by public_id, the id shape the history list returns", async () => {
    // Regression: this route matched `id IN ($1,$2)` against the SERIAL
    // primary key, but app/api/v3/history/route.ts projects
    // `sh.public_id AS id`, so every id the compare page holds is a 32-char
    // hex. A public_id beginning with a digit was coerced to a different
    // scan of the caller's own by getQueryParamInt's parseInt; one beginning
    // with a letter became null.
    const publicA = "7a3f0000000000000000000000000001";
    const publicB = "7a3f0000000000000000000000000002";
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await GET(compareRequest(publicA, publicB));

    const [, params] = mockQuery.mock.calls[0];
    // Both resolve as public_ids; neither is a legacy numeric id, so the
    // numeric arms are null and cannot collide with an unrelated row.
    expect(params).toEqual([publicA, publicB, null, null, 42]);
  });

  it("returns 404 when neither scan ID belongs to the caller", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await GET(compareRequest("1", "2"));

    expect(res.status).toBe(404);
  });

  it("computes added/removed/unchanged findings between two owned scans, parsing findings stored as a JSON string", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "1",
          url: "https://example.com",
          summary: { critical: 1 },
          findings: JSON.stringify([
            { title: "Missing CSP", severity: "medium" },
            { title: "Weak SPF", severity: "low" },
          ]),
          findings_count: 2,
          scanned_at: "2024-01-01T00:00:00Z",
          source: "web",
        },
        {
          id: "2",
          url: "https://example.com",
          summary: { critical: 0 },
          // findings already deserialized (jsonb driver behavior) — the
          // route must handle both shapes.
          findings: [
            { title: "Weak SPF", severity: "low" },
            { title: "Expired TLS Certificate", severity: "critical" },
          ],
          findings_count: 2,
          scanned_at: "2024-01-02T00:00:00Z",
          source: "web",
        },
      ],
    });

    const res = await GET(compareRequest("1", "2"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.diff.added).toEqual([
      { title: "Expired TLS Certificate", severity: "critical" },
    ]);
    expect(json.diff.removed).toEqual([
      { title: "Missing CSP", severity: "medium" },
    ]);
    expect(json.diff.unchanged).toEqual([
      { title: "Weak SPF", severity: "low" },
    ]);
    expect(json.diff.summary).toEqual({ added: 1, removed: 1, unchanged: 1 });
    expect(json.scanA.id).toBe("1");
    expect(json.scanB.id).toBe("2");
    expect(json.scanA.findings).toBeUndefined();
    expect(json.scanB.findings).toBeUndefined();
  });
});
