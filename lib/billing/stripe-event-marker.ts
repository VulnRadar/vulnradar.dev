import pool from "@/lib/database/db";

/**
 * The Stripe webhook's idempotency marker, one row per event id in
 * processed_stripe_events.
 *
 * Stripe retries an event on any 5xx and an operator can replay one from the
 * dashboard, and every handler in the webhook has side effects (a plan write,
 * a badge, a cancellation, a credit). The marker is claimed before the handler
 * runs and released when it fails, so a delivery is applied once and a failed
 * one is applied again on the retry rather than never.
 *
 * Its own module so tests/integration/stripe-events.test.ts can prove the
 * claim against Postgres: a faked pool answers "inserted" or "conflict" with
 * whatever the test scripted.
 */

/** True when this delivery is the first to claim the event. */
export async function claimStripeEvent(
  eventId: string,
  eventType: string,
): Promise<boolean> {
  const seen = await pool.query<{ event_id: string }>(
    `INSERT INTO processed_stripe_events (event_id, event_type)
     VALUES ($1, $2)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING event_id`,
    [eventId, eventType],
  );
  return (seen.rowCount ?? 0) > 0;
}

/** Undo a claim whose handler failed, so Stripe's retry runs it again. */
export async function releaseStripeEvent(eventId: string): Promise<void> {
  await pool.query(`DELETE FROM processed_stripe_events WHERE event_id = $1`, [
    eventId,
  ]);
}
