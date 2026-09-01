import pool from "@/lib/database/db";

/**
 * Grants/revokes the "premium" badge. Shared by the Stripe webhook
 * (app/api/v3/webhooks/stripe/route.ts) and the direct post-payment
 * confirmation action (app/actions/stripe.ts) so both paths that can
 * legitimately change a user's paid status use the exact same badge logic.
 */
export async function grantPremiumBadge(userId: number) {
  try {
    const badgeResult = await pool.query(
      `SELECT id FROM badges WHERE name = 'premium' LIMIT 1`,
    );
    if (badgeResult.rows.length === 0) {
      console.log(`[Stripe] Premium badge not found in database`);
      return;
    }
    const badgeId = badgeResult.rows[0].id;

    await pool.query(
      `INSERT INTO user_badges (user_id, badge_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, badge_id) DO NOTHING`,
      [userId, badgeId],
    );
    console.log(`[Stripe] Granted premium badge to user ${userId}`);
  } catch (err) {
    console.error(`[Stripe] Failed to grant premium badge:`, err);
  }
}

/**
 * The badge has TWO independent grant paths: a Stripe subscription, and an
 * admin gift (app/api/v3/admin/route.ts's gift_subscription). This used to be
 * an unconditional DELETE, so a lapsing or cancelled Stripe subscription took
 * the badge away from a user whose live admin gift still entitled them to it.
 * The guard mirrors the check revoke_gift already makes in the other
 * direction, which is why all three Stripe callers stay unchanged.
 */
export async function revokePremiumBadge(userId: number) {
  try {
    const badgeResult = await pool.query(
      `SELECT id FROM badges WHERE name = 'premium' LIMIT 1`,
    );
    if (badgeResult.rows.length === 0) return;
    const badgeId = badgeResult.rows[0].id;

    const deleted = await pool.query(
      `DELETE FROM user_badges
        WHERE user_id = $1 AND badge_id = $2
          AND NOT EXISTS (
            SELECT 1 FROM gifted_subscriptions
             WHERE user_id = $1
               AND revoked_at IS NULL
               AND expires_at > NOW()
          )`,
      [userId, badgeId],
    );
    // rowCount 0 means either "they never had it" or "a live gift kept it",
    // so the log says what actually happened rather than asserting a revoke
    // that may not have occurred.
    console.log(
      deleted.rowCount === 0
        ? `[Stripe] Premium badge left in place for user ${userId} (not held, or still covered by an active gift)`
        : `[Stripe] Revoked premium badge from user ${userId}`,
    );
  } catch (err) {
    console.error(`[Stripe] Failed to revoke premium badge:`, err);
  }
}
