/**
 * GET /api/v3/ai/conversations: who may read other people's chats, and that
 * reading one leaves an audit row.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockRequirePermission = vi.fn();
const mockLogAuditAction = vi.fn();
vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: (...a: unknown[]) => mockRequirePermission(...a),
  logAuditAction: (...a: unknown[]) => mockLogAuditAction(...a),
}));
vi.mock("@/lib/auth", () => ({ getSession: async () => null }));

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...a: unknown[]) => mockQuery(...a) },
}));
vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: async () => "203.0.113.10",
  rateLimitIpKey: (ip: string) => ip,
}));

const { GET } = await import("@/app/api/v3/ai/conversations/route");
const { STAFF_PERMISSIONS, hasStaffPermission } =
  await import("@/lib/auth/permissions-client");

const get = (qs = "") =>
  GET(new NextRequest(`http://localhost/api/v3/ai/conversations${qs}`));

beforeEach(() => {
  mockRequirePermission.mockReset();
  mockLogAuditAction.mockReset();
  mockQuery.mockReset();
});

describe("GET /api/v3/ai/conversations", () => {
  it("asks for the grant the admin panel gates the tab on", async () => {
    mockRequirePermission.mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(403);
    expect(mockRequirePermission).toHaveBeenCalledWith(
      STAFF_PERMISSIONS.MODERATE_CONTENT,
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("is a grant support, billing and ops do not hold", () => {
    for (const role of ["support", "billing", "ops"])
      expect(
        hasStaffPermission(role, STAFF_PERMISSIONS.MODERATE_CONTENT),
        role,
      ).toBe(false);
  });

  it("records who read a transcript", async () => {
    mockRequirePermission.mockResolvedValue({
      id: 7,
      userId: 7,
      role: "moderator",
    });
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: 12,
          session_id: "s",
          user_id: 99,
          messages: [],
          created_at: "2026-10-01",
          last_message_at: "2026-10-01",
          user_name: "Bob",
          user_email: "bob@example.com",
          user_avatar_url: null,
        },
      ],
    });
    const res = await get("?id=12");
    expect(res.status).toBe(200);
    expect(mockLogAuditAction).toHaveBeenCalledWith(
      7,
      99,
      "view_ai_conversation",
      expect.stringContaining("#12"),
      "203.0.113.10",
    );
  });

  it("still returns the transcript when the audit insert fails", async () => {
    mockRequirePermission.mockResolvedValue({
      id: 7,
      userId: 7,
      role: "moderator",
    });
    mockLogAuditAction.mockRejectedValue(new Error("db down"));
    mockQuery.mockResolvedValue({
      rows: [{ id: 12, session_id: "s", user_id: null, messages: [] }],
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await get("?id=12");
    expect(res.status).toBe(200);
    errors.mockRestore();
  });
});
