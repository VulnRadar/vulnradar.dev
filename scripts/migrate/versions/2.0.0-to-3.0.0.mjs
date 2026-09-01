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
 * gap. This paragraph used to end "added below to close that gap for
 * good", and it was wrong: the gap re-opened at 11 tables as AUDIT-013
 * migrate-01, because the only guard was a hand-typed list of names in a
 * test. Nothing written by hand can close it. What closes it is
 * tests/scripts/migrate/schema-parity.test.ts, which parses
 * instrumentation.ts and this file and fails on any difference in either
 * direction. Added below for the AUDIT-009 round:
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

// Per-finding remediation lifecycle (the owner's own status tracking:
// open / in_progress / fixed / accepted_risk / wont_fix + optional note +
// free-text assignee). Private to the user (ON DELETE CASCADE, unlike
// scan_finding_feedback's SET NULL global-learning row). Keyed on
// (user_id, finding_id, finding_url), NOT scan_history_id, so a status
// persists across rescans of the same target. `open` is the implicit
// default (absence of a row).
const FINDING_REMEDIATION_SQL = `
  CREATE TABLE IF NOT EXISTS finding_remediation (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    finding_id TEXT NOT NULL,
    finding_url TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'fixed', 'accepted_risk', 'wont_fix')),
    note TEXT,
    assignee TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_finding_remediation_unique
    ON finding_remediation (user_id, finding_id, finding_url);

  CREATE INDEX IF NOT EXISTS idx_finding_remediation_user
    ON finding_remediation (user_id, updated_at DESC);
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
    request_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- AUDIT-012#obs-07: the per-request correlation id. The ALTER is not
  -- redundant with the column above -- a database that already ran this
  -- bucket back when the table had four columns gets nothing from CREATE
  -- TABLE IF NOT EXISTS, and lib/database/error-log-capture.ts's INSERT
  -- names request_id unconditionally. instrumentation.ts carries the same
  -- pair for the same reason.
  ALTER TABLE system_error_logs
    ADD COLUMN IF NOT EXISTS request_id VARCHAR(64);

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

// ─────────────────────────────────────────────────────────────────────
// AUDIT-013 migrate-01: the 11 tables below had grown into
// instrumentation.ts on top of the same v2.0.0 base this file upgrades
// from, and no migration step created any of them. This is the SECOND
// time that gap opened (AUDIT-009 migration-01 was the first, at 4
// tables), which is why the fix this time is paired with a derived
// parity guard: tests/scripts/migrate/schema-parity.test.ts now parses
// instrumentation.ts and this file and fails on any difference, instead
// of checking a hand-typed list of names.
//
// Every block below is copied verbatim from instrumentation.ts, including
// each table's own indexes, so the two paths produce byte-identical
// tables. Order matters in `addTables`: support_tickets before its
// messages/shares, and everything after `teams` (a v1 table) for
// domains' FK.
// ─────────────────────────────────────────────────────────────────────

// Outbound email delivery log (Admin > System > Email Logs). Pruned by
// lib/database/cleanup.ts's retention pass.
const EMAIL_LOGS_SQL = `
  CREATE TABLE IF NOT EXISTS email_logs (
    id SERIAL PRIMARY KEY,
    recipient VARCHAR(255) NOT NULL,
    subject TEXT NOT NULL,
    status VARCHAR(30) NOT NULL,
    error_message TEXT,
    redacted_preview TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_email_logs_created_at
    ON email_logs(created_at DESC);
`;

// Page screenshot bytes, keyed 1:1 on the scan that produced them.
const SCAN_SCREENSHOTS_SQL = `
  CREATE TABLE IF NOT EXISTS scan_screenshots (
    scan_id INTEGER PRIMARY KEY REFERENCES scan_history(id) ON DELETE CASCADE,
    image_data BYTEA NOT NULL,
    content_type VARCHAR(40) NOT NULL DEFAULT 'image/jpeg',
    width INTEGER,
    height INTEGER,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

// Uploaded avatar bytes, keyed 1:1 on the user.
const USER_AVATARS_SQL = `
  CREATE TABLE IF NOT EXISTS user_avatars (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    image_data BYTEA NOT NULL,
    content_type TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`;

// GitHub AI-review credit purchase idempotency ledger. Same shape and
// same purpose as ai_credit_purchases above.
const GITHUB_CREDIT_PURCHASES_SQL = `
  CREATE TABLE IF NOT EXISTS github_credit_purchases (
    payment_intent_id VARCHAR(255) PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tokens BIGINT NOT NULL,
    credited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

// Browserbase session-seconds counter, bucketed per billing period.
const BROWSERBASE_USAGE_SQL = `
  CREATE TABLE IF NOT EXISTS browserbase_usage (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period_start TIMESTAMPTZ NOT NULL,
    seconds_used INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, period_start)
  );
`;

// Browserbase second-pack purchase idempotency ledger.
const BROWSERBASE_CREDIT_PURCHASES_SQL = `
  CREATE TABLE IF NOT EXISTS browserbase_credit_purchases (
    payment_intent_id VARCHAR(255) PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seconds BIGINT NOT NULL,
    credited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

// Consecutive-failure counter behind the background worker watchdog.
const WORKER_FAILURE_STATE_SQL = `
  CREATE TABLE IF NOT EXISTS worker_failure_state (
    event VARCHAR(100) PRIMARY KEY,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    alerted BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

// Verified custom domains. status='verified' is the gate that authorizes
// intrusive active probing (lib/domains/scope.ts), so this table missing
// silently disables that whole feature rather than failing loudly.
const DOMAINS_SQL = `
  CREATE TABLE IF NOT EXISTS domains (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    domain VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    verification_token VARCHAR(64) NOT NULL,
    verification_method VARCHAR(20) NOT NULL DEFAULT 'dns_txt',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at TIMESTAMPTZ,
    last_checked_at TIMESTAMPTZ,
    last_check_error TEXT,
    UNIQUE(user_id, domain)
  );

  CREATE INDEX IF NOT EXISTS idx_domains_team_id ON domains(team_id) WHERE team_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_domains_domain_verified ON domains(domain) WHERE status = 'verified';
`;

// In-app support tickets. Parent first: the two tables below reference it.
const SUPPORT_TICKETS_SQL = `
  CREATE TABLE IF NOT EXISTS support_tickets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject VARCHAR(200) NOT NULL,
    category VARCHAR(20) NOT NULL DEFAULT 'other'
      CHECK (category IN ('billing', 'scanning', 'account', 'other')),
    status VARCHAR(20) NOT NULL DEFAULT 'open'
      CHECK (status IN ('open', 'awaiting_staff', 'awaiting_user', 'resolved', 'closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_support_tickets_user
    ON support_tickets(user_id, last_message_at DESC);
  CREATE INDEX IF NOT EXISTS idx_support_tickets_status
    ON support_tickets(status, last_message_at DESC);
`;

const SUPPORT_TICKET_MESSAGES_SQL = `
  CREATE TABLE IF NOT EXISTS support_ticket_messages (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    is_staff BOOLEAN NOT NULL DEFAULT FALSE,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket
    ON support_ticket_messages(ticket_id, created_at);
`;

/**
 * Multi-team scan sharing. scan_history.team_id (added by addColumns below)
 * holds ONE team; this join table is the many side. The column is deliberately
 * NOT dropped: it stays in sync as the primary team, so a rollback to v2.0.0
 * keeps every scan's primary team rather than losing all team association.
 *
 * ON DELETE CASCADE on both sides, unlike the column's ON DELETE SET NULL: a
 * row here is a membership fact and nothing else.
 *
 * The backfill is unconditional and idempotent by design, exactly as the boot
 * schema runs it: three write paths in lib/scanner/ still write only the
 * column, so this converges the two representations on every run rather than
 * migrating history once.
 */
const SCAN_HISTORY_TEAMS_SQL = `
  CREATE TABLE IF NOT EXISTS scan_history_teams (
    scan_id INTEGER NOT NULL REFERENCES scan_history(id) ON DELETE CASCADE,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (scan_id, team_id)
  );

  CREATE INDEX IF NOT EXISTS idx_scan_history_teams_team
    ON scan_history_teams(team_id);

  INSERT INTO scan_history_teams (scan_id, team_id)
  SELECT id, team_id FROM scan_history WHERE team_id IS NOT NULL
  ON CONFLICT (scan_id, team_id) DO NOTHING;
`;

const SUPPORT_TICKET_SHARES_SQL = `
  CREATE TABLE IF NOT EXISTS support_ticket_shares (
    ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    shared_with_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shared_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (ticket_id, shared_with_user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_support_ticket_shares_user
    ON support_ticket_shares(shared_with_user_id);
`;

// Staff invites. Was created lazily by lib/admin/staff-invites.ts on every
// admin request instead of by any schema file (AUDIT-013 schema-02);
// instrumentation.ts now creates it at boot and this is the matching
// migration step.
const STAFF_INVITES_SQL = `
  CREATE TABLE IF NOT EXISTS staff_invites (
    id SERIAL PRIMARY KEY,
    token VARCHAR(64) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL,
    invited_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    accepted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_staff_invites_email ON staff_invites(email);
`;

// Admin audit log archive. Same story as staff_invites: created lazily
// inside the nightly cleanup transaction, in no schema file.
const ADMIN_AUDIT_LOG_ARCHIVE_SQL = `
  CREATE TABLE IF NOT EXISTS admin_audit_log_archive (
    id SERIAL PRIMARY KEY,
    purged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retention_days INTEGER,
    row_count INTEGER NOT NULL,
    rows JSONB NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_admin_audit_log_archive_purged_at
    ON admin_audit_log_archive(purged_at DESC);
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
    "scan_finding_feedback, finding_remediation (per-finding remediation " +
    "status lifecycle, persisted across rescans), user_notifications, " +
    "host_reputation, " +
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
    "replaced it), so production never sees it. Also DROPS five v2.0.0 " +
    "columns nothing ever wrote or read (AUDIT-011 drift-17): " +
    "users.email_session_revoked (a legacy duplicate of the real " +
    "preference on notification_preferences), data_requests.completed_at, " +
    "system_settings.setting_type, and broadcast_recipients.opened_at / " +
    ".clicked_at. Every one of them is NULL or its default on every row, " +
    "so no data goes with them, and downgrade.addColumns restores them.",

  addTables: [
    { name: "ai_conversations", sql: V3_NEW_TABLES.ai_conversations },
    { name: "browser_sessions", sql: V3_NEW_TABLES.browser_sessions },
    { name: "scan_finding_feedback", sql: SCAN_FINDING_FEEDBACK_SQL },
    { name: "finding_remediation", sql: FINDING_REMEDIATION_SQL },
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
    // AUDIT-013 migrate-01: the 13 below existed only on the boot path.
    // FK-safe order: support_tickets before its children, everything after
    // the users/teams/scan_history parents that already exist at v2.0.0.
    { name: "email_logs", sql: EMAIL_LOGS_SQL },
    { name: "scan_screenshots", sql: SCAN_SCREENSHOTS_SQL },
    { name: "user_avatars", sql: USER_AVATARS_SQL },
    { name: "github_credit_purchases", sql: GITHUB_CREDIT_PURCHASES_SQL },
    { name: "browserbase_usage", sql: BROWSERBASE_USAGE_SQL },
    {
      name: "browserbase_credit_purchases",
      sql: BROWSERBASE_CREDIT_PURCHASES_SQL,
    },
    { name: "worker_failure_state", sql: WORKER_FAILURE_STATE_SQL },
    { name: "domains", sql: DOMAINS_SQL },
    { name: "support_tickets", sql: SUPPORT_TICKETS_SQL },
    { name: "support_ticket_messages", sql: SUPPORT_TICKET_MESSAGES_SQL },
    { name: "support_ticket_shares", sql: SUPPORT_TICKET_SHARES_SQL },
    { name: "staff_invites", sql: STAFF_INVITES_SQL },
    { name: "admin_audit_log_archive", sql: ADMIN_AUDIT_LOG_ARCHIVE_SQL },
    { name: "scan_history_teams", sql: SCAN_HISTORY_TEAMS_SQL },
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
    {
      table: "host_badges",
      column: "scope",
      // Defaults to 'user' for every pre-existing row -- a badge someone
      // already embedded keeps its current owner-only behavior unless they
      // explicitly opt into 'global' via the toggle on the badge page.
      definition:
        "TEXT NOT NULL DEFAULT 'user' CHECK (scope IN ('user', 'global'))",
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
    // Opaque, non-enumerable handle the scan-history URLs and API resolve by
    // instead of the sequential SERIAL id (see lib/history/resolve-scan.ts).
    // Same volatile-DEFAULT trick as webhooks.secret: ADD COLUMN evaluates
    // gen_random_uuid() once per existing row (a table rewrite, since it's
    // volatile), back-filling every pre-existing scan with its own distinct
    // 32-hex-char value, and fills every new row automatically without any
    // insert site setting it. The numeric id stays the primary key -- four
    // FKs still reference it, unchanged. The UNIQUE index is created in
    // dataUpdates below (not inline UNIQUE) so it shares the exact index name
    // instrumentation.ts uses, keeping the boot path and this path idempotent
    // against each other.
    {
      table: "scan_history",
      column: "public_id",
      definition: "TEXT DEFAULT (replace(gen_random_uuid()::text, '-', ''))",
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
    // ── AUDIT-013 migrate-01: columns that existed only on the boot path.
    // Every definition is copied verbatim from instrumentation.ts.
    // Admin impersonation bookkeeping and the display-only IPv4 captured
    // out-of-band by the echo endpoint.
    {
      table: "sessions",
      column: "impersonated_by",
      definition: "INTEGER REFERENCES users(id)",
    },
    { table: "sessions", column: "ipv4_address", definition: "VARCHAR(45)" },
    // Org-level resource scoping: a scan / API key / webhook / schedule can
    // belong to a team instead of only its creating user. ON DELETE SET
    // NULL, not CASCADE: deleting a team must not destroy scan history.
    {
      table: "scan_history",
      column: "team_id",
      definition: "INTEGER REFERENCES teams(id) ON DELETE SET NULL",
    },
    // AUDIT-011#drift-17: api_keys.team_id is deliberately absent from this
    // list. It was added alongside the other three and then never
    // referenced by anything -- lib/api/api-keys.ts and app/api/v3/keys
    // scope every key to its creating user -- so it is simply not created
    // any more, here or in instrumentation.ts. No dropColumns entry is
    // needed: it never existed at v2.0.0, so there is nothing to remove
    // from a database arriving through this step.
    {
      table: "webhooks",
      column: "team_id",
      definition: "INTEGER REFERENCES teams(id) ON DELETE SET NULL",
    },
    {
      table: "scheduled_scans",
      column: "team_id",
      definition: "INTEGER REFERENCES teams(id) ON DELETE SET NULL",
    },
    {
      table: "finding_remediation",
      column: "due_at",
      definition: "TIMESTAMPTZ",
    },
    {
      table: "host_reputation",
      column: "auto_tags",
      definition: "JSONB NOT NULL DEFAULT '[]'",
    },
    { table: "users", column: "billing_interval", definition: "VARCHAR(10)" },
    {
      table: "users",
      column: "github_credit_balance",
      definition: "BIGINT NOT NULL DEFAULT 0",
    },
    {
      table: "users",
      column: "browserbase_credit_seconds_balance",
      definition: "BIGINT NOT NULL DEFAULT 0",
    },
    // Refund marker on all three credit ledgers. The two newer ledgers get
    // it via their own CREATE TABLE above; ai_credit_purchases predates it.
    {
      table: "ai_credit_purchases",
      column: "refunded_at",
      definition: "TIMESTAMPTZ",
    },
    {
      table: "github_credit_purchases",
      column: "refunded_at",
      definition: "TIMESTAMPTZ",
    },
    {
      table: "browserbase_credit_purchases",
      column: "refunded_at",
      definition: "TIMESTAMPTZ",
    },
    // The GitHub @handle for a GitHub sign-in, read by /api/v3/auth/me,
    // the admin user detail and the OAuth disconnect path.
    { table: "users", column: "github_login", definition: "TEXT" },
    // Posture digest (AUDIT-010). These three had never been on the migration
    // path at all: their DDL lives in lib/notifications/digest-schema.ts, which
    // the boot sequence called from inside the posture-digest worker's start-up
    // and which no schema derivation had ever looked at. A database that had
    // only ever been through `npm run db:create` or `npm run db:migrate` did
    // not have them, and got them silently on its first boot instead.
    // Definitions match that module exactly.
    {
      table: "users",
      column: "digest_email_enabled",
      definition: "BOOLEAN NOT NULL DEFAULT false",
    },
    {
      table: "users",
      column: "last_digest_sent_at",
      definition: "TIMESTAMPTZ",
    },
    {
      table: "notification_preferences",
      column: "email_posture_digest",
      definition: "BOOLEAN NOT NULL DEFAULT true",
    },
  ],

  // AUDIT-011#drift-17: five columns a v2.0.0 database has that nothing ever
  // wrote or read. Each was verified by grepping the whole tree for its
  // name and finding only DDL (and, for users.email_session_revoked, nine
  // references that all resolve to the identically-named column on
  // notification_preferences, which is the real one). instrumentation.ts no
  // longer declares any of them, so a freshly-booted database and a
  // migrated one converge on the same shape; downgrade.addColumns puts them
  // back so a rollback still reaches a true v2.0.0.
  //
  // Not listed here, deliberately: users.beta_access, users.daily_scan_limit,
  // broadcast_messages.scheduled_at, broadcast_messages.message_type,
  // badges.is_limited and gifted_subscriptions.reason are unwired too, but
  // each is half of a real feature rather than a leftover, so dropping them
  // is a product decision, not a cleanup. Each carries a comment at its DDL
  // in instrumentation.ts saying so.
  dropColumns: [
    { table: "users", column: "email_session_revoked" },
    { table: "data_requests", column: "completed_at" },
    { table: "system_settings", column: "setting_type" },
    { table: "broadcast_recipients", column: "opened_at" },
    { table: "broadcast_recipients", column: "clicked_at" },
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
    // AUDIT-013 migrate-06: instrumentation.ts creates this as a UNIQUE
    // index under the same name. It was plain here, and IF NOT EXISTS
    // matches on the name only, so whichever path ran first decided
    // whether one GitHub identity could be connected to two VulnRadar
    // accounts (and both consume that identity's review quota). Safe to
    // make UNIQUE here: github_connections is created empty by this same
    // migration a few steps above.
    {
      name: "idx_github_connections_github_user_id",
      table: "github_connections",
      columns: "github_user_id",
      unique: true,
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
    // AUDIT-013 migrate-06: same name-collision problem as the index
    // above. instrumentation.ts declares this UNIQUE with no predicate;
    // matched here exactly. host_badges is also created empty by this
    // migration, and a b-tree treats NULLs as distinct, so dropping the
    // partial predicate changes nothing except making the two paths agree.
    {
      name: "idx_host_badges_token_hash",
      table: "host_badges",
      columns: "badge_token_hash",
      unique: true,
    },
    // ── AUDIT-013 migrate-01: indexes instrumentation.ts creates on
    // tables that already exist at v2.0.0, which no migration step
    // created. Every one is a plain performance index (no UNIQUE among
    // them), copied verbatim. They are cheap here: at production size
    // these tables are small, and the ones on scan_history are partial
    // indexes over a nullable column that is NULL for every existing row.
    {
      name: "idx_users_plan",
      table: "users",
      columns: "plan",
    },
    {
      name: "idx_scan_history_team_id",
      table: "scan_history",
      columns: "team_id",
      where: "team_id IS NOT NULL",
    },
    // idx_api_keys_team_id is gone with the column it indexed, see the
    // AUDIT-011#drift-17 note in addColumns above.
    {
      name: "idx_webhooks_team_id",
      table: "webhooks",
      columns: "team_id",
      where: "team_id IS NOT NULL",
    },
    {
      name: "idx_scheduled_scans_team_id",
      table: "scheduled_scans",
      columns: "team_id",
      where: "team_id IS NOT NULL",
    },
    {
      name: "idx_billing_history_user",
      table: "billing_history",
      columns: "user_id",
    },
    {
      name: "idx_admin_user_notes_user",
      table: "admin_user_notes",
      columns: "user_id",
    },
    {
      name: "idx_staff_activity_heartbeat",
      table: "staff_activity",
      columns: "last_heartbeat DESC",
    },
    {
      name: "idx_billing_verify_user",
      table: "billing_verification_codes",
      columns: "user_id",
    },
    {
      name: "idx_billing_verify_expires",
      table: "billing_verification_codes",
      columns: "expires_at",
    },
    {
      name: "idx_gifted_subscriptions_user",
      table: "gifted_subscriptions",
      columns: "user_id",
    },
    {
      name: "idx_gifted_subscriptions_expires",
      table: "gifted_subscriptions",
      columns: "expires_at",
      where: "revoked_at IS NULL",
    },
    {
      name: "idx_admin_notifications_active",
      table: "admin_notifications",
      columns: "is_active, starts_at, ends_at",
      where: "is_active = true",
    },
    {
      name: "idx_admin_notifications_type",
      table: "admin_notifications",
      columns: "type",
    },
    {
      name: "idx_access_rules_active",
      table: "access_rules",
      columns: "is_active, rule_type",
    },
    { name: "idx_access_rules_value", table: "access_rules", columns: "value" },
    {
      name: "idx_access_rules_type",
      table: "access_rules",
      columns: "value_type",
    },
    {
      name: "idx_security_alerts_user",
      table: "security_alerts",
      columns: "user_id",
    },
    {
      name: "idx_security_alerts_severity",
      table: "security_alerts",
      columns: "severity",
    },
    {
      name: "idx_security_alerts_created",
      table: "security_alerts",
      columns: "created_at DESC",
    },
    {
      name: "idx_broadcast_messages_status",
      table: "broadcast_messages",
      columns: "status",
    },
    {
      name: "idx_broadcast_messages_created",
      table: "broadcast_messages",
      columns: "created_at DESC",
    },
    {
      name: "idx_broadcast_recipients_user",
      table: "broadcast_recipients",
      columns: "user_id",
    },
    {
      name: "idx_subdomain_cache_cached_at",
      table: "subdomain_cache",
      columns: "cached_at",
    },
    {
      name: "idx_host_reputation_source_scan_id",
      table: "host_reputation",
      columns: "source_scan_id",
      where: "source_scan_id IS NOT NULL",
    },
    // ── AUDIT-012 perf-05 / perf-15 and AUDIT-013 schema-03: retention,
    // foreign-key and hot-path indexes. See instrumentation.ts's
    // "RETENTION, FOREIGN-KEY AND HOT-PATH INDEXES" block for why each
    // one exists. Mirrored here so a migrated database and a booted one
    // have the same index set.
    {
      name: "idx_scan_history_url_scanned",
      table: "scan_history",
      columns: "url, scanned_at DESC",
    },
    {
      name: "idx_sff_created",
      table: "scan_finding_feedback",
      columns: "created_at",
    },
    {
      name: "idx_user_notifications_created",
      table: "user_notifications",
      columns: "created_at",
    },
    {
      name: "idx_ai_conversations_last_msg",
      table: "ai_conversations",
      columns: "last_message_at DESC",
    },
    {
      name: "idx_finding_remediation_user_url",
      table: "finding_remediation",
      columns: "user_id, finding_url",
    },
    {
      name: "idx_sff_user_url",
      table: "scan_finding_feedback",
      columns: "user_id, finding_url",
    },
    {
      name: "idx_sff_scan_history_id",
      table: "scan_finding_feedback",
      columns: "scan_history_id",
      where: "scan_history_id IS NOT NULL",
    },
    {
      name: "idx_auto_tag_dismissals_scan_id",
      table: "auto_tag_dismissals",
      columns: "scan_id",
    },
    { name: "idx_teams_owner_id", table: "teams", columns: "owner_id" },
    {
      name: "idx_sessions_impersonated_by",
      table: "sessions",
      columns: "impersonated_by",
      where: "impersonated_by IS NOT NULL",
    },
    {
      name: "idx_user_badges_awarded_by",
      table: "user_badges",
      columns: "awarded_by",
      where: "awarded_by IS NOT NULL",
    },
    {
      name: "idx_user_badges_badge_id",
      table: "user_badges",
      columns: "badge_id",
    },
    {
      name: "idx_admin_user_notes_admin_id",
      table: "admin_user_notes",
      columns: "admin_id",
      where: "admin_id IS NOT NULL",
    },
    {
      name: "idx_team_invites_invited_by",
      table: "team_invites",
      columns: "invited_by",
      where: "invited_by IS NOT NULL",
    },
    {
      name: "idx_gifted_subscriptions_gifted_by",
      table: "gifted_subscriptions",
      columns: "gifted_by",
      where: "gifted_by IS NOT NULL",
    },
    {
      name: "idx_gifted_subscriptions_revoked_by",
      table: "gifted_subscriptions",
      columns: "revoked_by",
      where: "revoked_by IS NOT NULL",
    },
    {
      name: "idx_admin_notifications_created_by",
      table: "admin_notifications",
      columns: "created_by",
      where: "created_by IS NOT NULL",
    },
    {
      name: "idx_access_rules_created_by",
      table: "access_rules",
      columns: "created_by",
      where: "created_by IS NOT NULL",
    },
    {
      name: "idx_security_alerts_resolved_by",
      table: "security_alerts",
      columns: "resolved_by",
      where: "resolved_by IS NOT NULL",
    },
    {
      name: "idx_system_settings_updated_by",
      table: "system_settings",
      columns: "updated_by",
      where: "updated_by IS NOT NULL",
    },
    {
      name: "idx_broadcast_messages_created_by",
      table: "broadcast_messages",
      columns: "created_by",
      where: "created_by IS NOT NULL",
    },
    {
      name: "idx_broadcast_messages_sent_by",
      table: "broadcast_messages",
      columns: "sent_by",
      where: "sent_by IS NOT NULL",
    },
    {
      name: "idx_auto_tag_dismissals_dismissed_by",
      table: "auto_tag_dismissals",
      columns: "dismissed_by_user_id",
      where: "dismissed_by_user_id IS NOT NULL",
    },
    {
      name: "idx_promoted_auto_tag_rules_created_by",
      table: "promoted_auto_tag_rules",
      columns: "created_by",
      where: "created_by IS NOT NULL",
    },
    {
      name: "idx_ai_credit_purchases_user_id",
      table: "ai_credit_purchases",
      columns: "user_id",
    },
    {
      name: "idx_github_credit_purchases_user_id",
      table: "github_credit_purchases",
      columns: "user_id",
    },
    {
      name: "idx_browserbase_credit_purchases_user_id",
      table: "browserbase_credit_purchases",
      columns: "user_id",
    },
    {
      name: "idx_support_ticket_messages_author",
      table: "support_ticket_messages",
      columns: "author_user_id",
      where: "author_user_id IS NOT NULL",
    },
    {
      name: "idx_support_ticket_shares_shared_by",
      table: "support_ticket_shares",
      columns: "shared_by_user_id",
      where: "shared_by_user_id IS NOT NULL",
    },
    {
      name: "idx_staff_invites_invited_by",
      table: "staff_invites",
      columns: "invited_by",
    },
    // github_review_usage.updated_at: created via dataUpdates below with
    // the rest of that table's window_start rework, for the same
    // step-ordering reason the (user_id, window_start) constraint is.
  ],

  // Redundant indexes that a v2.0.0 database already has (AUDIT-013
  // schema-05). Each one duplicates a UNIQUE constraint, or is a strict
  // prefix of a wider index the same table now carries, so it can never be
  // chosen and is pure write amplification on the hottest tables in the
  // schema. The v3-era duplicates are simply not created any more (their
  // entries are gone from addIndexes above); these twelve predate v3, so a
  // migrated database only sheds them if the upgrade says to.
  // instrumentation.ts drops the same set at boot, so a v3 install that never
  // runs the migrator converges on the same shape. The matching CREATEs are
  // in downgrade.addIndexes so a rollback restores a true v2.0.0 shape.
  dropIndexes: [
    "idx_users_email", // users.email UNIQUE
    "idx_api_keys_key_hash", // api_keys.key_hash UNIQUE
    "idx_notif_prefs_user_id", // notification_preferences.user_id UNIQUE
    "idx_team_invites_token", // team_invites.token UNIQUE
    "idx_scan_history_user_id", // idx_scan_history_user_scanned leads with user_id
    "idx_api_usage_key_id", // idx_api_usage_key_used leads with api_key_id
    "idx_admin_audit_admin_id", // idx_admin_audit_admin_created leads with admin_id
    "idx_scan_tags_scan_id", // UNIQUE(scan_id, tag)
    "idx_rate_limits_key", // UNIQUE(key, window_start)
    "idx_device_trust_user_id", // UNIQUE(user_id, device_fingerprint)
    "idx_team_members_team", // UNIQUE(team_id, user_id)
    "idx_api_keys_key_locator_backfill", // partial subset of idx_api_keys_key_locator
    // The rest of the redundant set. These are NOT in the derived v2 schema
    // (the v1 baseline plus the 1.0.0-to-2.0.0 step), so listing them changes
    // nothing for a database that took that path, but they ARE in the frozen
    // v2.0.0 snapshot that `npm run db:create` builds a scratch v2 database
    // from. Without these a database migrated from a snapshot-built v2 would
    // keep them until its next boot, when instrumentation.ts drops them, and
    // `npm run db:migrate` alone should be enough. DROP INDEX IF EXISTS is a
    // no-op wherever they were never created.
    "idx_users_stripe_customer",
    "idx_scan_history_share_token",
    "idx_badges_name",
    "idx_user_badges_user",
    "idx_discord_user",
    "idx_discord_id",
    "idx_staff_activity_user_heartbeat",
    "idx_admin_notifications_cookie",
    "idx_broadcast_recipients_message",
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
    // scan_history.public_id (added above): belt-and-suspenders backfill for
    // any row a prior partial run could have left NULL (the volatile DEFAULT
    // on ADD COLUMN already fills every row created before/after it), then the
    // UNIQUE index -- same index NAME instrumentation.ts's boot path uses, so
    // whichever path runs first, the other's CREATE ... IF NOT EXISTS no-ops
    // instead of building a redundant second unique index.
    {
      sql: "UPDATE scan_history SET public_id = replace(gen_random_uuid()::text, '-', '') WHERE public_id IS NULL",
      label:
        "Backfill scan_history.public_id for any row still missing one (idempotent)",
      destructive: false,
    },
    {
      sql: "CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_history_public_id ON scan_history(public_id)",
      label: "Create the unique index on scan_history.public_id",
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
    // AUDIT-013 migrate-14: this used to be
    // `ADD COLUMN window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
    // NOW() is transaction-start time and is evaluated ONCE, so every
    // pre-existing row got the identical window_start. A user with rows
    // for two different calendar months collapsed onto one
    // (user_id, window_start) pair and the UNIQUE constraint added a few
    // steps below failed with "Key is duplicated", rolling back the ENTIRE
    // v2.0.0 -> v3.0.0 upgrade over a table nobody would think to look at.
    // Nullable first, then backfilled deterministically from the old key.
    {
      sql: "ALTER TABLE github_review_usage ADD COLUMN IF NOT EXISTS window_start TIMESTAMPTZ",
      label:
        "ALTER TABLE github_review_usage ADD COLUMN window_start (for a database that already ran this migration with the old year_month shape)",
      destructive: false,
    },
    {
      // Guarded by a DO block because year_month does not exist on a
      // database that only ever saw the window_start shape, and a plain
      // UPDATE naming a missing column errors at execution time rather
      // than no-opping.
      sql: `
        DO $gru$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'github_review_usage'
              AND column_name = 'year_month'
          ) THEN
            EXECUTE 'UPDATE github_review_usage
                        SET window_start = to_timestamp(year_month || ''-01'', ''YYYY-MM-DD'')
                      WHERE window_start IS NULL AND year_month IS NOT NULL';
          END IF;
        END
        $gru$;
      `,
      label:
        "Backfill github_review_usage.window_start from the old year_month key, one distinct value per calendar month",
      destructive: false,
    },
    {
      sql: "UPDATE github_review_usage SET window_start = NOW() WHERE window_start IS NULL",
      label:
        "Backfill any remaining github_review_usage.window_start (rows with no year_month to derive from)",
      destructive: false,
    },
    {
      sql: "ALTER TABLE github_review_usage ALTER COLUMN window_start SET DEFAULT NOW()",
      label: "ALTER TABLE github_review_usage window_start SET DEFAULT NOW()",
      destructive: false,
    },
    {
      sql: "ALTER TABLE github_review_usage ALTER COLUMN window_start SET NOT NULL",
      label: "ALTER TABLE github_review_usage window_start SET NOT NULL",
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
    // No idx_github_review_usage_user_window here: the ADD CONSTRAINT above
    // already creates a unique b-tree on exactly (user_id, window_start), so a
    // second index on the same columns could never be chosen and only cost a
    // write on every quota update. ref: AUDIT-013#schema-05
    {
      sql: "CREATE INDEX IF NOT EXISTS idx_gru_updated ON github_review_usage(updated_at)",
      label:
        "CREATE INDEX idx_gru_updated ON github_review_usage(updated_at) (retention prune, AUDIT-012 perf-15)",
      destructive: false,
    },
    // ── Constraint-bearing indexes. These live in dataUpdates rather than
    // addIndexes because each needs a data step to run FIRST: addIndexes
    // is expanded before dataUpdates, so an index that can only be built
    // after a backfill or a de-duplication has to be created here.
    {
      sql: `
        UPDATE users SET unsubscribe_token = gen_random_uuid()
          WHERE unsubscribe_token IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_unsubscribe_token
          ON users(unsubscribe_token);
      `,
      label:
        "Backfill users.unsubscribe_token and make it UNIQUE (AUDIT-013 schema-09)",
      destructive: false,
    },
    {
      sql: `
        DELETE FROM broadcast_recipients a
          USING broadcast_recipients b
         WHERE a.message_id = b.message_id
           AND a.user_id = b.user_id
           AND a.id > b.id;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_broadcast_recipients_message_user
          ON broadcast_recipients(message_id, user_id);
      `,
      label:
        "Collapse duplicate broadcast_recipients rows and make (message_id, user_id) UNIQUE (AUDIT-013 schema-08)",
      destructive: true,
    },
    {
      // The one index in this migration that can legitimately fail on real
      // data: a database that already holds two accounts whose addresses
      // differ only in letter case cannot build it, and that needs a human
      // to decide which account survives. runPlan wraps the whole plan in
      // ONE transaction, so an uncaught failure here would roll back the
      // entire upgrade over a pre-existing data problem. The plpgsql
      // BEGIN/EXCEPTION pair is a subtransaction: it catches, warns, and
      // lets the migration finish, exactly like instrumentation.ts's own
      // per-statement .catch on the same index.
      sql: `
        DO $email_lower$
        BEGIN
          BEGIN
            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users(lower(email));
          EXCEPTION WHEN others THEN
            RAISE WARNING 'Skipped idx_users_email_lower: %. Two accounts probably share an email address differing only in letter case. Resolve them by hand, then re-run db:migrate.', SQLERRM;
          END;
        END
        $email_lower$;
      `,
      label:
        "Make users.email uniqueness case-insensitive (AUDIT-013 schema-11)",
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
    "AI call again until re-promoted. Re-adds the five unused v2.0.0 " +
    "columns the upgrade dropped (AUDIT-011 drift-17), empty, so the " +
    "result is a true v2.0.0 shape.",

  dropTables: [
    "github_connections",
    "github_review_usage",
    "host_reputation",
    "host_badges",
    "user_notifications",
    "finding_remediation",
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
    // AUDIT-013 migrate-01 / migrate-19: the 13 tables the upgrade now
    // creates. Children before parents so a plain DROP is enough even if
    // the planner's CASCADE were ever removed.
    "support_ticket_shares",
    "support_ticket_messages",
    "support_tickets",
    "email_logs",
    "scan_screenshots",
    "user_avatars",
    "github_credit_purchases",
    "browserbase_usage",
    "browserbase_credit_purchases",
    "worker_failure_state",
    "domains",
    "staff_invites",
    "admin_audit_log_archive",
    // Lossy on purpose, and only in one direction: a scan shared with several
    // teams loses its SECOND and later teams here. The primary team survives,
    // because scan_history.team_id is kept in sync and is not dropped by this
    // upgrade, so a rolled-back database still shows every scan under one team
    // rather than none.
    "scan_history_teams",
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
    { table: "scan_history", column: "public_id" },
    { table: "users", column: "share_publicly_listed_by_default" },
    { table: "users", column: "pre_staff_plan" },
    { table: "users", column: "ai_credit_balance" },
    { table: "users", column: "free_github_review_used_at" },
    // AUDIT-013 migrate-01: matching drops for the columns the upgrade
    // now adds. Columns on tables that are themselves dropped above
    // (finding_remediation.due_at, host_reputation.auto_tags, the three
    // credit ledgers' refunded_at) are deliberately NOT listed: the table
    // drop already removes them, and DROP COLUMN IF EXISTS still errors
    // when the TABLE is gone.
    { table: "sessions", column: "impersonated_by" },
    { table: "sessions", column: "ipv4_address" },
    { table: "scan_history", column: "team_id" },
    // api_keys.team_id is not listed: the upgrade no longer adds it
    // (AUDIT-011#drift-17), so there is nothing for a rollback to remove.
    { table: "webhooks", column: "team_id" },
    { table: "scheduled_scans", column: "team_id" },
    { table: "users", column: "billing_interval" },
    { table: "users", column: "github_credit_balance" },
    { table: "users", column: "browserbase_credit_seconds_balance" },
    { table: "users", column: "github_login" },
    { table: "users", column: "digest_email_enabled" },
    { table: "users", column: "last_digest_sent_at" },
    { table: "notification_preferences", column: "email_posture_digest" },
  ],

  // AUDIT-011#drift-17: the five dead columns the upgrade drops existed at
  // v2.0.0, so a rollback has to put them back or the result is not a true
  // v2.0.0 shape -- the same rule the redundant-index restore below follows.
  // Definitions are copied from what the v1 baseline plus the
  // 1.0.0-to-2.0.0 step (and the frozen v2 snapshot) actually produce, not
  // from instrumentation.ts, which no longer declares any of them. The
  // values are gone either way: every one of these was NULL or its default
  // on every row, which is why they were droppable.
  addColumns: [
    {
      table: "users",
      column: "email_session_revoked",
      definition: "BOOLEAN NOT NULL DEFAULT false",
    },
    {
      table: "data_requests",
      column: "completed_at",
      definition: "TIMESTAMP WITH TIME ZONE",
    },
    {
      table: "system_settings",
      column: "setting_type",
      definition: "VARCHAR(50) DEFAULT 'string'",
    },
    {
      table: "broadcast_recipients",
      column: "opened_at",
      definition: "TIMESTAMP WITH TIME ZONE",
    },
    {
      table: "broadcast_recipients",
      column: "clicked_at",
      definition: "TIMESTAMP WITH TIME ZONE",
    },
  ],

  // The twelve redundant indexes the upgrade drops (AUDIT-013 schema-05)
  // existed at v2.0.0, so a downgrade has to put them back or the result is
  // not a true v2.0.0 shape, the same defect AUDIT-009 migration-04 fixed for
  // the four indexes below. Definitions copied from what the v1 baseline plus
  // the 1.0.0-to-2.0.0 step actually produce, not from instrumentation.ts,
  // which no longer creates any of them.
  addIndexes: [
    { name: "idx_users_email", table: "users", columns: "email" },
    { name: "idx_api_keys_key_hash", table: "api_keys", columns: "key_hash" },
    {
      name: "idx_api_keys_key_locator_backfill",
      table: "api_keys",
      columns: "key_locator",
      where: "key_locator IS NULL",
    },
    {
      name: "idx_notif_prefs_user_id",
      table: "notification_preferences",
      columns: "user_id",
    },
    { name: "idx_team_invites_token", table: "team_invites", columns: "token" },
    {
      name: "idx_scan_history_user_id",
      table: "scan_history",
      columns: "user_id",
    },
    { name: "idx_api_usage_key_id", table: "api_usage", columns: "api_key_id" },
    {
      name: "idx_admin_audit_admin_id",
      table: "admin_audit_log",
      columns: "admin_id",
    },
    { name: "idx_scan_tags_scan_id", table: "scan_tags", columns: "scan_id" },
    { name: "idx_rate_limits_key", table: "rate_limits", columns: "key" },
    {
      name: "idx_device_trust_user_id",
      table: "device_trust",
      columns: "user_id",
    },
    {
      name: "idx_team_members_team",
      table: "team_members",
      columns: "team_id",
    },
  ],

  dropIndexes: [
    "idx_scan_history_status_pending_running",
    // AUDIT-009 migration-04: these four were added by the upgrade's
    // addIndexes and left behind by the downgrade, so a downgraded
    // database was not a true v2.0.0 shape.
    "idx_admin_audit_admin_created",
    "idx_admin_audit_target_user",
    "idx_api_usage_key_used",
    "idx_scan_history_user_scanned",
    // AUDIT-013 migrate-01: the performance indexes the upgrade now adds
    // on tables that SURVIVE the downgrade. Indexes on dropped tables and
    // dropped columns go away with them and are not repeated here.
    "idx_users_plan",
    "idx_users_stripe_customer",
    "idx_scan_history_share_token",
    "idx_badges_name",
    "idx_user_badges_user",
    "idx_billing_history_user",
    "idx_admin_user_notes_user",
    "idx_discord_user",
    "idx_discord_id",
    "idx_staff_activity_user_heartbeat",
    "idx_staff_activity_heartbeat",
    "idx_billing_verify_user",
    "idx_billing_verify_expires",
    "idx_gifted_subscriptions_user",
    "idx_gifted_subscriptions_expires",
    "idx_admin_notifications_active",
    "idx_admin_notifications_type",
    "idx_admin_notifications_cookie",
    "idx_access_rules_active",
    "idx_access_rules_value",
    "idx_access_rules_type",
    "idx_security_alerts_user",
    "idx_security_alerts_severity",
    "idx_security_alerts_created",
    "idx_broadcast_messages_status",
    "idx_broadcast_messages_created",
    "idx_broadcast_recipients_message",
    "idx_broadcast_recipients_user",
    "idx_subdomain_cache_cached_at",
    // The retention / foreign-key index set added by this upgrade, on
    // tables that survive the downgrade. DROP INDEX IF EXISTS is a safe
    // no-op for the ones a dropped table or column already took with it,
    // so the whole set is listed rather than half of it.
    "idx_broadcast_recipients_message_user",
    "idx_users_unsubscribe_token",
    "idx_users_email_lower",
    "idx_scan_history_url_scanned",
    "idx_teams_owner_id",
    "idx_sessions_impersonated_by",
    "idx_user_badges_awarded_by",
    "idx_user_badges_badge_id",
    "idx_admin_user_notes_admin_id",
    "idx_team_invites_invited_by",
    "idx_gifted_subscriptions_gifted_by",
    "idx_gifted_subscriptions_revoked_by",
    "idx_admin_notifications_created_by",
    "idx_access_rules_created_by",
    "idx_security_alerts_resolved_by",
    "idx_system_settings_updated_by",
    "idx_broadcast_messages_created_by",
    "idx_broadcast_messages_sent_by",
    // AUDIT-009 migration-01: belt-and-suspenders -- dropping
    // scan_history.status/is_public above already CASCADE-drops this
    // partial index, but DROP INDEX IF EXISTS is a safe no-op either way.
    "idx_scan_history_url_public_completed",
    // Belt-and-suspenders -- dropping scan_history.public_id above already
    // CASCADE-drops its unique index, but DROP INDEX IF EXISTS is a safe
    // no-op either way.
    "idx_scan_history_public_id",
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
