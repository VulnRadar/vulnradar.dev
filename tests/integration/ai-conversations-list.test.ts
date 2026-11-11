import { it, expect, vi, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import pool from "@/lib/database/db";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * The AI Chats list, against the real tables.
 *
 * The tiles counted rated-down replies and failed replies over seven days,
 * while the filters they open had no window and the search box only covered
 * the page the browser had loaded, so a tile's number, the rows it opened and
 * a search for a known user could all disagree. These are claims about an
 * ILIKE with an ESCAPE, a COUNT(DISTINCT) and an interval predicate, which a
 * faked pool answers the same whether they are right or wrong.
 */

vi.mock("@/lib/auth/authorization", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/authorization")>();
  return {
    ...actual,
    requirePermission: async () => ({ id: 1, userId: 1, role: "moderator" }),
  };
});

const { GET } = await import("@/app/api/v3/ai/conversations/route");

const tag = unique("aichat").replace(/[^a-z0-9]/gi, "");
const created: number[] = [];

async function conversation(
  userId: number | null,
  ageDays = 0,
): Promise<{ id: number; sessionId: string }> {
  const sessionId = randomUUID();
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO ai_conversations (session_id, user_id, messages, created_at, last_message_at)
     VALUES ($1, $2, '[]'::jsonb, NOW() - make_interval(days => $3::int), NOW() - make_interval(days => $3::int))
     RETURNING id`,
    [sessionId, userId, ageDays],
  );
  created.push(rows[0].id);
  return { id: rows[0].id, sessionId };
}

async function rateDown(
  conversationId: number,
  userId: number,
  ageDays: number,
  index = 1,
) {
  await pool.query(
    `INSERT INTO ai_message_feedback (conversation_id, message_index, user_id, rating, created_at)
     VALUES ($1, $2, $3, -1, NOW() - make_interval(days => $4::int))`,
    [conversationId, index, userId, ageDays],
  );
}

async function failReply(conversationId: number, ageDays: number, index = 1) {
  await pool.query(
    `INSERT INTO ai_chat_events (conversation_id, message_index, error, created_at)
     VALUES ($1, $2, 'empty reply', NOW() - make_interval(days => $3::int))`,
    [conversationId, index, ageDays],
  );
}

async function list(qs: string) {
  const res = await GET(
    new NextRequest(`http://localhost/api/v3/ai/conversations?limit=200${qs}`),
  );
  expect(res.status).toBe(200);
  return res.json() as Promise<{
    conversations: Array<{ id: number }>;
    total: number;
    signals: Record<string, number>;
  }>;
}

const ids = (body: { conversations: Array<{ id: number }> }) =>
  body.conversations
    .map((c) => c.id)
    .filter((id) => created.includes(id))
    .sort((a, b) => a - b);

describeIntegration("AI Chats list", () => {
  afterAll(async () => {
    await pool.query(`DELETE FROM ai_conversations WHERE id = ANY($1::int[])`, [
      created,
    ]);
  });

  it("finds a conversation by the user's name across the whole table", async () => {
    const user = await createUser();
    await pool.query("UPDATE users SET name = $2 WHERE id = $1", [
      user.id,
      `Searchable ${tag}`,
    ]);
    const mine = await conversation(user.id, 3);
    // Newer conversations that would push it off a first page in the browser.
    for (let i = 0; i < 3; i++) await conversation(null);

    const body = await list(`&q=${encodeURIComponent(tag)}`);
    expect(ids(body)).toEqual([mine.id]);
    expect(body.total).toBe(1);
  });

  it("finds one by session id, and treats LIKE characters literally", async () => {
    const target = await conversation(null);
    const byId = await list(`&q=${target.sessionId.slice(0, 13)}`);
    expect(ids(byId)).toContain(target.id);

    const everything = await list(`&q=${encodeURIComponent("%")}`);
    expect(everything.total).toBe(0);
  });

  it("bounds the rated-down filter to the tile's seven days and counts conversations", async () => {
    const rater = await createUser();
    const recent = await conversation(null);
    const old = await conversation(null, 30);
    // Two bad ratings on one conversation is one conversation on the tile.
    await rateDown(recent.id, rater.id, 1, 1);
    await rateDown(recent.id, rater.id, 1, 3);
    await rateDown(old.id, rater.id, 20);

    const body = await list("&rating=down");
    const mine = ids(body);
    expect(mine).toContain(recent.id);
    expect(mine).not.toContain(old.id);

    const { signals } = await list("");
    expect(
      signals.unhelpfulLast7Days - signals.unhelpfulConversationsLast7Days,
    ).toBeGreaterThanOrEqual(1);
  });

  it("bounds the failed-reply filter the same way", async () => {
    const recent = await conversation(null);
    const old = await conversation(null, 30);
    await failReply(recent.id, 2);
    await failReply(old.id, 25);

    const mine = ids(await list("&errored=1"));
    expect(mine).toContain(recent.id);
    expect(mine).not.toContain(old.id);
  });
});
