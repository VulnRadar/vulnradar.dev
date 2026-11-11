import pool from "@/lib/database/db";

/**
 * Claim the broadcast deliveries this sender is allowed to make.
 *
 * AUDIT-013 schema-08: this used to be a read-then-insert guard: SELECT "have
 * we sent to these people", then sendEmail, then INSERT. The whole SMTP round
 * trip sat inside that window, so an admin double-clicking send, or a resend
 * racing a still-running first send, passed the SELECT for the same recipient
 * twice and mailed them twice. Duplicate mass mail is the fastest way to get a
 * sending domain reputation-flagged.
 *
 * The claim is the INSERT itself, made atomic by the unique index on
 * (message_id, user_id). Only the writer whose row comes back sends. A send
 * that then fails is marked 'failed' and the DO UPDATE re-claims exactly those
 * rows on a later resend, so retry still works; a row left 'pending' by a
 * process that died mid-send is deliberately NOT re-claimable, because a
 * second sender cannot tell "the first one crashed before sending" from "the
 * first one is mid-handshake right now".
 *
 * Its own module so tests/integration/broadcast-claim.test.ts can run it
 * against the real index: a faked pool returns whatever rows it is told to,
 * which says nothing about what ON CONFLICT actually does.
 *
 * Returns the ids this call claimed.
 */
export async function claimBroadcastRecipients(
  messageId: number,
  userIds: number[],
): Promise<number[]> {
  if (userIds.length === 0) return [];
  const claimed = await pool.query<{ user_id: number }>(
    `INSERT INTO broadcast_recipients (message_id, user_id, status)
     SELECT $1, u, 'pending' FROM unnest($2::int[]) AS u
     ON CONFLICT (message_id, user_id) DO UPDATE SET status = 'pending'
       WHERE broadcast_recipients.status = 'failed'
     RETURNING user_id`,
    [messageId, userIds],
  );
  return claimed.rows.map((r) => r.user_id);
}
