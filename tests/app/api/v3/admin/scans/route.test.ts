/**
 * Route-level tests for GET /api/v3/admin/scans/[id], the staff scan
 * inspector.
 *
 * GET /api/v3/history/[id] answers 404 to anyone who is not the owner or a
 * teammate, staff included, so a "my scan failed" report could not be looked
 * at without database access. The route is gated on VIEW_ALL_SCANS and every
 * read is audited as view_scan. requirePermission runs for real; only
 * getSession and the database are mocked.
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
    logAction: (...args: unknown[]) => mockLogAction(...args),
  };
});

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
}));

const { GET } = await import("@/app/api/v3/admin/scans/[id]/route");

/** requirePermission's own role lookup. totp_enabled short-circuits the 2FA gate. */
function queueRole(role: string | null) {
  mockQuery.mockResolvedValueOnce({
    rows: role ? [{ id: 7, role, totp_enabled: true }] : [],
  });
}

function scanRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 41,
    public_id: "c".repeat(32),
    user_id: 9,
    url: "https://target.example.test/",
    status: "failed",
    failure_kind: "target_unreachable",
    error_message: "Could not reach the target URL: ECONNREFUSED",
    source: "web",
    scan_type: "web",
    started_at: "2026-10-01T10:00:00.000Z",
    scanned_at: "2026-10-01T10:00:01.000Z",
    duration: 900,
    findings_count: 0,
    summary: {},
    current_category: null,
    categories_completed: 0,
    categories_total: 0,
    authenticated: false,
    is_public: true,
    findings: [],
    result_meta: null,
    user_email: "owner@example.test",
    user_name: "Owner",
    ...overrides,
  };
}

function call(id: string) {
  return GET(new NextRequest(`http://localhost/api/v3/admin/scans/${id}`), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockLogAction.mockReset();
  mockLogAction.mockResolvedValue(undefined);
  mockGetSession.mockResolvedValue({ userId: 7 });
});

describe("GET /api/v3/admin/scans/[id], authorization", () => {
  it("rejects an unauthenticated caller before touching the database", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await call("41");
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects an ordinary user", async () => {
    queueRole("user");
    const res = await call("41");
    expect(res.status).toBe(403);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("rejects a staff role that cannot see other accounts' scans (content_manager)", async () => {
    queueRole("content_manager");
    const res = await call("41");
    expect(res.status).toBe(403);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it.each(["support", "moderator", "security_analyst", "ops", "admin"])(
    "lets %s in, because VIEW_ALL_SCANS is what decides it",
    async (role) => {
      queueRole(role);
      mockQuery.mockResolvedValueOnce({ rows: [scanRow()] });
      const res = await call("41");
      expect(res.status).toBe(200);
    },
  );
});

describe("GET /api/v3/admin/scans/[id], the read", () => {
  it("returns the failure kind, the raw error and the timings", async () => {
    queueRole("support");
    mockQuery.mockResolvedValueOnce({ rows: [scanRow()] });
    const res = await call("41");
    const { scan } = await res.json();
    expect(scan).toMatchObject({
      id: 41,
      status: "failed",
      failureKind: "target_unreachable",
      errorMessage: "Could not reach the target URL: ECONNREFUSED",
      startedAt: "2026-10-01T10:00:00.000Z",
      durationMs: 900,
    });
  });

  it("404s a scan that does not exist, and does not audit it", async () => {
    queueRole("support");
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await call("999");
    expect(res.status).toBe(404);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("404s an id that is neither shape without a second query", async () => {
    queueRole("support");
    const res = await call("not%20valid");
    expect(res.status).toBe(404);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("names the owner for a role that can see accounts", async () => {
    queueRole("support");
    mockQuery.mockResolvedValueOnce({ rows: [scanRow()] });
    const { scan } = await (await call("41")).json();
    expect(scan.user).toEqual({
      id: 9,
      email: "owner@example.test",
      name: "Owner",
    });
  });

  // ops holds VIEW_ALL_SCANS but deliberately not VIEW_USERS: the scan is
  // readable, the account behind it is a number.
  it("gives ops the owner's id and not their address", async () => {
    queueRole("ops");
    mockQuery.mockResolvedValueOnce({ rows: [scanRow()] });
    const { scan } = await (await call("41")).json();
    expect(scan.user).toEqual({ id: 9, email: null, name: null });
  });
});

describe("GET /api/v3/admin/scans/[id], the audit trail", () => {
  it("records a view_scan row naming the scan and its owner", async () => {
    queueRole("support");
    mockQuery.mockResolvedValueOnce({ rows: [scanRow()] });
    await call("41");
    expect(mockLogAction).toHaveBeenCalledWith(
      7,
      9,
      "view_scan",
      "Inspected scan #41",
      "127.0.0.1",
    );
  });

  it("does not put the target URL in the audit details", async () => {
    queueRole("support");
    mockQuery.mockResolvedValueOnce({ rows: [scanRow()] });
    await call("41");
    expect(String(mockLogAction.mock.calls[0][3])).not.toContain("target");
  });

  it("still serves the scan when the audit write fails, and logs the failure", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mockLogAction.mockRejectedValue(new Error("audit table locked"));
    queueRole("support");
    mockQuery.mockResolvedValueOnce({ rows: [scanRow()] });
    const res = await call("41");
    expect(res.status).toBe(200);
    expect(consoleError).toHaveBeenCalled();
    // The Error object itself, so the stack survives into the error log.
    expect(consoleError.mock.calls[0].some((arg) => arg instanceof Error)).toBe(
      true,
    );
    consoleError.mockRestore();
  });
});
