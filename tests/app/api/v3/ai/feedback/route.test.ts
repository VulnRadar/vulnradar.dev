/**
 * POST /api/v3/ai/feedback. The database is faked: this proves the gates and
 * which statement runs. The upsert and the ownership rule are proven against
 * real Postgres in tests/integration/ai-conversations.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({ getSession: () => mockGetSession() }));

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...a: unknown[]) => mockQuery(...a) },
}));

vi.mock("@/lib/rate-limiting/rate-limit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/rate-limiting/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: async () => ({ allowed: true, remaining: 10 }),
  };
});

const { POST } = await import("@/app/api/v3/ai/feedback/route");

const SESSION = "0b8f5c1e-2a3d-4e5f-8a9b-0c1d2e3f4a5b";
const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/v3/ai/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
  mockQuery.mockReset();
});

describe("POST /api/v3/ai/feedback", () => {
  it("requires a signed-in reader", async () => {
    mockGetSession.mockResolvedValue(null);
    expect((await post({})).status).toBe(401);
  });

  it("rejects a rating that is not 1, -1 or 0", async () => {
    const res = await post({ sessionId: SESSION, messageIndex: 1, rating: 5 });
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a malformed session id or index", async () => {
    expect(
      (await post({ sessionId: "nope", messageIndex: 1, rating: 1 })).status,
    ).toBe(400);
    expect(
      (await post({ sessionId: SESSION, messageIndex: -1, rating: 1 })).status,
    ).toBe(400);
  });

  it("treats a conversation this account does not own as missing", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await post({ sessionId: SESSION, messageIndex: 1, rating: -1 });
    expect(res.status).toBe(404);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toContain("user_id = $2");
    expect(params).toEqual([SESSION, 42]);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("upserts a vote on the reader's own conversation", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 9 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await post({
      sessionId: SESSION,
      messageIndex: 3,
      rating: -1,
      comment: "  wrong header name  ",
    });
    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[1];
    expect(String(sql)).toContain(
      "ON CONFLICT (conversation_id, message_index, user_id)",
    );
    expect(params).toEqual([9, 3, 42, -1, "wrong header name"]);
  });

  it("takes a vote back with rating 0", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 9 }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await post({ sessionId: SESSION, messageIndex: 3, rating: 0 });
    expect(res.status).toBe(200);
    expect(String(mockQuery.mock.calls[1][0])).toContain(
      "DELETE FROM ai_message_feedback",
    );
  });
});
