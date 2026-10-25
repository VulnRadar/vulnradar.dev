import pool from "@/lib/database/db";
import { logError } from "@/lib/logging/log";

/**
 * Whether any users row is one a Stripe subscription event could have landed
 * on, for telling two outcomes apart that look identical from the write.
 *
 * lib/billing/subscription-writes.ts answers "no row updated" for two very
 * different reasons. Either no account exists for the event (a customer who
 * paid and has nobody to give the plan to), or an account does exist and the
 * ownership guard refused to touch it because it already knows this
 * subscription or is on another live one. The second is routine: a `created`
 * that arrives after the buyer confirmed payment is refused on purpose. The
 * first is the one an operator has to hear about, and lumping them together
 * either buries it or raises a false alarm on every normal activation.
 *
 * Only the keys the caller's write actually tried go in. A row that matches a
 * key the write never used proves nothing about why the write found none.
 *
 * Read-only and run on the unmatched path alone, so the normal event costs no
 * extra query. A failed lookup is logged and reads as "no account": for a paid
 * event a false alert is the cheaper mistake.
 */
export async function findAccountForSubscriptionEvent(keys: {
  userId?: number | null;
  customerId?: string | null;
  email?: string | null;
}): Promise<number | null> {
  // parseInt of malformed metadata is NaN, which Postgres would reject as an int.
  const userId = Number.isInteger(keys.userId) ? (keys.userId as number) : null;
  const customerId = keys.customerId || null;
  const email = keys.email || null;
  if (userId === null && customerId === null && email === null) return null;

  try {
    const result = await pool.query<{ id: number }>(
      `SELECT id FROM users
        WHERE ($1::int IS NOT NULL AND id = $1)
           OR ($2::text IS NOT NULL AND stripe_customer_id = $2)
           OR ($3::text IS NOT NULL AND LOWER(email) = LOWER($3))
        LIMIT 1`,
      [userId, customerId, email],
    );
    return result.rows[0]?.id ?? null;
  } catch (err) {
    logError(
      "stripe",
      "could not check whether a subscription event has an account",
      err,
      { userId, customerId },
    );
    return null;
  }
}
