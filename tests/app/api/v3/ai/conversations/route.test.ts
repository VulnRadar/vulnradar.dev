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

  describe("the list", () => {
    const moderator = { id: 7, userId: 7, role: "moderator" };

    /** The three list queries run together, so answer by SQL text. */
    function answerList() {
      mockQuery.mockImplementation(async (sql: string) => {
        if (sql.startsWith("SELECT COUNT(*) FROM ai_conversations"))
          return { rows: [{ count: "0" }] };
        if (sql.includes("unhelpful_7d"))
          return {
            rows: [
              {
                unhelpful_7d: 5,
                errors_7d: 9,
                unhelpful_conversations_7d: 2,
                errored_conversations_7d: 3,
              },
            ],
          };
        return { rows: [] };
      });
    }

    const sqlOf = (match: string) =>
      mockQuery.mock.calls
        .map(([sql, params]) => ({ sql: String(sql), params }))
        .filter(({ sql }) => sql.includes(match));

    beforeEach(() => {
      mockRequirePermission.mockResolvedValue(moderator);
      answerList();
    });

    it("searches name, email and session id on the server", async () => {
      const res = await get("?q=100%25_bob");
      expect(res.status).toBe(200);
      const [list] = sqlOf("jsonb_array_length");
      expect(list.sql).toContain("u.name ILIKE $1 ESCAPE '\\'");
      expect(list.sql).toContain("u.email ILIKE $1 ESCAPE '\\'");
      expect(list.sql).toContain("c.session_id::text ILIKE $1 ESCAPE '\\'");
      // LIKE metacharacters are literal, so "%" cannot match every row.
      expect(list.params).toEqual(["%100\\%\\_bob%", 50, 0]);
      // The count matches the same rows, so it needs the same join.
      const [count] = sqlOf("SELECT COUNT(*) FROM ai_conversations");
      expect(count.sql).toContain("LEFT JOIN users u ON u.id = c.user_id");
      expect(count.params).toEqual(["%100\\%\\_bob%"]);
    });

    it("filters by user id and refuses one that is not a number", async () => {
      await get("?userId=42");
      expect(sqlOf("jsonb_array_length")[0].params).toEqual([42, 50, 0]);

      mockQuery.mockClear();
      const res = await get("?userId=abc");
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it.each([
      ["?rating=down", "ai_message_feedback f"],
      ["?errored=1", "ai_chat_events e"],
    ])("bounds %s to the same seven days as its tile", async (qs, table) => {
      await get(qs);
      const [list] = sqlOf("jsonb_array_length");
      const clause = list.sql.slice(list.sql.indexOf(`FROM ${table}`));
      expect(clause).toMatch(/created_at > NOW\(\) - INTERVAL '7 days'\)/);
    });

    it("counts conversations for the tiles, and keeps the older counts", async () => {
      const json = await (await get()).json();
      expect(json.signals).toEqual({
        unhelpfulLast7Days: 5,
        errorsLast7Days: 9,
        unhelpfulConversationsLast7Days: 2,
        erroredConversationsLast7Days: 3,
      });
      const [signals] = sqlOf("unhelpful_7d");
      expect(signals.sql).toContain("COUNT(DISTINCT conversation_id)");
    });

    it("breaks ties on the primary key so OFFSET pages neither drop nor repeat", async () => {
      await get("?page=2");
      expect(sqlOf("jsonb_array_length")[0].sql).toMatch(
        /ORDER BY c\.last_message_at DESC, c\.id DESC/,
      );
    });
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
