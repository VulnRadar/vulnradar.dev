/**
 * v2.0.0 → v3.0.0 — Squashed migration (production schema).
 *
 * This file used to be "v2.0.0 → v3.0.0 (AI chat + security hardening)"
 * only. It now carries the NET effect of an entire unreleased development
 * tail that used to be numbered 3.0.0 through 5.9.0 as separate schema
 * versions. None of those versions ever reached production (the live
 * database has never gone past v2.3.2), so there is no reason for a
 * production upgrade path to walk through nine intermediate schema
 * bumps — it goes straight from the real v2.0.0 production shape to the
 * final v3.0.0 shape in one step. Going forward, schema version tracks
 * the app's major version (no more "5.9.0 schema for a 3.0.0 app").
 *
 * What this upgrade adds, combining what were previously separately
 * numbered versions:
 *   - AI chat: `ai_conversations` (was v3.0.0).
 *   - Browser session ownership: `browser_sessions` (was v3.0.0).
 *   - Security hardening: `users.unsubscribe_token`,
 *     `users.totp_last_counter`, `scan_history.share_token_hash`
 *     (generated column), `billing_verification_codes.salt` (was v3.0.0).
 *   - Scanner learning: `scan_finding_feedback` for false-positive
 *     tracking (was v4.0.0).
 *   - Background scan jobs: `scan_history.status` /
 *     `current_category` / `categories_completed` / `categories_total` /
 *     `started_at` / `error_message` / `result_meta` so a scan can run as
 *     a pollable, cancellable job (was v5.2.0).
 *   - Authenticated scanning: `scan_history.authenticated` (was v5.0.0).
 *     NOTE: the v5.0.0-era `scan_credentials` credential vault and
 *     `scan_history.credential_id` are intentionally NOT part of this
 *     upgrade — that table was added and then fully removed later in the
 *     same unreleased tail (v5.5.0) in favor of fully ephemeral
 *     authenticated scanning (login material is used in-memory for one
 *     request and never persisted; see lib/scanner/auth/). Production
 *     never had the vault, so this migration never creates it.
 *   - IP binding: `api_keys.bound_ip` (was v5.4.0).
 *   - super_admin role tier: idempotent data backfill designating the
 *     earliest-created user (MIN(id)) as `super_admin` (was v5.6.0).
 *   - Host reputation cache: `host_reputation`, keyed by host with no
 *     user_id, for the browser extension's popup (was v5.7.0).
 *   - OAuth signup/login: `users.auth_provider` and a nullable
 *     `users.password_hash`, backfilled to 'password' for every existing
 *     row (was v5.8.0).
 *   - GitHub repo connection + AI code review: `github_connections`,
 *     `github_review_usage`, and `scan_history.scan_type` (was v5.9.0).
 *
 * Performance indexes added along the way (composite indexes for
 * dashboard history, API-key rate limiting, and the admin activity
 * panel; was v5.1.0) are folded into `addIndexes` below.
 *
 * AUDIT-009 migration-01 fix: this file originally only carried the 7
 * tables/15 columns from the fingerprint above, but instrumentation.ts
 * (the live, boot-time schema) had grown 4 more tables and ~25 more
 * columns on top of that same v2.0.0 base that this file never picked
 * up -- meaning `db:migrate` alone left an existing database claiming
 * schema_version=3.0.0 while actually missing real tables/columns, with
 * only the app's own next boot (instrumentation.ts) able to fill the
 * gap. Added below to close that gap for good:
 *   - `processed_stripe_events`, `user_ai_configs` (+ its `ai_disabled`
 *     column), `cve_kev_cache`, `webhook_deliveries` tables.
 *   - `api_keys.scopes`; `users.ai_chat_banned`, the Google/GitHub/
 *     Discord account-linking columns on `users`,
 *     `users.scans_private_by_default`; `scan_history.share_expires_at`
 *     and `scan_history.is_public`; `broadcast_messages.sent_by`;
 *     `scheduled_scans.preferred_hour_utc` /
 *     `preferred_day_of_week` / `preferred_day_of_month`;
 *     `webhooks.secret`; `host_reputation.findings` /
 *     `response_headers` / `result_meta` / `authenticated` /
 *     `scanned_url`.
 *   - `idx_scan_history_url_public_completed`.
 * Every addition below is copied verbatim (type, default, nullability)
 * from instrumentation.ts, and every one has a matching downgrade step.
 *
 * Unified AI usage tracking: `ai_usage`, keyed by a fixed window (see
 * lib/billing/ai-usage.ts and instrumentation.ts's own comment on this
 * table for the full rationale). v3.0.0 has never shipped to any real
 * database (production is still on v2.3.2 -- see this file's own header
 * comment), so this table is folded directly into the same squashed
 * v2.0.0 -> v3.0.0 step rather than minting a new schema version for it,
 * exactly like the AUDIT-009 fix above did for the 4 tables it added.
 *
 * GitHub review usage cadence change: `github_review_usage` above was
 * originally keyed by a calendar-month `year_month` column, on its own
 * independent cadence from `ai_usage`. It now shares `ai_usage`'s exact
 * fixed AI_USAGE_WINDOW_HOURS window instead, keyed by `window_start`
 * (see lib/billing/github-review-usage.ts, which imports
 * currentWindowStart/resolveCurrentWindow directly from
 * lib/billing/ai-usage.ts rather than duplicating the bucketing math).
 * Since this table has never shipped either, GITHUB_REVIEW_USAGE_SQL
 * above creates it directly without year_month; the dataUpdates entries
 * near the end of this upgrade handle the ALTER path for a database that
 * already ran this exact migration bucket back when it still had
 * year_month, dropping that column and its unique constraint/index and
 * adding the window_start-keyed equivalents -- a total no-op on a
 * database that only ever saw the window_start shape. Token AMOUNTS are
 * unchanged; only the reset cadence and the githubReviewTokensPerMonth ->
 * githubReviewTokensPerWindow field/setting names changed.
 *
 * System error logs: `system_error_logs`, the store behind Admin > System
 * > Error Logs (see lib/database/error-log-capture.ts, which intercepts
 * console.error and writes here). Folded into this same squashed step for
 * the identical "schema v3.0.0 never shipped" reason as ai_usage above.
 *
 * Auto tags: `scan_tags.source`, distinguishing a tag lib/tags/auto-tags.ts
 * derives deterministically from a scan's own findings ('auto') from one a
 * user typed in ('user'). `scan_tags` itself is a v1 table already in
 * production; this is an additive column on top of it, folded into this
 * same squashed step for the identical "schema v3.0.0 never shipped"
 * reason as ai_usage and system_error_logs above.
 *
 * Auto tag dismissals: `auto_tag_dismissals`, a durable log of a user
 * telling us one specific auto tag was wrong on one specific scan (see
 * app/api/v3/scan/tags/route.ts's "remove" branch, which now dismisses a
 * source='auto' scan_tags row instead of rejecting the request outright).
 * Powers Admin > Engine Feedback's per-auto-tag-rule dismissal rate
 * (app/api/v3/admin/engine-feedback/tags/route.ts). Folded into this same
 * squashed step for the identical "schema v3.0.0 never shipped" reason as
 * every other addition above.
 *
 * Public Scans directory: `scan_history.share_publicly_listed` and
 * `users.share_publicly_listed_by_default` -- an independent privacy
 * mechanism from `scan_history.is_public` (the host_reputation / public
 * /host/[hostname] flag, untouched by this feature). Powers the
 * unauthenticated /public-scans directory (app/api/v3/public-scans/
 * route.ts): a share is listed there only when its own
 * share_publicly_listed is true, which is decided once, at the moment a
 * NEW share link is created (see lib/scanner/share-privacy.ts's
 * resolveSharePubliclyListed and app/api/v3/history/[id]/share/route.ts's
 * POST handler), by the same "explicit per-call value wins, else the
 * account default" shape as resolveScanIsPublic above -- except this one
 * fails closed to NOT listing on a lookup error, the more conservative
 * choice for a feature whose whole point is public exposure.
 * users.share_publicly_listed_by_default defaults to true (unlike
 * scans_private_by_default's false) so a NEW share reads as "on unless you
 * turn it off," matching the product decision for this feature --
 * scan_history.share_publicly_listed itself defaults to false, on
 * purpose, a different call: see that column's own comment below for why
 * (defaulting it to true would retroactively publish every scan anyone
 * had already shared under the old, pre-directory link-only model).
 * Folded into this same squashed step for the identical "schema v3.0.0
 * never shipped" reason as every other addition above.
 *
 * Staff plan grant/revoke: `users.pre_staff_plan` -- a real, non-Stripe
 * `users.plan` change now accompanies a staff role transition instead of
 * the old "staff bypasses every quota" behavior (see lib/rate-limiting/
 * daily-limits.ts and lib/billing/plan-limits.ts for the dynamic-limits
 * side of this, which stays as a safety net regardless). On promotion to
 * a staff role (admin/moderator/support), a user on free/core_supporter/
 * pro_supporter is bumped to pro_supporter for real, with their prior
 * plan saved in pre_staff_plan (only the first time -- see
 * lib/billing/staff-plan.ts) so it can be restored the instant they lose
 * staff. A user already above Pro (elite_supporter) keeps it untouched
 * and pre_staff_plan stays NULL. This upgrade also backfills every
 * EXISTING staff account the same way (dataUpdates below), since the
 * column-add alone only affects future role changes. Folded into this
 * same squashed step for the identical "schema v3.0.0 never shipped"
 * reason as every other addition above.
 *
 * Reversible: see the `downgrade` export. NOTE: the downgrade does NOT
 * restore pre_staff_plan back into `plan` before dropping the column --
 * consistent with every other precedent in this file's downgrade (see
 * its own description), it accepts that as data loss rather than trying
 * to reorder around _planner.mjs's fixed addColumns-before-dataUpdates /
 * dropColumns-before-dataUpdates step ordering, which would make a
 * pre-drop restore step awkward to express safely.
 *
 * One-time AI credit purchases: `users.ai_credit_balance` -- a purchased
 * AI verification token balance, bought via a real one-time Stripe
 * PaymentIntent (mode: "payment", never "subscription"; see
 * app/actions/stripe.ts's createAiCreditPaymentIntent and
 * lib/billing/ai-credit-catalog.ts's tier list), confirmed through Stripe
 * Elements on app/checkout/credits/page.tsx, and credited once payment
 * clears (see lib/billing/ai-usage.ts's creditAiCreditPurchase, called from
 * both confirmAiCreditPurchase and the webhook's payment_intent.succeeded
 * handler -- see the ai_credit_purchases table below for how the two are
 * kept from double-crediting the same purchase). Unlike the ai_usage
 * window counter above, this balance is NEVER reset by the window -- it is
 * spent (see lib/billing/ai-usage.ts's recordAiTokens) only as a fallback
 * once the plan's free aiTokensPerWindow allowance is exhausted for the
 * current window, so a purchase is a durable top-up, not another
 * per-window allowance. A single BIGINT column, not a ledger table: every
 * credit and every spend is one atomic UPDATE (a plain `+` on credit, a
 * `GREATEST(..., 0)` floor on spend), so the running balance stays
 * correct under concurrent AI verification calls without needing a
 * transaction or row-level locking; processed_stripe_events (already
 * added above) is what keeps a replayed DELIVERY of the same webhook event
 * from crediting twice. Folded into this same squashed step for the
 * identical "schema v3.0.0 never shipped" reason as every other addition
 * above.
 *
 * AI credit purchase idempotency ledger: `ai_credit_purchases` -- a
 * one-time AI credit purchase (see `users.ai_credit_balance` above) can now
 * be credited by either of TWO independent code paths: the fast/primary
 * path (app/actions/stripe.ts's confirmAiCreditPurchase, called the instant
 * the client confirms payment on app/checkout/credits/page.tsx) or the
 * Stripe webhook's payment_intent.succeeded handler (the backup path for a
 * closed tab / lost connection). Since crediting the balance is a running
 * `+` (see lib/billing/ai-usage.ts's addAiCreditBalance), NOT idempotent
 * the way the subscription flow's plan UPDATE is, both paths reaching it
 * for the same PaymentIntent would double-credit the user --
 * processed_stripe_events only dedupes a REPEATED DELIVERY of the same
 * webhook event, it does nothing to stop these two DIFFERENT code paths
 * from each crediting once. This table is the real guard: keyed by Stripe
 * PaymentIntent id (PRIMARY KEY, so a second INSERT for the same id is
 * rejected via ON CONFLICT DO NOTHING), it's inserted BEFORE
 * addAiCreditBalance is called, and addAiCreditBalance only runs when that
 * insert actually happened -- see lib/billing/ai-usage.ts's
 * creditAiCreditPurchase, the single shared function both callers go
 * through. Folded into this same squashed step for the identical "schema
 * v3.0.0 never shipped" reason as every other addition above.
 *
 * Promoted auto-tag rules: `promoted_auto_tag_rules` -- the admin-facing
 * half of the "AI generates a tag, and the system learns which ones keep
 * recurring" auto-tag design (see lib/tags/auto-tags.ts and lib/ai/
 * auto-tag-suggest.ts). lib/tags/auto-tags.ts's ~50 hardcoded
 * AUTO_TAG_RULES cover most of what the scanner detects; for a scan whose
 * findings match none of them, lib/ai/auto-tag-suggest.ts generates 1-2
 * specific tag names on the fly and saves them with `source = 'ai'` in
 * scan_tags. Admin > Engine Feedback's "AI Tag Candidates" panel
 * (app/api/v3/admin/engine-feedback/ai-tag-candidates/route.ts) surfaces
 * which of those AI-generated tags keep recurring across distinct scans,
 * and lets an admin "promote" one into a row in this table: the same
 * cwes/categories/requireBoth/minSeverity/minCount shape as the hardcoded
 * AutoTagRule type, so lib/tags/auto-tags.ts's computeAutoTags can merge
 * it in as a real, free, deterministic rule (no more AI calls for that
 * concept) without a deploy. Folded into this same squashed step for the
 * identical "schema v3.0.0 never shipped" reason as every other addition
 * above.
 */

import { V3_NEW_TABLES } from "./_snippets.mjs";

export const from = "2.0.0";
export const to = "3.0.0";

const SCAN_FINDING_FEEDBACK_SQL = `
  CREATE TABLE IF NOT EXISTS scan_finding_feedback (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    scan_history_id INTEGER REFERENCES scan_history(id) ON DELETE SET NULL,
    finding_id TEXT NOT NULL,
    finding_url TEXT NOT NULL,
    verdict TEXT NOT NULL CHECK (verdict IN ('confirmed', 'false_positive', 'not_applicable')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_finding_feedback_unique
    ON scan_finding_feedback (user_id, finding_id, finding_url);

  CREATE INDEX IF NOT EXISTS idx_scan_finding_feedback_finding_id
    ON scan_finding_feedback (finding_id, verdict);

  CREATE INDEX IF NOT EXISTS idx_scan_finding_feedback_user
    ON scan_finding_feedback (user_id, created_at DESC);
`;

const USER_NOTIFICATIONS_SQL = `
  CREATE TABLE IF NOT EXISTS user_notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    action_label VARCHAR(100),
    action_url VARCHAR(500),
    related_type VARCHAR(30),
    related_id INTEGER,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const HOST_REPUTATION_SQL = `
  CREATE TABLE IF NOT EXISTS host_reputation (
    host VARCHAR(255) PRIMARY KEY,
    danger_score INTEGER NOT NULL,
    severity_counts JSONB NOT NULL DEFAULT '{}',
    last_scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_scan_id INTEGER REFERENCES scan_history(id) ON DELETE SET NULL
  );
`;

// Stable per-(user_id, url) token for the auto-updating "Secured by
// VulnRadar" embed badge (app/badge/page.tsx) -- see instrumentation.ts's
// matching HOST BADGES comment for the full rationale. badge_token_hash
// (generated column, added via addColumns below) is what the public badge
// image route actually looks up by, same reason scan_history.share_token_hash
// exists: the plaintext token is never compared directly in the DB.
const HOST_BADGES_SQL = `
  CREATE TABLE IF NOT EXISTS host_badges (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    badge_token TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_host_badges_user_url
    ON host_badges (user_id, url);
`;

const GITHUB_CONNECTIONS_SQL = `
  CREATE TABLE IF NOT EXISTS github_connections (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    github_user_id BIGINT NOT NULL,
    github_username VARCHAR(255) NOT NULL,
    access_token_encrypted TEXT NOT NULL,
    scopes VARCHAR(255) NOT NULL DEFAULT '',
    connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    selected_repos JSONB NOT NULL DEFAULT '[]'::jsonb
  );
`;

// window_start (not year_month -- see this file's header comment on the
// github_review_usage cadence change) is added via dataUpdates below, not
// inline here: that keeps the unique constraint's creation in ONE place
// (the dataUpdates drop-then-add pair) instead of racing an inline
// CREATE TABLE constraint against a later ALTER on a database that already
// ran this migration with the old year_month shape.
const GITHUB_REVIEW_USAGE_SQL = `
  CREATE TABLE IF NOT EXISTS github_review_usage (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

// Unified AI usage tracking (chat/verify/summary) -- see instrumentation.ts's
// own comment on this table for the full rationale. No id column: the
// composite primary key IS the lookup every caller needs.
const AI_USAGE_SQL = `
  CREATE TABLE IF NOT EXISTS ai_usage (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    window_start TIMESTAMPTZ NOT NULL,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, window_start)
  );
`;

// SYSTEM ERROR LOGS - admin-visible capture of console.error calls (Admin >
// System > Error Logs, see lib/database/error-log-capture.ts). Same
// "unreleased, folded into this squashed step" reasoning as ai_usage above:
// added after v3.0.0's original 7 tables and the AUDIT-009 catch-up, but
// schema v3.0.0 has still never shipped to any real database, so it goes
// into this same upgrade step rather than minting a new schema version.
const SYSTEM_ERROR_LOGS_SQL = `
  CREATE TABLE IF NOT EXISTS system_error_logs (
    id SERIAL PRIMARY KEY,
    message TEXT NOT NULL,
    detail TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_system_error_logs_created_at
    ON system_error_logs(created_at DESC);
`;

// AUDIT-009 migration-01: the 4 tables below existed in instrumentation.ts
// but were never added to this file. Copied verbatim (incl. FKs, defaults,
// and each table's own CREATE INDEX statements).

const PROCESSED_STRIPE_EVENTS_SQL = `
  CREATE TABLE IF NOT EXISTS processed_stripe_events (
    event_id VARCHAR(255) PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    processed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_processed_stripe_events_processed_at
    ON processed_stripe_events(processed_at);
`;

const USER_AI_CONFIGS_SQL = `
  CREATE TABLE IF NOT EXISTS user_ai_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    use_vulnradar_ai BOOLEAN NOT NULL DEFAULT TRUE,
    provider VARCHAR(50),
    model_id VARCHAR(100),
    api_key_encrypted TEXT,
    base_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_user_ai_configs_user_id ON user_ai_configs(user_id);

  ALTER TABLE user_ai_configs
    ADD COLUMN IF NOT EXISTS ai_disabled BOOLEAN NOT NULL DEFAULT FALSE;
`;

const CVE_KEV_CACHE_SQL = `
  CREATE TABLE IF NOT EXISTS cve_kev_cache (
    cache_key VARCHAR(50) PRIMARY KEY,
    cve_ids JSONB NOT NULL,
    cached_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
  );
`;

const WEBHOOK_DELIVERIES_SQL = `
  CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id SERIAL PRIMARY KEY,
    webhook_id INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    http_status INTEGER,
    response_snippet TEXT,
    attempted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id
    ON webhook_deliveries(webhook_id, attempted_at DESC);
`;

// AUTO TAG DISMISSALS - see this file's header comment.
const AUTO_TAG_DISMISSALS_SQL = `
  CREATE TABLE IF NOT EXISTS auto_tag_dismissals (
    id SERIAL PRIMARY KEY,
    scan_id INTEGER NOT NULL REFERENCES scan_history(id) ON DELETE CASCADE,
    tag VARCHAR(50) NOT NULL,
    dismissed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(scan_id, tag)
  );

  CREATE INDEX IF NOT EXISTS idx_auto_tag_dismissals_tag
    ON auto_tag_dismissals(tag);
`;

// PROMOTED AUTO-TAG RULES - see this file's header comment. `cwes` and
// `categories` are JSONB string arrays (mirroring AutoTagRule's `readonly
// string[]` / `readonly Category[]` shape in lib/tags/auto-tags.ts), each
// nullable independently since a rule may key off either alone, but the
// CHECK below guards against a rule with neither (nothing for it to ever
// match). `tag` is UNIQUE: promoting the same AI-suggested tag text twice
// would otherwise silently double the rule set for one concept.
const PROMOTED_AUTO_TAG_RULES_SQL = `
  CREATE TABLE IF NOT EXISTS promoted_auto_tag_rules (
    id SERIAL PRIMARY KEY,
    tag VARCHAR(50) NOT NULL UNIQUE,
    cwes JSONB,
    categories JSONB,
    require_both BOOLEAN NOT NULL DEFAULT FALSE,
    min_severity VARCHAR(10) NOT NULL
      CHECK (min_severity IN ('info', 'low', 'medium', 'high', 'critical')),
    min_count INTEGER NOT NULL DEFAULT 1,
    source_ai_tag VARCHAR(50),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (cwes IS NOT NULL OR categories IS NOT NULL)
  );

  CREATE INDEX IF NOT EXISTS idx_promoted_auto_tag_rules_tag
    ON promoted_auto_tag_rules(tag);
`;

// AI CREDIT PURCHASE IDEMPOTENCY LEDGER - see this file's header comment.
// payment_intent_id is the Stripe PaymentIntent id (VARCHAR(255), matching
// processed_stripe_events.event_id's own convention for a Stripe object
// id) and doubles as the PRIMARY KEY: the guard IS the uniqueness
// constraint, an INSERT ... ON CONFLICT (payment_intent_id) DO NOTHING
// needs no separate index. tokens is BIGINT to match
// users.ai_credit_balance's own type.
const AI_CREDIT_PURCHASES_SQL = `
  CREATE TABLE IF NOT EXISTS ai_credit_purchases (
    payment_intent_id VARCHAR(255) PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tokens BIGINT NOT NULL,
    credited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const ASSIGN_SUPER_ADMIN_SQL = `
  UPDATE users
  SET role = 'super_admin'
  WHERE id = (SELECT MIN(id) FROM users)
    AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'super_admin');
`;

const REVERT_SUPER_ADMIN_SQL = `
  UPDATE users
  SET role = 'admin'
  WHERE role = 'super_admin';
`;

// Staff plan grant backfill -- see this file's header comment. Guarded by
// pre_staff_plan IS NULL so re-running this migration (or instrumentation.ts
// re-applying it on every boot) never overwrites an already-recorded
// original plan. super_admin is deliberately excluded: it's un-assignable
// through the admin panel (app/api/v3/admin/route.ts's set_role) and this
// mirrors the exact staff-role set lib/rate-limiting/daily-limits.ts's
// STAFF_ROLES already uses for the dynamic-limits resolver.
const BACKFILL_STAFF_PLAN_SQL = `
  UPDATE users
  SET pre_staff_plan = COALESCE(plan, 'free'), plan = 'pro_supporter'
  WHERE role IN ('admin', 'moderator', 'support')
    AND COALESCE(plan, 'free') IN ('free', 'core_supporter', 'pro_supporter')
    AND pre_staff_plan IS NULL;
`;

export const upgrade = {
  description:
    "Squashed v2.0.0 -> v3.0.0: ai_conversations, browser_sessions, " +
    "scan_finding_feedback, user_notifications, host_reputation, " +
    "host_badges (stable per-user-per-URL tokens for the auto-updating " +
    "embed badge), " +
    "github_connections, github_review_usage, processed_stripe_events, " +
    "user_ai_configs, cve_kev_cache, webhook_deliveries, ai_usage, " +
    "system_error_logs, auto_tag_dismissals tables; source on scan_tags; " +
    "unsubscribe_token, totp_last_counter, auth_provider, ai_chat_banned, " +
    "google_id, google_email, google_name, google_avatar_url, github_id, " +
    "github_email, github_name, github_avatar_url, discord_username, " +
    "discord_avatar_url, discord_email, scans_private_by_default on " +
    "users; share_token_hash, authenticated, status, current_category, " +
    "categories_completed, categories_total, started_at, error_message, " +
    "result_meta, scan_type, share_expires_at, is_public on scan_history; " +
    "salt on billing_verification_codes; bound_ip, scopes on api_keys; " +
    "sent_by on broadcast_messages; preferred_hour_utc, " +
    "preferred_day_of_week, preferred_day_of_month on scheduled_scans; " +
    "secret on webhooks; findings, response_headers, result_meta, " +
    "authenticated, scanned_url on host_reputation; share_publicly_listed " +
    "on scan_history and share_publicly_listed_by_default on users (Public " +
    "Scans directory, independent of is_public); pre_staff_plan on users " +
    "(staff plan grant/revoke); ai_credit_balance on users (one-time AI " +
    "credit purchases); ai_credit_purchases (idempotency ledger keyed by " +
    "Stripe PaymentIntent id, so confirmAiCreditPurchase and the " +
    "payment_intent.succeeded webhook can never both credit the same " +
    "purchase); promoted_auto_tag_rules (admin-promoted AI tag " +
    "candidates -> permanent deterministic rules); plus the super_admin " +
    "backfill, the nullable-password OAuth data migration, and the staff " +
    "plan grant backfill for every existing staff account. Does NOT " +
    "create scan_credentials: that table was added and removed within " +
    "this same unreleased tail (ephemeral authenticated scanning " +
    "replaced it), so production never sees it.",

  addTables: [
    { name: "ai_conversations", sql: V3_NEW_TABLES.ai_conversations },
    { name: "browser_sessions", sql: V3_NEW_TABLES.browser_sessions },
    { name: "scan_finding_feedback", sql: SCAN_FINDING_FEEDBACK_SQL },
    { name: "user_notifications", sql: USER_NOTIFICATIONS_SQL },
    { name: "host_reputation", sql: HOST_REPUTATION_SQL },
    { name: "host_badges", sql: HOST_BADGES_SQL },
    { name: "github_connections", sql: GITHUB_CONNECTIONS_SQL },
    { name: "github_review_usage", sql: GITHUB_REVIEW_USAGE_SQL },
    { name: "processed_stripe_events", sql: PROCESSED_STRIPE_EVENTS_SQL },
    { name: "user_ai_configs", sql: USER_AI_CONFIGS_SQL },
    { name: "cve_kev_cache", sql: CVE_KEV_CACHE_SQL },
    { name: "webhook_deliveries", sql: WEBHOOK_DELIVERIES_SQL },
    { name: "ai_usage", sql: AI_USAGE_SQL },
    { name: "system_error_logs", sql: SYSTEM_ERROR_LOGS_SQL },
    { name: "auto_tag_dismissals", sql: AUTO_TAG_DISMISSALS_SQL },
    { name: "promoted_auto_tag_rules", sql: PROMOTED_AUTO_TAG_RULES_SQL },
    { name: "ai_credit_purchases", sql: AI_CREDIT_PURCHASES_SQL },
  ],

  addColumns: [
    {
      table: "users",
      column: "unsubscribe_token",
      definition: "UUID DEFAULT gen_random_uuid()",
    },
    {
      table: "users",
      column: "totp_last_counter",
      definition: "BIGINT",
    },
    {
      table: "users",
      column: "auth_provider",
      definition: "VARCHAR(20)",
    },
    {
      table: "scan_history",
      column: "share_token_hash",
      // Stored generated column — Postgres computes and persists the
      // SHA-256 hex of share_token for every row (including existing
      // rows, which are back-filled automatically on ALTER TABLE).
      // sha256(bytea) is available without pgcrypto in PG 11+.
      definition:
        "TEXT GENERATED ALWAYS AS (encode(sha256(share_token::bytea), 'hex')) STORED",
    },
    {
      table: "scan_history",
      column: "authenticated",
      definition: "BOOLEAN NOT NULL DEFAULT false",
    },
    {
      table: "scan_history",
      column: "status",
      definition:
        "VARCHAR(20) NOT NULL DEFAULT 'completed' " +
        "CHECK (status IN ('pending', 'running', 'completed', 'failed'))",
    },
    {
      table: "scan_history",
      column: "current_category",
      definition: "VARCHAR(30)",
    },
    {
      table: "scan_history",
      column: "categories_completed",
      definition: "INTEGER NOT NULL DEFAULT 0",
    },
    {
      table: "scan_history",
      column: "categories_total",
      definition: "INTEGER NOT NULL DEFAULT 0",
    },
    {
      table: "scan_history",
      column: "started_at",
      definition: "TIMESTAMP WITH TIME ZONE",
    },
    {
      table: "scan_history",
      column: "error_message",
      definition: "TEXT",
    },
    {
      table: "scan_history",
      column: "result_meta",
      definition: "JSONB",
    },
    {
      table: "scan_history",
      column: "scan_type",
      definition: "VARCHAR(20) NOT NULL DEFAULT 'web'",
    },
    {
      table: "billing_verification_codes",
      column: "salt",
      definition: "TEXT",
    },
    {
      table: "api_keys",
      column: "bound_ip",
      definition: "VARCHAR(45)",
    },
    // AUDIT-009 migration-01: everything below was in instrumentation.ts
    // but missing from this file.
    {
      table: "api_keys",
      column: "scopes",
      // Deliberately nullable with NO default -- see instrumentation.ts's
      // comment on this same column. NULL means "predates scoping" and is
      // treated as full access everywhere a scope is checked; a DEFAULT
      // would backfill '[]' onto every existing key and silently revoke
      // every capability from every key ever issued.
      definition: "JSONB",
    },
    {
      table: "users",
      column: "ai_chat_banned",
      definition: "BOOLEAN NOT NULL DEFAULT FALSE",
    },
    {
      table: "users",
      column: "google_id",
      definition: "VARCHAR(64) UNIQUE",
    },
    {
      table: "users",
      column: "google_email",
      definition: "VARCHAR(255)",
    },
    {
      table: "users",
      column: "google_name",
      definition: "VARCHAR(255)",
    },
    {
      table: "users",
      column: "google_avatar_url",
      definition: "TEXT",
    },
    {
      table: "users",
      column: "github_id",
      definition: "VARCHAR(64) UNIQUE",
    },
    {
      table: "users",
      column: "github_email",
      definition: "VARCHAR(255)",
    },
    {
      table: "users",
      column: "github_name",
      definition: "VARCHAR(255)",
    },
    {
      table: "users",
      column: "github_avatar_url",
      definition: "TEXT",
    },
    {
      table: "users",
      column: "discord_username",
      definition: "VARCHAR(100)",
    },
    {
      table: "users",
      column: "discord_avatar_url",
      definition: "TEXT",
    },
    {
      table: "users",
      column: "discord_email",
      definition: "VARCHAR(255)",
    },
    {
      table: "users",
      column: "scans_private_by_default",
      definition: "BOOLEAN NOT NULL DEFAULT false",
    },
    {
      table: "scan_history",
      column: "share_expires_at",
      definition: "TIMESTAMP WITH TIME ZONE",
    },
    {
      table: "scan_history",
      column: "is_public",
      definition: "BOOLEAN NOT NULL DEFAULT true",
    },
    {
      table: "broadcast_messages",
      column: "sent_by",
      definition: "INTEGER REFERENCES users(id)",
    },
    {
      table: "scheduled_scans",
      column: "preferred_hour_utc",
      definition:
        "SMALLINT NOT NULL DEFAULT 0 CHECK (preferred_hour_utc BETWEEN 0 AND 23)",
    },
    {
      table: "scheduled_scans",
      column: "preferred_day_of_week",
      definition:
        "SMALLINT NOT NULL DEFAULT 1 CHECK (preferred_day_of_week BETWEEN 0 AND 6)",
    },
    {
      table: "scheduled_scans",
      column: "preferred_day_of_month",
      definition:
        "SMALLINT NOT NULL DEFAULT 1 CHECK (preferred_day_of_month BETWEEN 1 AND 28)",
    },
    {
      table: "webhooks",
      column: "secret",
      definition:
        "TEXT DEFAULT (replace(gen_random_uuid()::text, '-', '') || " +
        "replace(gen_random_uuid()::text, '-', ''))",
    },
    {
      table: "host_reputation",
      column: "findings",
      definition: "JSONB NOT NULL DEFAULT '[]'",
    },
    {
      table: "host_reputation",
      column: "response_headers",
      definition: "JSONB",
    },
    {
      table: "host_reputation",
      column: "result_meta",
      definition: "JSONB NOT NULL DEFAULT '{}'",
    },
    {
      table: "host_reputation",
      column: "authenticated",
      definition: "BOOLEAN NOT NULL DEFAULT FALSE",
    },
    {
      table: "host_reputation",
      column: "scanned_url",
      definition: "TEXT",
    },
    {
      table: "host_badges",
      column: "badge_token_hash",
      // Stored generated column, same pattern as scan_history.share_token_hash
      // above -- computed and persisted for every row, back-filled
      // automatically on ALTER TABLE for any pre-existing row.
      definition:
        "TEXT GENERATED ALWAYS AS (encode(sha256(badge_token::bytea), 'hex')) STORED",
    },
    // Auto tags (lib/tags/auto-tags.ts) -- see this file's header comment.
    // Defaults to 'user' so every scan_tags row that predates this column
    // (every row on any real database, v3.0.0 never having shipped) keeps
    // its current meaning: a tag a person typed in. 'ai' added alongside
    // 'auto'/'user' for lib/ai/auto-tag-suggest.ts's fallback tags -- see
    // the dataUpdates entries below that widen this same constraint on a
    // database that already ran this migration bucket before 'ai' existed
    // (ADD COLUMN IF NOT EXISTS is a no-op once the column is already
    // there, so this definition string alone only reaches a fresh install).
    {
      table: "scan_tags",
      column: "source",
      definition:
        "VARCHAR(10) NOT NULL DEFAULT 'user' CHECK (source IN ('auto', 'user', 'ai'))",
    },
    // Public Scans directory (see this file's header comment). Only
    // meaningful once share_token is set -- a scan that was never shared
    // has no listing to show either way.
    //
    // DEFAULT false, not true: this ADD COLUMN backfills EVERY existing
    // row, including scans shared under the old "only someone with the
    // link can see it" model, long before a public directory existed.
    // A DEFAULT true here would silently publish every one of those to
    // the new unauthenticated /public-scans directory the instant this
    // migration runs, with no re-consent. The app itself never relies on
    // this column default for a real share: app/api/v3/history/[id]/
    // share/route.ts's POST handler always writes share_publicly_listed
    // explicitly (resolveSharePubliclyListed's resolved value), so
    // DEFAULT false here only ever affects pre-existing rows this
    // migration backfills, never a share the app creates going forward.
    {
      table: "scan_history",
      column: "share_publicly_listed",
      definition: "BOOLEAN NOT NULL DEFAULT false",
    },
    // Account-level default for the column above -- see this file's
    // header comment. Defaults to true, unlike scans_private_by_default's
    // false, per the product decision for this feature.
    {
      table: "users",
      column: "share_publicly_listed_by_default",
      definition: "BOOLEAN NOT NULL DEFAULT true",
    },
    // Staff plan grant/revoke -- see this file's header comment. Nullable,
    // no default: NULL means "no staff-granted plan change is on record for
    // this user" (either never staff, or already above Pro when promoted).
    {
      table: "users",
      column: "pre_staff_plan",
      definition: "VARCHAR(50)",
    },
    // One-time AI credit purchases -- see this file's header comment.
    // NOT NULL DEFAULT 0 so every existing row starts with an empty
    // balance rather than NULL, matching ai_usage.tokens_used's own
    // "NOT NULL DEFAULT 0" counter convention.
    {
      table: "users",
      column: "ai_credit_balance",
      definition: "BIGINT NOT NULL DEFAULT 0",
    },
    // Free-plan (or any plan with githubReviewTokensPerWindow=0) daily
    // GitHub AI review trial -- see lib/billing/github-review-usage.ts's
    // hasUsedFreeGithubReviewToday/markFreeGithubReviewUsed. Deliberately
    // NOT part of the PlanLimits/catalog.ts system: it never appears on
    // the pricing page, it's a hidden taste-then-upsell mechanic layered
    // in front of the real (0-token) quota, not a real entitlement.
    // Nullable, no default: NULL means "never used the trial."
    {
      table: "users",
      column: "free_github_review_used_at",
      definition: "TIMESTAMPTZ",
    },
  ],

  addIndexes: [
    {
      name: "idx_ai_conversations_user_id",
      table: "ai_conversations",
      columns: "user_id",
    },
    {
      name: "idx_ai_conversations_created_at",
      table: "ai_conversations",
      columns: "created_at DESC",
    },
    {
      name: "idx_ai_conversations_session_id",
      table: "ai_conversations",
      columns: "session_id",
    },
    {
      name: "idx_browser_sessions_user_id",
      table: "browser_sessions",
      columns: "user_id",
    },
    {
      name: "idx_scan_history_share_token_hash",
      table: "scan_history",
      columns: "share_token_hash",
      where: "share_token_hash IS NOT NULL",
    },
    {
      name: "idx_scan_history_user_scanned",
      table: "scan_history",
      columns: "user_id, scanned_at DESC",
    },
    {
      name: "idx_api_usage_key_used",
      table: "api_usage",
      columns: "api_key_id, used_at",
    },
    {
      name: "idx_admin_audit_admin_created",
      table: "admin_audit_log",
      columns: "admin_id, created_at DESC",
    },
    {
      name: "idx_admin_audit_target_user",
      table: "admin_audit_log",
      columns: "target_user_id",
      where: "target_user_id IS NOT NULL",
    },
    {
      name: "idx_scan_history_status_pending_running",
      table: "scan_history",
      columns: "status",
      where: "status IN ('pending', 'running')",
    },
    {
      name: "idx_user_notifications_user_unread",
      table: "user_notifications",
      columns: "user_id, created_at DESC",
      where: "read_at IS NULL",
    },
    {
      name: "idx_user_notifications_related",
      table: "user_notifications",
      columns: "related_type, related_id",
      where: "related_type IS NOT NULL",
    },
    {
      name: "idx_host_reputation_last_scanned",
      table: "host_reputation",
      columns: "last_scanned_at",
    },
    {
      name: "idx_github_connections_user",
      table: "github_connections",
      columns: "user_id",
    },
    {
      name: "idx_github_connections_github_user_id",
      table: "github_connections",
      columns: "github_user_id",
    },
    // github_review_usage's index is created via dataUpdates below (see
    // this file's header comment) instead of here, alongside the
    // window_start column and its unique constraint -- CREATE INDEX
    // IF NOT EXISTS here would run before dataUpdates adds window_start
    // to a database migrating up from the old year_month shape, erroring
    // on a column that doesn't exist yet at this point in the step order.
    // AUDIT-009 migration-01: missing from this file. Depends on
    // scan_history.is_public (added above) and .status (added by the
    // original migration).
    {
      name: "idx_scan_history_url_public_completed",
      table: "scan_history",
      columns: "url",
      where: "is_public = true AND status = 'completed'",
    },
    {
      name: "idx_host_badges_token_hash",
      table: "host_badges",
      columns: "badge_token_hash",
      where: "badge_token_hash IS NOT NULL",
    },
  ],

  dataUpdates: [
    {
      sql: ASSIGN_SUPER_ADMIN_SQL,
      label:
        "UPDATE users SET role='super_admin' WHERE id = MIN(id) (idempotent, guarded by NOT EXISTS)",
      destructive: false,
    },
    {
      sql: "ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL",
      label: "ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL",
      destructive: false,
    },
    {
      sql: "UPDATE users SET auth_provider = 'password' WHERE auth_provider IS NULL",
      label: "Backfill auth_provider = 'password' for every existing row",
      destructive: false,
    },
    {
      sql: BACKFILL_STAFF_PLAN_SQL,
      label:
        "Backfill pre_staff_plan + plan='pro_supporter' for every existing " +
        "admin/moderator/support account on free/core/pro (idempotent, " +
        "guarded by pre_staff_plan IS NULL)",
      destructive: false,
    },
    // scan_tags.source's CHECK constraint above only reaches a database
    // running this migration for the first time (ADD COLUMN IF NOT EXISTS
    // no-ops once the column already exists). A database that already had
    // this column before 'ai' was added to the taxonomy is stuck on the
    // old ('auto', 'user') constraint until it's explicitly widened here.
    // Both statements are plain idempotent DDL: DROP...IF EXISTS is a
    // no-op if already dropped, and re-adding the same constraint name is
    // safe to run every migration pass.
    {
      sql: "ALTER TABLE scan_tags DROP CONSTRAINT IF EXISTS scan_tags_source_check",
      label: "Drop the old 2-value scan_tags_source_check constraint",
      destructive: false,
    },
    {
      sql: "ALTER TABLE scan_tags ADD CONSTRAINT scan_tags_source_check CHECK (source IN ('auto', 'user', 'ai'))",
      label: "Re-add scan_tags_source_check widened to allow source = 'ai'",
      destructive: false,
    },
    // broadcast_messages.created_by was created NOT NULL with no ON DELETE
    // clause (default RESTRICT) -- a staff account that ever created a
    // broadcast could not be deleted at all (admin-initiated OR
    // self-service), the delete failing on an unhandled FK violation
    // partway through. Every other user-referencing column this deletion
    // path touches (admin_audit_log.target_user_id, security_alerts.
    // resolved_by, system_settings.updated_by) already tolerates this via
    // nullability + ON DELETE SET NULL; bring this one in line. Both
    // statements are safe to run on every boot: DROP CONSTRAINT IF EXISTS
    // no-ops if already dropped, and re-adding the same constraint name
    // with the same definition is idempotent.
    {
      sql: "ALTER TABLE broadcast_messages ALTER COLUMN created_by DROP NOT NULL",
      label:
        "ALTER TABLE broadcast_messages ALTER COLUMN created_by DROP NOT NULL",
      destructive: false,
    },
    {
      sql: "ALTER TABLE broadcast_messages DROP CONSTRAINT IF EXISTS broadcast_messages_created_by_fkey",
      label: "Drop the old RESTRICT-mode broadcast_messages.created_by FK",
      destructive: false,
    },
    {
      sql: "ALTER TABLE broadcast_messages ADD CONSTRAINT broadcast_messages_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL",
      label: "Re-add broadcast_messages.created_by FK with ON DELETE SET NULL",
      destructive: false,
    },
    // github_review_usage: year_month -> window_start (see this file's
    // header comment). ADD COLUMN IF NOT EXISTS is a no-op on a database
    // that only ever saw the window_start-shaped GITHUB_REVIEW_USAGE_SQL
    // above; the DROP CONSTRAINT/DROP COLUMN pair below are no-ops too on
    // that same fresh database (there is no year_month to drop). Only a
    // database that already ran this migration bucket back when
    // GITHUB_REVIEW_USAGE_SQL still created year_month does real work
    // here.
    {
      sql: "ALTER TABLE github_review_usage ADD COLUMN IF NOT EXISTS window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()",
      label:
        "ALTER TABLE github_review_usage ADD COLUMN window_start (for a database that already ran this migration with the old year_month shape)",
      destructive: false,
    },
    {
      sql: "ALTER TABLE github_review_usage DROP CONSTRAINT IF EXISTS github_review_usage_user_id_year_month_key",
      label: "Drop the old (user_id, year_month) unique constraint",
      destructive: false,
    },
    {
      sql: "ALTER TABLE github_review_usage DROP COLUMN IF EXISTS year_month",
      label: "ALTER TABLE github_review_usage DROP COLUMN year_month",
      destructive: true,
    },
    // Drop-then-add so this is idempotent on every re-run regardless of
    // whether the constraint already exists (same pattern as
    // scan_tags_source_check and broadcast_messages_created_by_fkey
    // above) -- this is the ONE place github_review_usage's
    // (user_id, window_start) unique constraint is created; see
    // GITHUB_REVIEW_USAGE_SQL's own comment for why it isn't inline.
    {
      sql: "ALTER TABLE github_review_usage DROP CONSTRAINT IF EXISTS github_review_usage_user_window_key",
      label:
        "Drop github_review_usage_user_window_key before re-adding it (idempotent re-run)",
      destructive: false,
    },
    {
      sql: "ALTER TABLE github_review_usage ADD CONSTRAINT github_review_usage_user_window_key UNIQUE (user_id, window_start)",
      label: "Add the (user_id, window_start) unique constraint",
      destructive: false,
    },
    {
      sql: "DROP INDEX IF EXISTS idx_github_review_usage_user_month",
      label: "Drop the old github_review_usage(user_id, year_month) index",
      destructive: false,
    },
    {
      sql: "CREATE INDEX IF NOT EXISTS idx_github_review_usage_user_window ON github_review_usage(user_id, window_start)",
      label:
        "CREATE INDEX idx_github_review_usage_user_window ON github_review_usage(user_id, window_start)",
      destructive: false,
    },
  ],
};

export const downgrade = {
  description:
    "Drop every table and column added by the squashed upgrade, restore " +
    "password_hash NOT NULL (deleting any OAuth-only account with no " +
    "password first), and revert super_admin back to admin. DELETES all " +
    "AI chat history, browser session ownership records, scanner " +
    "feedback, in-app notifications, host reputation cache (incl. its " +
    "findings/response_headers/result_meta/authenticated/scanned_url " +
    "columns, dropped along with the table), every auto-updating embed " +
    "badge a user created (host_badges -- their embedded <img> tags start " +
    "404ing, same as if the token were revoked), GitHub connections and " +
    "review usage, processed Stripe event dedup records, per-user AI " +
    "provider configs, the CVE KEV cache, webhook delivery logs, the " +
    "unified AI usage counter (chat/verify/summary token tracking), the " +
    "captured system error log (Admin > System > Error Logs), any " +
    "OAuth-only account, and every Google/GitHub/Discord account link, " +
    "API key scope, per-scan public-visibility flag, the auto/user " +
    "origin of every scan tag (scan_tags rows themselves survive -- only " +
    "the source column is dropped), the Public Scans directory's " +
    "per-share and account-level listing flags, and the durable log of " +
    "which auto tags real users told us were wrong (auto_tag_dismissals). " +
    "DOES NOT restore any staff-granted plan back from pre_staff_plan " +
    "before dropping it -- that record of who was bumped to Pro by a " +
    "staff promotion, and what plan they had before, is simply lost. Also " +
    "DELETES every purchased AI credit balance (users.ai_credit_balance) " +
    "-- any unspent top-up a user paid for is simply lost, same class of " +
    "data loss as pre_staff_plan above. Also DELETES the AI credit " +
    "purchase idempotency ledger (ai_credit_purchases) -- harmless on its " +
    "own (it has no purpose once ai_credit_balance itself is gone), but " +
    "note it is NOT a record of what was purchased beyond the balance " +
    "already lost above. Also DELETES every admin-promoted " +
    "auto-tag rule (promoted_auto_tag_rules) -- any concept an admin " +
    "already promoted out of the AI-suggestion path reverts to needing an " +
    "AI call again until re-promoted.",

  dropTables: [
    "github_connections",
    "github_review_usage",
    "host_reputation",
    "host_badges",
    "user_notifications",
    "scan_finding_feedback",
    "browser_sessions",
    "ai_conversations",
    // AUDIT-009 migration-01: missing from this file. host_reputation's
    // findings/response_headers/result_meta/authenticated/scanned_url
    // columns and user_ai_configs' ai_disabled column are NOT listed
    // separately in dropColumns below -- CASCADE-dropping the table
    // already removes them, and an explicit DROP COLUMN on a table that
    // no longer exists would error (IF EXISTS only guards the column,
    // not the table).
    "processed_stripe_events",
    "user_ai_configs",
    "cve_kev_cache",
    "webhook_deliveries",
    "ai_usage",
    "system_error_logs",
    "auto_tag_dismissals",
    "promoted_auto_tag_rules",
    "ai_credit_purchases",
  ],

  dropColumns: [
    { table: "scan_history", column: "scan_type" },
    { table: "api_keys", column: "bound_ip" },
    { table: "scan_history", column: "result_meta" },
    { table: "scan_history", column: "error_message" },
    { table: "scan_history", column: "started_at" },
    { table: "scan_history", column: "categories_total" },
    { table: "scan_history", column: "categories_completed" },
    { table: "scan_history", column: "current_category" },
    { table: "scan_history", column: "status" },
    { table: "scan_history", column: "authenticated" },
    { table: "scan_history", column: "share_token_hash" },
    { table: "billing_verification_codes", column: "salt" },
    { table: "users", column: "auth_provider" },
    { table: "users", column: "totp_last_counter" },
    { table: "users", column: "unsubscribe_token" },
    // AUDIT-009 migration-01: missing from this file.
    { table: "api_keys", column: "scopes" },
    { table: "users", column: "google_id" },
    { table: "users", column: "google_email" },
    { table: "users", column: "google_name" },
    { table: "users", column: "google_avatar_url" },
    { table: "users", column: "github_id" },
    { table: "users", column: "github_email" },
    { table: "users", column: "github_name" },
    { table: "users", column: "github_avatar_url" },
    { table: "users", column: "discord_username" },
    { table: "users", column: "discord_avatar_url" },
    { table: "users", column: "discord_email" },
    { table: "users", column: "scans_private_by_default" },
    { table: "users", column: "ai_chat_banned" },
    { table: "scan_history", column: "share_expires_at" },
    { table: "scan_history", column: "is_public" },
    { table: "broadcast_messages", column: "sent_by" },
    { table: "scheduled_scans", column: "preferred_hour_utc" },
    { table: "scheduled_scans", column: "preferred_day_of_week" },
    { table: "scheduled_scans", column: "preferred_day_of_month" },
    { table: "webhooks", column: "secret" },
    { table: "scan_tags", column: "source" },
    { table: "scan_history", column: "share_publicly_listed" },
    { table: "users", column: "share_publicly_listed_by_default" },
    { table: "users", column: "pre_staff_plan" },
    { table: "users", column: "ai_credit_balance" },
    { table: "users", column: "free_github_review_used_at" },
  ],

  dropIndexes: [
    "idx_scan_history_status_pending_running",
    // AUDIT-009 migration-01: belt-and-suspenders -- dropping
    // scan_history.status/is_public above already CASCADE-drops this
    // partial index, but DROP INDEX IF EXISTS is a safe no-op either way.
    "idx_scan_history_url_public_completed",
  ],

  dataUpdates: [
    {
      sql: "DELETE FROM users WHERE password_hash IS NULL",
      label: "Delete OAuth-only accounts that have no password to fall back to",
      destructive: true,
    },
    {
      sql: "ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL",
      label: "ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL",
      destructive: false,
    },
    {
      sql: REVERT_SUPER_ADMIN_SQL,
      label: "UPDATE users SET role='admin' WHERE role='super_admin'",
      destructive: true,
    },
  ],
};
