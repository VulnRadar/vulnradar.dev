/**
 * Route-level tests for GET /api/v3/public-scans -- the unauthenticated,
 * paginated Public Scans directory. Lists only scans with a live share_token
 * whose own share_publicly_listed is true, same "not expired" condition
 * GET /api/v3/shared/[token] uses.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/rate-limiting/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  };
});

const { GET } = await import("@/app/api/v3/public-scans/route");

function getRequest(qs = ""): NextRequest {
  return new NextRequest(`http://localhost/api/v3/public-scans${qs}`);
}

beforeEach(() => {
  mockQuery.mockReset();
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 59,
    retryAfterSeconds: 0,
  });
});

describe("GET /api/v3/public-scans — rate limiting", () => {
  it("rejects a request once the per-IP limit is exceeded", async () => {
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 42,
    });

    const res = await GET(getRequest());

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("keys the rate limit by client IP", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await GET(getRequest());

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ key: "public-scans:127.0.0.1" }),
    );
  });
});

describe("GET /api/v3/public-scans", () => {
  it("filters on share_token, share_publicly_listed, and the not-expired condition", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await GET(getRequest());

    const [countSql] = mockQuery.mock.calls[0];
    expect(countSql).toContain("sh.share_token IS NOT NULL");
    expect(countSql).toContain("sh.share_publicly_listed = true");
    expect(countSql).toContain(
      "(sh.share_expires_at IS NULL OR sh.share_expires_at > NOW())",
    );

    const [rowsSql] = mockQuery.mock.calls[1];
    expect(rowsSql).toContain("JOIN users u ON sh.user_id = u.id");
    expect(rowsSql).toContain("ORDER BY sh.scanned_at DESC");
    expect(rowsSql).toContain("FROM scan_tags st WHERE st.scan_id = sh.id");
  });

  it("does not require authentication", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await GET(getRequest());

    expect(res.status).toBe(200);
  });

  it("returns an empty, well-formed page when there are no public scans", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await GET(getRequest());
    const json = await res.json();

    expect(json).toEqual({ scans: [], page: 1, totalPages: 1, total: 0 });
  });

  it("computes each row's verdict from its findings and reshapes fields for the directory", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "1" }] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          url: "https://example.com",
          scanned_at: "2026-01-15T00:00:00.000Z",
          share_token: "a".repeat(64),
          summary: { critical: 1 },
          findings: [
            { severity: "critical", title: "SQL Injection", cwe: "CWE-89" },
          ],
          findings_count: 1,
          scanned_by: "Alice",
          scanned_by_avatar: "https://example.com/a.png",
          scanned_by_role: "admin",
          tags: [{ tag: "SQL Injection Risk", source: "auto" }],
        },
      ],
    });

    const res = await GET(getRequest());
    const json = await res.json();

    expect(json.scans).toEqual([
      {
        token: "a".repeat(64),
        url: "https://example.com",
        scannedAt: "2026-01-15T00:00:00.000Z",
        verdict: "unsafe",
        summary: { critical: 1 },
        findingsCount: 1,
        scannedBy: "Alice",
        scannedByAvatar: "https://example.com/a.png",
        scannedByRole: "admin",
        tags: [{ tag: "SQL Injection Risk", source: "auto" }],
      },
    ]);
  });

  it("falls back to defaults for missing optional fields", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "1" }] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          url: "https://example.net",
          scanned_at: "2026-02-01T00:00:00.000Z",
          share_token: "b".repeat(64),
          summary: null,
          findings: null,
          findings_count: 0,
          scanned_by: null,
          scanned_by_avatar: null,
          scanned_by_role: null,
          tags: null,
        },
      ],
    });

    const res = await GET(getRequest());
    const json = await res.json();

    expect(json.scans[0].verdict).toBe("safe");
    expect(json.scans[0].summary).toEqual({});
    expect(json.scans[0].scannedBy).toBe("Anonymous");
    expect(json.scans[0].scannedByRole).toBe("user");
    expect(json.scans[0].tags).toEqual([]);
  });

  it("paginates using page/limit query params and computes totalPages", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "45" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await GET(getRequest("?page=2&limit=10"));
    const json = await res.json();

    expect(json.page).toBe(2);
    expect(json.totalPages).toBe(5);
    expect(json.total).toBe(45);

    const [, rowsParams] = mockQuery.mock.calls[1];
    expect(rowsParams).toEqual([10, 10]); // limit=10, offset=(2-1)*10
  });

  it("caps an oversized limit at the configured maximum page size", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await GET(getRequest("?limit=99999"));

    const [, rowsParams] = mockQuery.mock.calls[1];
    expect(rowsParams[0]).toBe(100);
  });

  it("returns a 500 through withErrorHandling when the database query throws", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));

    const res = await GET(getRequest());

    expect(res.status).toBe(500);
  });
});
