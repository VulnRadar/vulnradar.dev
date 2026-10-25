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
  // totp_enabled: true so requireAdmin's 2FA-enforcement check
  // (lib/auth/authorization.ts) short-circuits before ever calling
  // getSetting("ENFORCE_STAFF_2FA") -- this file doesn't mock
  // @/lib/config/runtime-config, so an unmocked call would hit the real
  // resolver against this same mocked pool, consuming a query slot this
  // suite's call-count assertions don't expect.
  mockQuery.mockResolvedValueOnce({
    rows: [{ id: userId, role, totp_enabled: true }],
  });
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
    // ESCAPE '\' is required, not cosmetic: without it a literal "_" in the
    // search matches any character and a bare "%" degrades to a full scan of
    // system_error_logs. The bound value is escaped to match.
    expect(countCall[0]).toContain(
      "WHERE (message ILIKE $1 ESCAPE '\\' OR detail ILIKE $1 ESCAPE '\\')",
    );
    expect(countCall[1]).toEqual(["%timeout%"]);

    const selectCall = mockQuery.mock.calls[2] as [string, unknown[]];
    expect(selectCall[1]).toEqual(["%timeout%", 20, 0]);
  });

  it("returns the request and scan each row belongs to", async () => {
    // Both columns were written on every row and returned nowhere, so the
    // correlation they exist for was only reachable from SQL.
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "1" }] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 3,
          message: "scan failed",
          detail: null,
          request_id: "3f9a1c2e-1111-4222-8333-444455556666",
          scan_id: 4812,
          created_at: "2026-08-10T00:00:00Z",
        },
      ],
    });

    const res = await GET(getRequest());
    const json = await res.json();

    expect(json.logs[0].request_id).toBe(
      "3f9a1c2e-1111-4222-8333-444455556666",
    );
    expect(json.logs[0].scan_id).toBe(4812);
    const selectCall = mockQuery.mock.calls[2] as [string, unknown[]];
    expect(selectCall[0]).toContain(
      "SELECT id, message, detail, request_id, scan_id, created_at",
    );
  });

  it("filters on an exact request id", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "2" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await GET(
      getRequest("?requestId=3f9a1c2e-1111-4222-8333-444455556666"),
    );

    expect(res.status).toBe(200);
    const countCall = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(countCall[0]).toContain("WHERE request_id = $1");
    expect(countCall[1]).toEqual(["3f9a1c2e-1111-4222-8333-444455556666"]);
    const selectCall = mockQuery.mock.calls[2] as [string, unknown[]];
    expect(selectCall[1]).toEqual([
      "3f9a1c2e-1111-4222-8333-444455556666",
      20,
      0,
    ]);
  });

  it("filters on an exact scan id", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "1" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await GET(getRequest("?scanId=4812"));

    const countCall = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(countCall[0]).toContain("WHERE scan_id = $1");
    expect(countCall[1]).toEqual([4812]);
  });

  it("combines search, request and scan with AND and numbers the parameters in order", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await GET(
      getRequest(
        "?search=timeout&requestId=3f9a1c2e-1111-4222-8333-444455556666&scanId=7",
      ),
    );

    const selectCall = mockQuery.mock.calls[2] as [string, unknown[]];
    expect(selectCall[0]).toContain(
      "WHERE (message ILIKE $1 ESCAPE '\\' OR detail ILIKE $1 ESCAPE '\\') AND request_id = $2 AND scan_id = $3",
    );
    expect(selectCall[0]).toContain("LIMIT $4 OFFSET $5");
    expect(selectCall[1]).toEqual([
      "%timeout%",
      "3f9a1c2e-1111-4222-8333-444455556666",
      7,
      20,
      0,
    ]);
  });

  it("refuses a malformed request id instead of returning an empty list", async () => {
    withAdmin();

    const res = await GET(getRequest("?requestId=x%27%3B--"));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("That is not a request id.");
    // Only the role lookup ran: nothing was searched.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it.each(["abc", "-4", "0", "1e3", "99999999999"])(
    "refuses %s as a scan id",
    async (bad) => {
      withAdmin();

      const res = await GET(getRequest(`?scanId=${bad}`));

      expect(res.status).toBe(400);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    },
  );

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

  it("turns a throw outside the query into a 500 that names the route", async () => {
    // The auth lookup is outside the handler's own try/catch. Wrapped in
    // withErrorHandling, a failure there is logged against this route with
    // the request id entered, instead of reaching Next's default handler as
    // a bare stack.
    mockGetSession.mockRejectedValue(new Error("session store down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(getRequest());

    expect(res.status).toBe(500);
    expect(String(spy.mock.calls[0][0])).toContain(
      "GET /api/v3/admin/error-logs",
    );
    spy.mockRestore();
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
