import { it, expect, beforeAll, afterAll } from "vitest";
import pool from "@/lib/database/db";
import { claimBroadcastRecipients } from "@/lib/admin/broadcast-recipients";
import { describeIntegration, createUser, type TestUser } from "./_db";

/**
 * The broadcast recipient claim, judged by Postgres (tests-6, mass-mail part).
 *
 * The claim is what stops a double-clicked Send, or a resend racing a send
 * still in progress, from mailing the same person twice. It is an INSERT ...
 * ON CONFLICT against the unique (message_id, user_id) index with a DO UPDATE
 * that only fires on a 'failed' row. The unit tier fakes pool.query, so it
 * returns whatever rows a test hands it whether the conflict target exists or
 * the WHERE on the DO UPDATE is right. Three properties are asserted here
 * against the real index: a second claim takes nobody, a failed delivery is
 * claimable again (which is what a resend retries), and a row still pending
 * is not (a second sender cannot tell a crashed send from one mid-handshake).
 */
describeIntegration("claiming broadcast recipients", () => {
  let admin: TestUser;
  let a: TestUser;
  let b: TestUser;
  let messageId: number;

  async function statusOf(user: TestUser): Promise<string | undefined> {
    const { rows } = await pool.query<{ status: string }>(
      `SELECT status FROM broadcast_recipients
        WHERE message_id = $1 AND user_id = $2`,
      [messageId, user.id],
    );
    return rows[0]?.status;
  }

  beforeAll(async () => {
    admin = await createUser({ role: "admin" });
    a = await createUser();
    b = await createUser();
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO broadcast_messages (title, content, message_type, segment_filter, created_by, status)
       VALUES ('Claim test', '<p>hi</p>', 'email', '{"segment":"all"}', $1, 'sent')
       RETURNING id`,
      [admin.id],
    );
    messageId = rows[0].id;
  });

  afterAll(async () => {
    await pool.query("DELETE FROM broadcast_messages WHERE id = $1", [
      messageId,
    ]);
  });

  it("claims everyone once, and nobody the second time", async () => {
    const first = await claimBroadcastRecipients(messageId, [a.id, b.id]);
    expect(first.sort()).toEqual([a.id, b.id].sort());
    expect(await statusOf(a)).toBe("pending");

    const second = await claimBroadcastRecipients(messageId, [a.id, b.id]);
    expect(second).toEqual([]);

    const { rows } = await pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM broadcast_recipients WHERE message_id = $1",
      [messageId],
    );
    expect(rows[0].n).toBe(2);
  });

  it("re-claims a failed delivery, and only that one", async () => {
    // a's send threw; b's is still in flight.
    await pool.query(
      `UPDATE broadcast_recipients SET status = 'failed'
        WHERE message_id = $1 AND user_id = $2`,
      [messageId, a.id],
    );

    const retried = await claimBroadcastRecipients(messageId, [a.id, b.id]);
    expect(retried).toEqual([a.id]);
    expect(await statusOf(a)).toBe("pending");
    expect(await statusOf(b)).toBe("pending");
  });

  it("never re-claims a pending or a delivered row", async () => {
    await pool.query(
      `UPDATE broadcast_recipients SET status = 'sent'
        WHERE message_id = $1 AND user_id = $2`,
      [messageId, a.id],
    );
    // a delivered, b pending (a crashed or still-running sender).
    expect(await claimBroadcastRecipients(messageId, [a.id, b.id])).toEqual([]);
    expect(await statusOf(a)).toBe("sent");
    expect(await statusOf(b)).toBe("pending");
  });

  it("claims a recipient who joined the audience after the first send", async () => {
    const late = await createUser();
    expect(
      await claimBroadcastRecipients(messageId, [a.id, b.id, late.id]),
    ).toEqual([late.id]);
  });
});
