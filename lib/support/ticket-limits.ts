import pool from "@/lib/database/db";
import { OPEN_TICKET_STATUSES } from "./ticket-constants";

/**
 * How many tickets one account may have in flight before a new one is refused.
 *
 * The cap used to count open tickets only, which made it a speed bump rather
 * than a limit: open a ticket, close it yourself, open another, and the count
 * never moved. Each pass sent two emails and ran a language-detection call
 * (plus a translation call when the text was not in the default language) on
 * the operator's own AI key, with nothing between the loop and the inbox.
 */
export const MAX_OPEN_TICKETS_PER_USER = 20;

/**
 * Closing a ticket does not free its slot straight away. A resolved or closed
 * ticket keeps counting for this long after it was last touched, so the loop
 * above is bounded by this window instead of by how fast somebody can click.
 */
export const CLOSED_TICKET_SLOT_HOURS = 24;

/**
 * Tickets that count toward the cap: everything still open, plus anything
 * resolved or closed within the last CLOSED_TICKET_SLOT_HOURS.
 *
 * `updated_at` is when a resolved/closed ticket reached that state, because a
 * closed ticket takes no replies and a reply is what moves a resolved one back
 * to awaiting_staff (where the first condition already counts it). Staff
 * closures count too: support_tickets has no closed_by column to tell the two
 * apart. The cap is 20, so an honest account never feels it.
 */
export async function countTicketsAgainstCap(userId: number): Promise<number> {
  const result = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM support_tickets
      WHERE user_id = $1
        AND (status = ANY($2::text[])
             OR updated_at > NOW() - make_interval(hours => $3::int))`,
    [userId, [...OPEN_TICKET_STATUSES], CLOSED_TICKET_SLOT_HOURS],
  );
  return result.rows[0]?.n ?? 0;
}
