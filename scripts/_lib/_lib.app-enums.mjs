/**
 * VulnRadar — Application-level enum columns (no DB CHECK constraint).
 *
 * Some status-shaped columns are already enforced by a Postgres CHECK
 * constraint (see _lib.schema-introspect.mjs's getCheckConstraintEnums,
 * which finds those generically). The columns below have NO such
 * constraint -- the only thing keeping them to a known set of values is
 * application code, which means a typo in some old/removed code path, or
 * a hand-run UPDATE, could leave a value the current app doesn't
 * recognize. This is exactly the corruption mode a DB-level CHECK
 * constraint would have prevented.
 *
 * Every entry below cites the real source of truth it was read from.
 * tests/scripts/_lib.app-enums.test.ts cross-checks the ones backed by a
 * real exported TS constant (STAFF_ROLES, BILLING_PLAN_LIMITS, TEAM_ROLES)
 * against that constant directly, so drift fails a test. Stripe's
 * Subscription.Status is a type (erased at runtime), not a value, so it
 * cannot be cross-checked the same way -- see the comment on that entry.
 */
export const APP_ENUM_COLUMNS = [
  {
    table: "users",
    column: "role",
    nullable: false,
    values: ["user", "support", "moderator", "admin", "super_admin"],
    source: "lib/config/client-constants.ts STAFF_ROLES",
  },
  {
    table: "users",
    column: "plan",
    // NULL/'free' both mean "no paid plan" in practice (billing.ts falls
    // back to "free" when the column is falsy), so NULL is not corruption.
    nullable: true,
    values: ["free", "core_supporter", "pro_supporter", "elite_supporter"],
    source: "lib/config/constants.ts BILLING_PLAN_LIMITS keys (+ 'free')",
  },
  {
    table: "users",
    column: "subscription_status",
    nullable: true,
    values: [
      "active",
      "canceled",
      "incomplete",
      "incomplete_expired",
      "past_due",
      "paused",
      "trialing",
      "unpaid",
    ],
    // Written verbatim from Stripe's own `subscription.status` field (see
    // app/api/v3/webhooks/stripe/route.ts) plus the app's own literal
    // 'active'/'canceled'/'past_due' assignments. Sourced from the
    // installed `stripe` package's Subscription.Status union
    // (node_modules/stripe/cjs/resources/Subscriptions.d.ts) at the time
    // this list was written. A `stripe` package upgrade could add a new
    // status value; unlike the other entries, this one cannot be
    // cross-checked at test time (TS types don't exist at runtime), so a
    // stale list here degrades gracefully to a false "needs-human" flag
    // on a legitimate new Stripe status, never a silent miss of real
    // corruption in the other direction.
    source:
      "Stripe.Subscription.Status (node_modules/stripe types) + app/api/v3/webhooks/stripe/route.ts",
  },
  {
    table: "users",
    column: "two_factor_method",
    nullable: true, // NULL means 2FA disabled
    values: ["app", "email"],
    source: "app/api/v3/auth/2fa/setup/route.ts + email-setup/route.ts",
  },
  {
    table: "team_members",
    column: "role",
    nullable: false,
    values: ["owner", "admin", "member", "viewer"],
    source: "lib/config/constants.ts TEAM_ROLES",
  },
];
