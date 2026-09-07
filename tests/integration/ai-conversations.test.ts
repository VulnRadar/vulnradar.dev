import { it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import pool from "@/lib/database/db";
import { describeIntegration, createUser } from "./_db";

/**
 * Who is allowed to overwrite a stored AI conversation.
 *
 * The chat widget picks a session id client-side and POSTs the whole
 * conversation back after every exchange, upserting on that id. The upsert had
 * no predicate, so knowing another account's session id was enough to replace
 * their conversation's messages, and because the old DO UPDATE never touched
 * user_id the row kept the victim's identity: staff opening the admin panel
 * read attacker-written text under a real user's name.
 *
 * This is an ON CONFLICT target, a WHERE on a DO UPDATE and an empty
 * RETURNING, none of which a faked pool.query evaluates, so it belongs here
 * rather than in the unit tier (tests/README.md, "Two tiers, two rules").
 */

const upsert = (sessionId: string, userId: number | null, text: string) =>
  pool.query(
    `INSERT INTO ai_conversations (session_id, user_id, messages, created_at, last_message_at)
     VALUES ($1, $2, $3::jsonb, NOW(), NOW())
     ON CONFLICT (session_id) DO UPDATE
       SET messages = $3::jsonb,
           last_message_at = NOW(),
           user_id = COALESCE(ai_conversations.user_id, EXCLUDED.user_id)
       WHERE ai_conversations.user_id IS NULL
          OR ai_conversations.user_id = EXCLUDED.user_id
     RETURNING id, session_id`,
    [sessionId, userId, JSON.stringify([{ role: "user", content: text }])],
  );

const read = async (sessionId: string) => {
  const { rows } = await pool.query(
    `SELECT user_id, messages FROM ai_conversations WHERE session_id = $1`,
    [sessionId],
  );
  return rows[0] as
    | { user_id: number | null; messages: Array<{ content: string }> }
    | undefined;
};

const created: string[] = [];
const session = () => {
  const id = randomUUID();
  created.push(id);
  return id;
};

describeIntegration("ai_conversations upsert ownership", () => {
  afterEach(async () => {
    if (created.length === 0) return;
    await pool.query(
      `DELETE FROM ai_conversations WHERE session_id = ANY($1::text[])`,
      [created.splice(0)],
    );
  });

  it("refuses to overwrite another account's conversation", async () => {
    const owner = await createUser();
    const attacker = await createUser();
    const id = session();

    await upsert(id, owner.id, "my private question");
    const result = await upsert(id, attacker.id, "planted text");

    // No row came back, which is what the route turns into a 404.
    expect(result.rows).toHaveLength(0);
    const row = await read(id);
    expect(row?.messages[0].content).toBe("my private question");
    expect(row?.user_id).toBe(owner.id);
  });

  it("refuses an anonymous overwrite of a signed-in conversation", async () => {
    // The cheapest version of the attack: no account needed at all.
    const owner = await createUser();
    const id = session();

    await upsert(id, owner.id, "my private question");
    expect((await upsert(id, null, "planted text")).rows).toHaveLength(0);
    expect((await read(id))?.messages[0].content).toBe("my private question");
  });

  it("lets the owner keep writing to their own conversation", async () => {
    const owner = await createUser();
    const id = session();

    await upsert(id, owner.id, "first");
    const result = await upsert(id, owner.id, "second");

    expect(result.rows).toHaveLength(1);
    expect((await read(id))?.messages[0].content).toBe("second");
  });

  it("lets a guest who signs in mid-conversation keep their own thread", async () => {
    // The reason the predicate cannot simply be "user_id = EXCLUDED.user_id":
    // the widget works signed out, and the same session id comes back with an
    // account attached the moment its owner logs in. Without the IS NULL arm
    // they would be locked out of their own conversation one message in.
    const user = await createUser();
    const id = session();

    await upsert(id, null, "asked while signed out");
    const result = await upsert(id, user.id, "asked after signing in");

    expect(result.rows).toHaveLength(1);
    const row = await read(id);
    expect(row?.user_id).toBe(user.id);
    expect(row?.messages[0].content).toBe("asked after signing in");
  });

  it("never moves a conversation off the account that already holds it", async () => {
    // COALESCE fills a NULL and nothing else, so adoption is one-way.
    const owner = await createUser();
    const id = session();

    await upsert(id, owner.id, "first");
    await upsert(id, owner.id, "second");

    expect((await read(id))?.user_id).toBe(owner.id);
  });
});
