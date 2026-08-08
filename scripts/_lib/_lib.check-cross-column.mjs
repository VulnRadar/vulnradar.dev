/**
 * VulnRadar — Cross-column state consistency.
 *
 * Every rule here is grounded in a specific, read code path -- not a
 * guessed invariant. Two candidates from the original ask were checked
 * against the real code and deliberately dropped:
 *
 *   - "disabled_at set but role='admin'": app/api/v3/admin/route.ts's
 *     `disable` action has no role check blocking it, so an admin CAN be
 *     disabled (e.g. an admin leaving staff). Not corruption -- dropped.
 *   - totp_enabled/totp_secret consistency: already covered by
 *     scripts/db-diagnose-2fa.mjs's classifyUser, which db-diagnose.mjs
 *     calls directly and folds into its own report instead of
 *     reimplementing it here.
 *
 * What IS grounded and checked:
 *
 *   1. disabled_at IS NOT NULL but a live sessions row still exists for
 *      that user. app/api/v3/account/delete's sibling, the admin
 *      `disable` action, does `DELETE FROM sessions WHERE user_id = $1`
 *      in the same request as setting disabled_at -- so a disabled user
 *      with a surviving session row is inconsistent with that action's
 *      own contract. Auto-fixable: delete those sessions (exactly what
 *      the disable action itself already does).
 *
 *   2. stripe_subscription_id IS NOT NULL but stripe_customer_id IS
 *      NULL. Every write in app/api/v3/webhooks/stripe/route.ts that
 *      sets stripe_subscription_id sets stripe_customer_id in the same
 *      statement -- you cannot have a Stripe subscription without a
 *      Stripe customer. needs-human: recovering the correct customer id
 *      means looking it up in Stripe, not guessing.
 *
 *   3. subscription_status looks active (active/trialing/past_due) but
 *      stripe_subscription_id IS NULL, AND the user has no currently
 *      active row in gifted_subscriptions (lib/billing/billing.ts shows
 *      gifted subscriptions legitimately produce an "active-looking"
 *      state with no Stripe subscription at all, so that case is
 *      explicitly excluded to avoid a false positive). needs-human:
 *      could be genuine corruption or a gift that expired without the
 *      status being reset -- both need a person to decide.
 */

async function tableHasColumns(ctx, table, columns) {
  if (!ctx.tables.has(table)) return false;
  const cols = new Set((ctx.columnsDetailed[table] || []).map((c) => c.name));
  return columns.every((c) => cols.has(c));
}

/**
 * @param {{query: Function}} pool
 * @param {{tables: Set<string>, columnsDetailed: object, primaryKeys: object}} ctx
 * @returns {Promise<{findings: import('./_lib.corruption-orchestrator.mjs').Finding[], meta: object}>}
 */
export async function diagnose(pool, ctx) {
  const findings = [];

  // --- 1. disabled users with a surviving session row ---
  if (
    (await tableHasColumns(ctx, "users", ["id", "disabled_at"])) &&
    (await tableHasColumns(ctx, "sessions", ["user_id"]))
  ) {
    const where = `EXISTS (SELECT 1 FROM users u WHERE u.id = s.user_id AND u.disabled_at IS NOT NULL)`;
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS n FROM sessions s WHERE ${where}`,
    );
    const count = countRes.rows[0]?.n ?? 0;
    if (count > 0) {
      const sampleRes = await pool.query(
        `SELECT s.user_id AS pk FROM sessions s WHERE ${where} LIMIT 5`,
      );
      findings.push({
        category: "cross_column",
        severity: "auto-fixable",
        table: "sessions",
        column: "user_id",
        description: `${count} session row(s) belong to a disabled user (disabled_at IS NOT NULL). The disable action itself already deletes sessions in the same request (app/api/v3/admin/route.ts) -- finishing that cleanup is not a guess.`,
        count,
        examples: sampleRes.rows.map((r) => ({ pk: r.pk })),
        repair: {
          sql: `DELETE FROM sessions s WHERE ${where}`,
          params: [],
          description: `Delete ${count} session row(s) belonging to disabled users.`,
        },
      });
    }
  }

  // --- 2. subscription id without a customer id ---
  if (
    await tableHasColumns(ctx, "users", [
      "id",
      "stripe_subscription_id",
      "stripe_customer_id",
    ])
  ) {
    const where = `stripe_subscription_id IS NOT NULL AND stripe_customer_id IS NULL`;
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS n FROM users WHERE ${where}`,
    );
    const count = countRes.rows[0]?.n ?? 0;
    if (count > 0) {
      const sampleRes = await pool.query(
        `SELECT id AS pk FROM users WHERE ${where} LIMIT 5`,
      );
      findings.push({
        category: "cross_column",
        severity: "needs-human",
        table: "users",
        column: "stripe_customer_id",
        description: `${count} user(s) have a stripe_subscription_id but no stripe_customer_id, which the webhook handler never writes independently (app/api/v3/webhooks/stripe/route.ts always sets both together). Recovering the correct customer id requires a Stripe lookup, not a guess.`,
        count,
        examples: sampleRes.rows.map((r) => ({ pk: r.pk })),
      });
    }
  }

  // --- 3. active-looking subscription with no Stripe subscription id ---
  if (
    (await tableHasColumns(ctx, "users", [
      "id",
      "subscription_status",
      "stripe_subscription_id",
    ])) &&
    ctx.tables.has("gifted_subscriptions")
  ) {
    const hasGift = `EXISTS (
      SELECT 1 FROM gifted_subscriptions g
      WHERE g.user_id = u.id AND g.revoked_at IS NULL AND g.expires_at > NOW()
    )`;
    const where = `u.subscription_status IN ('active', 'trialing', 'past_due') AND u.stripe_subscription_id IS NULL AND NOT ${hasGift}`;
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS n FROM users u WHERE ${where}`,
    );
    const count = countRes.rows[0]?.n ?? 0;
    if (count > 0) {
      const sampleRes = await pool.query(
        `SELECT u.id AS pk, u.subscription_status AS value FROM users u WHERE ${where} LIMIT 5`,
      );
      findings.push({
        category: "cross_column",
        severity: "needs-human",
        table: "users",
        column: "subscription_status",
        description: `${count} user(s) have an active-looking subscription_status with no stripe_subscription_id and no currently-active gifted subscription. Could be a stale status after a subscription ended without the webhook firing, or a gift that expired without resetting the status -- needs a person to check the account's real Stripe/billing history.`,
        count,
        examples: sampleRes.rows.map((r) => ({ pk: r.pk, detail: r.value })),
      });
    }
  }

  return { findings, meta: {} };
}
