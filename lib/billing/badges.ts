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

export async function revokePremiumBadge(userId: number) {
  try {
    const badgeResult = await pool.query(
      `SELECT id FROM badges WHERE name = 'premium' LIMIT 1`,
    );
    if (badgeResult.rows.length === 0) return;
    const badgeId = badgeResult.rows[0].id;

    await pool.query(
      `DELETE FROM user_badges WHERE user_id = $1 AND badge_id = $2`,
      [userId, badgeId],
    );
    console.log(`[Stripe] Revoked premium badge from user ${userId}`);
  } catch (err) {
    console.error(`[Stripe] Failed to revoke premium badge:`, err);
  }
}
