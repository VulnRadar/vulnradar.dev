/**
 * Route-level tests for POST (heartbeat) at /api/v3/admin/activity. Auth
 * here is an inline getSession + role lookup (not the shared requireStaff
 * helper), requiring staff hierarchy >= support. Only the database is mocked.
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

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
}));

const { POST } = await import("@/app/api/v3/admin/activity/route");

function queueRole(role: string | null) {
  mockQuery.mockResolvedValueOnce({ rows: role ? [{ role }] : [] });
}

function postRequest(body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/admin/activity", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 1 });
});

describe("POST /api/v3/admin/activity (heartbeat)", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(postRequest({ section: "dashboard" }));
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 404 when the session's user no longer exists", async () => {
    queueRole(null);
    const res = await POST(postRequest({ section: "dashboard" }));
    expect(res.status).toBe(404);
  });

  it("rejects a plain user (below support tier)", async () => {
    queueRole("user");
    const res = await POST(postRequest({ section: "dashboard" }));
    expect(res.status).toBe(403);
  });

  it("accepts a support-tier heartbeat and upserts staff_activity", async () => {
    queueRole("support");
    mockQuery.mockResolvedValueOnce({
      rows: [{ user_id: 1, last_heartbeat: "now", current_section: "users" }],
    });
    const res = await POST(postRequest({ section: "users" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.activity.is_active).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("falls back to the default section when the body is missing/invalid JSON", async () => {
    queueRole("moderator");
    mockQuery.mockResolvedValueOnce({
      rows: [
        { user_id: 1, last_heartbeat: "now", current_section: "dashboard" },
      ],
    });
    const req = new NextRequest("http://localhost/api/v3/admin/activity", {
      method: "POST",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const upsertParams = mockQuery.mock.calls[1][1] as unknown[];
    expect(upsertParams[1]).toBe("dashboard");
  });
});
