/**
 * Route-level tests for GET/DELETE /api/v3/admin/error-logs (Admin >
 * System > Error Logs, the admin-visible view over the console.error
 * capture in lib/database/error-log-capture.ts).
 *
 * Auth goes through the shared requireAdmin() (lib/auth/authorization.ts),
 * which itself calls getSession() and a pool.query role lookup -- both
 * mocked here (rather than requireAdmin itself), the same
 * "mock at the getSession/db boundary" approach
 * tests/app/api/v3/admin/teams/route.test.ts uses.
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

const mockLogAction = vi.fn();
vi.mock("@/lib/auth/authorization", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/authorization")>();
  return {
    ...actual,
    logAuditAction: (...args: unknown[]) => mockLogAction(...args),
    logAction: (...args: unknown[]) => mockLogAction(...args),
  };
});

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
}));

const { GET, DELETE } = await import("@/app/api/v3/admin/error-logs/route");

function withAdmin(userId = 7, role = "admin") {
  mockGetSession.mockResolvedValue({ userId });
  mockQuery.mockResolvedValueOnce({ rows: [{ id: userId, role }] });
}

function getRequest(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/v3/admin/error-logs${query}`);
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockLogAction.mockReset();
});

describe("GET /api/v3/admin/error-logs", () => {
  it("requires a session", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET(getRequest());
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a caller below admin (e.g. support)", async () => {
    mockGetSession.mockResolvedValue({ userId: 3 });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 3, role: "support" }] });
    const res = await GET(getRequest());
    expect(res.status).toBe(403);
  });

  it("returns a paginated, most-recent-first page of logs with default page size", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "2" }] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 2,
          message: "second",
          detail: null,
          created_at: "2026-08-10T00:00:00Z",
        },
        {
          id: 1,
          message: "first",
          detail: "stack trace",
          created_at: "2026-08-09T00:00:00Z",
        },
      ],
    });

    const res = await GET(getRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.logs).toHaveLength(2);
    expect(json.total).toBe(2);
    expect(json.totalPages).toBe(1);
    expect(json.page).toBe(1);

    const selectCall = mockQuery.mock.calls[2] as [string, unknown[]];
    expect(selectCall[0]).toContain("ORDER BY created_at DESC");
    expect(selectCall[1]).toEqual([20, 0]);
  });

  it("applies a search filter via ILIKE against message and detail", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "1" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await GET(getRequest("?search=timeout"));

    const countCall = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(countCall[0]).toContain("WHERE message ILIKE $1 OR detail ILIKE $1");
    expect(countCall[1]).toEqual(["%timeout%"]);

    const selectCall = mockQuery.mock.calls[2] as [string, unknown[]];
    expect(selectCall[1]).toEqual(["%timeout%", 20, 0]);
  });

  it("computes the correct OFFSET for page 2", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "50" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await GET(getRequest("?page=2&limit=20"));

    const selectCall = mockQuery.mock.calls[2] as [string, unknown[]];
    expect(selectCall[1]).toEqual([20, 20]);
  });

  it("clamps an oversized limit to the configured max page size", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await GET(getRequest("?limit=99999"));

    const selectCall = mockQuery.mock.calls[2] as [string, unknown[]];
    expect(selectCall[1][0]).toBe(100);
  });

  it("returns a graceful 500 when the query fails", async () => {
    withAdmin();
    mockQuery.mockRejectedValueOnce(new Error("db exploded"));
    const res = await GET(getRequest());
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/v3/admin/error-logs", () => {
  it("requires a session", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await DELETE();
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a caller below admin", async () => {
    mockGetSession.mockResolvedValue({ userId: 3 });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 3, role: "support" }] });
    const res = await DELETE();
    expect(res.status).toBe(403);
  });

  it("clears every row and records the action to admin_audit_log", async () => {
    withAdmin(7, "admin");
    mockQuery.mockResolvedValueOnce({ rowCount: 42, rows: [] });

    const res = await DELETE();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.deletedCount).toBe(42);
    expect(mockQuery.mock.calls[1][0]).toContain(
      "DELETE FROM system_error_logs",
    );
    expect(mockLogAction).toHaveBeenCalledWith(
      7,
      null,
      "error_logs_cleared",
      expect.stringContaining("42"),
      "127.0.0.1",
    );
  });

  it("returns a graceful 500 when the delete fails", async () => {
    withAdmin();
    mockQuery.mockRejectedValueOnce(new Error("db exploded"));
    const res = await DELETE();
    expect(res.status).toBe(500);
  });
});
