/**
 * Route-level tests for GET /api/v3/admin/audit-log/export (AUDIT-010
 * admin-feature-gap: audit log export, CSV/JSON).
 *
 * Auth goes through the shared requireAdmin() (lib/auth/authorization.ts),
 * which itself calls getSession() and a pool.query role lookup -- both
 * mocked here, the same "mock at the getSession/db boundary" approach
 * tests/app/api/v3/admin/error-logs/route.test.ts uses.
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

// requireAdmin() (lib/auth/authorization.ts) also enforces ENFORCE_STAFF_2FA
// via lib/config/runtime-config's getSetting -- mocked off here (same
// pattern tests/lib/auth/authorization.test.ts uses) so this file's own
// pool.query mocks stay scoped to the role check and the export SELECT.
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: vi.fn(async (key: string) =>
    key === "ENFORCE_STAFF_2FA" ? false : undefined,
  ),
}));

const { GET } = await import("@/app/api/v3/admin/audit-log/export/route");

function withAdmin(userId = 7, role = "admin") {
  mockGetSession.mockResolvedValue({ userId });
  mockQuery.mockResolvedValueOnce({ rows: [{ id: userId, role }] });
}

function getRequest(query = ""): NextRequest {
  return new NextRequest(
    `http://localhost/api/v3/admin/audit-log/export${query}`,
  );
}

const sampleRows = [
  {
    id: 2,
    created_at: "2026-08-10T00:00:00Z",
    action: "set_role",
    admin_id: 7,
    admin_email: "admin@example.com",
    admin_name: "Admin",
    target_user_id: 3,
    target_email: "user@example.com",
    target_name: "User",
    ip_address: "127.0.0.1",
    details: 'role changed, "quoted" text',
  },
  {
    id: 1,
    created_at: "2026-08-09T00:00:00Z",
    action: "reset_password",
    admin_id: 7,
    admin_email: "admin@example.com",
    admin_name: "Admin",
    target_user_id: null,
    target_email: null,
    target_name: null,
    ip_address: null,
    details: null,
  },
];

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockLogAction.mockReset();
});

describe("GET /api/v3/admin/audit-log/export", () => {
  it("requires a session", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET(getRequest());
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a caller below admin (e.g. moderator)", async () => {
    mockGetSession.mockResolvedValue({ userId: 3 });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 3, role: "moderator" }] });
    const res = await GET(getRequest());
    expect(res.status).toBe(403);
  });

  it("defaults to JSON, returns the full unpaginated table, and sets a download header", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: sampleRows });

    const res = await GET(getRequest());
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Content-Disposition")).toContain(
      "vulnradar-audit-log-",
    );
    expect(res.headers.get("Content-Disposition")).toContain(".json");
    expect(JSON.parse(text)).toEqual(sampleRows);

    const selectCall = mockQuery.mock.calls[1] as [string, unknown[]?];
    expect(selectCall[0]).toContain("FROM admin_audit_log al");
    expect(selectCall[0]).not.toContain("LIMIT");
  });

  it("returns CSV with a header row, RFC 4180 quoting for embedded quotes/commas, and empty cells for null fields", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: sampleRows });

    const res = await GET(getRequest("?format=csv"));
    const text = await res.text();
    const lines = text.split("\r\n");

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain(".csv");
    expect(lines[0]).toBe(
      "id,created_at,action,admin_id,admin_email,admin_name,target_user_id,target_email,target_name,ip_address,details",
    );
    // Embedded quote/comma in details gets quoted and doubled per RFC 4180.
    expect(lines[1]).toContain('"role changed, ""quoted"" text"');
    // Null fields render as empty cells, not the string "null".
    expect(lines[2]).toContain(",,,");
    expect(lines[2]).not.toContain("null");
  });

  it("records the export itself to admin_audit_log with the row count and format", async () => {
    withAdmin(7, "admin");
    mockQuery.mockResolvedValueOnce({ rows: sampleRows });

    await GET(getRequest("?format=csv"));

    expect(mockLogAction).toHaveBeenCalledWith(
      7,
      null,
      "audit_log_exported",
      expect.stringContaining("2"),
      "127.0.0.1",
    );
    expect(mockLogAction).toHaveBeenCalledWith(
      7,
      null,
      "audit_log_exported",
      expect.stringContaining("CSV"),
      "127.0.0.1",
    );
  });

  it("returns a graceful 500 when the query fails", async () => {
    withAdmin();
    mockQuery.mockRejectedValueOnce(new Error("db exploded"));
    const res = await GET(getRequest());
    expect(res.status).toBe(500);
  });
});
