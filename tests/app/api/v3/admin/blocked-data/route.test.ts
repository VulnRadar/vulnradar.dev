/**
 * Route-level tests for POST /api/v3/admin/blocked-data (find_scans /
 * delete_scans against a blocked domain or value). Gated by requireAdmin
 * (admin tier only) — this is deliberately stricter than the general staff
 * gate since it can bulk-delete scan history. requireAdmin runs for real;
 * only getSession and the database are mocked.
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

const { POST } = await import("@/app/api/v3/admin/blocked-data/route");

function queueRole(role: string | null) {
  // totp_enabled: true so requireAdmin's 2FA-enforcement check
  // (lib/auth/authorization.ts) short-circuits before ever calling
  // getSetting("ENFORCE_STAFF_2FA") -- this file doesn't mock
  // @/lib/config/runtime-config, so an unmocked call would hit the real
  // resolver against this same mocked pool, consuming a query slot this
  // suite's call-count assertions don't expect.
  mockQuery.mockResolvedValueOnce({
    rows: role ? [{ id: 1, role, totp_enabled: true }] : [],
  });
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/admin/blocked-data", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockLogAction.mockReset();
  mockGetSession.mockResolvedValue({ userId: 1 });
});

describe("POST /api/v3/admin/blocked-data — authorization", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(
      postRequest({ action: "find_scans", value: "evil.com" }),
    );
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a moderator (this destructive action is admin-only)", async () => {
    queueRole("moderator");
    const res = await POST(
      postRequest({ action: "find_scans", value: "evil.com" }),
    );
    expect(res.status).toBe(401);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("allows an admin through the gate", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await POST(
      postRequest({ action: "find_scans", value: "evil.com" }),
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /api/v3/admin/blocked-data — actions", () => {
  it("requires an action", async () => {
    queueRole("admin");
    const res = await POST(postRequest({}));
    expect(res.status).toBe(400);
  });

  it("find_scans requires a value", async () => {
    queueRole("admin");
    const res = await POST(postRequest({ action: "find_scans" }));
    expect(res.status).toBe(400);
  });

  it("find_scans returns matches and audit-logs the search", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, url: "https://evil.com/x", user_id: 9 }],
    });
    const res = await POST(
      postRequest({ action: "find_scans", value: "evil.com" }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.scans).toHaveLength(1);
    expect(mockLogAction).toHaveBeenCalledWith(
      1,
      null,
      "blocked_data_search",
      expect.stringContaining("evil.com"),
      "127.0.0.1",
    );
  });

  it("delete_scans requires a value", async () => {
    queueRole("admin");
    const res = await POST(postRequest({ action: "delete_scans" }));
    expect(res.status).toBe(400);
  });

  it("delete_scans deletes matching rows and audit-logs the count", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1 }, { id: 2 }],
      rowCount: 2,
    });
    const res = await POST(
      postRequest({ action: "delete_scans", value: "evil.com" }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.deletedCount).toBe(2);
    expect(mockLogAction).toHaveBeenCalledWith(
      1,
      null,
      "blocked_data_delete",
      expect.stringContaining("2"),
      "127.0.0.1",
    );
  });

  it("purge_host_reputation requires a value", async () => {
    queueRole("admin");
    const res = await POST(postRequest({ action: "purge_host_reputation" }));
    expect(res.status).toBe(400);
  });

  it("purge_host_reputation rejects a value that isn't a domain (e.g. a raw IP)", async () => {
    queueRole("admin");
    const res = await POST(
      postRequest({ action: "purge_host_reputation", value: "192.168.1.1" }),
    );
    expect(res.status).toBe(400);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("purge_host_reputation normalizes the value, deletes the cached row, and audit-logs it", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({
      rows: [{ host: "evil.com" }],
      rowCount: 1,
    });
    const res = await POST(
      postRequest({
        action: "purge_host_reputation",
        value: "https://www.evil.com/some/path",
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({
      success: true,
      deleted: true,
      host: "evil.com",
      message: 'Purged cached reputation for "evil.com".',
    });
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain("DELETE FROM host_reputation");
    expect(params).toEqual(["evil.com"]);
    expect(mockLogAction).toHaveBeenCalledWith(
      1,
      null,
      "purge_host_reputation",
      expect.stringContaining("evil.com"),
      "127.0.0.1",
    );
  });

  it("purge_host_reputation reports deleted: false when nothing was cached", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await POST(
      postRequest({ action: "purge_host_reputation", value: "clean.com" }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.deleted).toBe(false);
  });

  it("rejects an unknown action", async () => {
    queueRole("admin");
    const res = await POST(
      postRequest({ action: "not_a_real_action", value: "x" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 500 when the database throws", async () => {
    queueRole("admin");
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await POST(
      postRequest({ action: "find_scans", value: "evil.com" }),
    );
    expect(res.status).toBe(500);
  });
});
