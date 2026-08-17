// CONFIG VALUES - Hardcoded Configuration Values

// These values are the source of truth for application configuration.
// Self-hosters: Modify these values to customize your deployment.

// GENERATED_CHECKS_LABEL / GENERATED_OG_IMAGE come from check-stats.generated.ts
// (written by scripts/compile-checks-knowledge.mjs on every build/dev start,
// see its roundDownForLabel/regenerateOgImage) so the "N+ checks" marketing
// number and social-card image can never drift from the real, current check
// count the way a hand-typed "750+" eventually did. Both remain admin-
// overridable at runtime (see TOTAL_CHECKS_LABEL / SEO_OG_IMAGE in
// lib/config/registry.ts) -- this is only the shipped default.
import {
  GENERATED_CHECKS_LABEL,
  GENERATED_OG_IMAGE,
} from "./check-stats.generated";

// App metadata - UPDATE THESE FOR YOUR DEPLOYMENT
export const CONFIG_APP_NAME = "VulnRadar";
export const CONFIG_APP_SLUG = "vulnradar";
export const CONFIG_APP_VERSION = "3.4.0";
// The minimum database schema version this app requires.
// App 3.0.0 requires schema v3.0.0 (ai_conversations + email unsubscribe).
// 3.0.1 made no schema changes. 3.0.2 and 3.1.0 both added tables/columns
// (ai_usage, system_error_logs, scan_tags.source, the Public Scans
// directory's share_publicly_listed flag, and the engine-feedback tables),
// all folded into the same "3.0.0" migration bucket rather than a new
// schema version number, since schema v3.0.0 itself has never shipped to
// any production database yet -- see
// scripts/migrate/versions/2.0.0-to-3.0.0.mjs. Run `npm run db:migrate`
// to upgrade a v2 database before starting.
export const CONFIG_MIN_SCHEMA_VERSION = "3.0.0";
// Tracks the scanner's detection logic specifically, independent of the app
// version above -- bumped only when a check's actual behavior changes.
// 3.0.2: fixed 3 false-positive bugs (dangerous-inline-js's overly broad
// Function() pattern, and both that check and the Trusted Types checks
// scanning framework-injected script content -- Next.js RSC streaming
// payloads and Cloudflare's bot-challenge script -- as if it were authored
// code; hardcoded-ip-addresses matching SVG icon path coordinates as IPs).
// 3.0.3: checkDKIM's selector list grew from 7 generic names to ~24,
// covering ProtonMail, Fastmail, Zoho, Mailchimp/Mandrill, SendGrid, and
// Klaviyo's own documented selectors (a domain on any of those previously
// false-flagged as missing DKIM despite having it correctly configured,
// caught scanning our own ProtonMail-hosted domain); and
// checkRobotsTxt's sensitive-path count no longer double-counts the same
// path when it's legitimately repeated across multiple User-agent blocks.
// 3.0.4: server-info no longer flags "Server: cloudflare"/"Server: Vercel"
// (names the CDN in front, not the origin's software or version -- gave an
// attacker nothing a real disclosure would). No new checks or categories
// added in either bump, so both are patch bumps, not minor.
// 3.1.0: two new categories.
// - "reputation" (3 checks): queries Google Web Risk for the scanned URL
//   and flags known malware/phishing/unwanted-software listings. Invisible
//   until WEB_RISK_API_KEY is configured, same pattern as every other
//   optional integration.
// - "active-probes" (1 check): the engine's first genuinely active check --
//   submits a canary value through every discovered form and flags one
//   that reflects it back unescaped (confirmed reflected XSS). Unlike
//   every other category, this one is opt-in only: it never runs from an
//   omitted/empty `scanners` filter, only when named explicitly (see
//   lib/scanner/async-checks.ts's buildBranches), since it writes to the
//   target instead of only reading it.
// 3.2.0: full accuracy audit across every existing check (metadata that
// described a different vulnerability than the detector actually looked
// for, context-blind keyword matches that fired on safe/defensive code or
// documentation, miscalibrated severities) -- 205 findings fixed, and 16
// checks removed outright for having no real backing detector (5 TLS
// cipher-suite checks impossible against Node's TLS stack, plus
// http-no-redirect, which fired regardless of whether the redirect was
// actually correct). Also added ~40 new checks across auth/API, headers,
// information disclosure, supply chain, email/DNS, client-side, secrets,
// and host-validation, each verified in both directions (fires on a real
// vulnerable example, stays silent on a safe/defensive counterexample and
// on documentation/tutorial context) before being shipped.
// 3.2.1: a real-world false-positive hunt against ~1200 third-party sites
// plus VulnRadar's own site (both public and behind login), grouping
// findings by title/host frequency to find systemic patterns at scale
// instead of reviewing case by case. Fixed: exposed-panel probes
// (Jenkins/Consul/MinIO/phpMyAdmin/Adminer/RabbitMQ) matching any SPA's
// catch-all shell response instead of the real panel; Twilio/Mailgun/
// Facebook secret patterns and the Twilio Account SID pattern
// specifically needing a nearby keyword too, since format alone still
// collided with unrelated tokens on large pages; the tagged-template XSS
// detector's unbounded regex spanning across unrelated later code;
// Connection String colliding with Sentry's own dsn= convention;
// safety-rating.ts's exploitable-pattern matcher bucketing every
// hardcoded-secret severity tier (including the deliberately low-risk
// ones) as "actively exploitable"; cookie-domain-no-leading-dot, a
// self-contradicting duplicate of cookie-domain-broad, merged and
// removed (794 checks total); prototype-pollution-client matching the
// standard defensive `= null` guard identically to a real sink; and,
// from scanning our own site specifically: form-method-get-sensitive (a
// React form's missing method attribute never means a real native GET
// submit), oauth-state-missing, bearer-token-exposed, sql-error-in-page
// and its differently-named twin sql-error-exposure, sensitive-endpoints,
// debug-endpoint, nginx/apache/iis-version-404-disclosure, source-code-
// comment, and email-enumeration (several from an unbounded regex
// bridging across unrelated page content -- one specifically from
// stripExampleContent deleting matched regions outright instead of
// replacing them, which could pull two distant, unrelated mentions
// directly adjacent to each other). Also recalibrated: dom-clobbering-
// vulnerable's "config" denylist entry (too generic, matches any docs
// heading anchor), hardcoded-ip-addresses missing the RFC 5737
// documentation ranges, admin-endpoint's evidence text overclaiming
// "publicly accessible" when it only checks URL shape (medium -> low),
// weak-password-policy matching the leading digit of "12" as "under 6",
// vibe-weak-password-policy firing on a login/existing-credential
// field's autocomplete="current-password"/"off" the same as a real
// signup field, and OCSP-stapling-absent / single-DNS-provider
// concentration downgraded from low to info. No new checks or
// categories, so a patch bump.
export const CONFIG_ENGINE_VERSION = "3.2.1";
export const CONFIG_APP_DESCRIPTION =
  "Scan websites for security vulnerabilities. Get instant reports with severity ratings, actionable fix guidance, and team collaboration tools.";
export const CONFIG_TOTAL_CHECKS_LABEL = GENERATED_CHECKS_LABEL;
export const CONFIG_APP_URL = "https://sandbox.vulnradar.dev";
export const CONFIG_APP_REPO = "VulnRadar/vulnradar.dev";
export const CONFIG_DISCORD_INVITE_URL = "https://discord.gg/Y7R6hdGbNe";
// Empty until a store listing is live for this fork/deployment.
export const CONFIG_CHROME_WEB_STORE_URL =
  "https://chromewebstore.google.com/detail/nbmifpplhhejdfokaglpomdnbaifngfj";
// Firefox AMO review passed 2026-08-15 -- see extension/README.md's status
// section, updated alongside this.
export const CONFIG_FIREFOX_ADDON_URL =
  "https://addons.mozilla.org/en-US/firefox/addon/vulnradar-website-scanner/";

// Emails - UPDATE THESE FOR YOUR DEPLOYMENT
export const CONFIG_SUPPORT_EMAIL = "support@vulnradar.dev";
export const CONFIG_LEGAL_EMAIL = "legal@vulnradar.dev";
export const CONFIG_SECURITY_EMAIL = "security@vulnradar.dev";
export const CONFIG_ENTERPRISE_EMAIL = "enterprise@vulnradar.dev";
export const CONFIG_NOREPLY_EMAIL = "noreply@vulnradar.dev";
export const CONFIG_TERMS_UPDATED_AT = "2026-08-14";
// Short admin-editable note describing what changed, shown in the re-accept
// modal's "what changed" callout alongside CONFIG_TERMS_UPDATED_AT. Empty
// hides that callout entirely.
//
// 2026-08-14: Privacy Policy now discloses staff impersonation and team
// resource sharing; Terms and Acceptable Use now describe API key/rate
// limits and scan technique accurately instead of a stale flat number, and
// Terms' scan-history retention line now matches the Privacy Policy instead
// of contradicting it.
//
// 2026-08-14 (second pass): Privacy Policy also corrected how it described
// TOTP/backup-code storage (TOTP secret is encrypted, backup codes are
// hashed -- the two had been swapped), corrected the Data Storage and
// Security section's blanket "hashed" claim for session tokens (stored as
// the raw token, not a hash) and API keys (encrypted by default, hashed
// only as a fallback with no encryption key configured), fixed a stale
// internal "see Section 3" cross-reference, and added disclosures that were
// missing entirely: GitHub OAuth / repo-based AI code review as a
// third-party integration, and email delivery logs, finding feedback, and
// in-app notifications in the Data Retention list. Set this back to "" on
// the next date bump that doesn't change any actual legal text.
export const CONFIG_TERMS_CHANGE_SUMMARY =
  "We updated the Privacy Policy to accurately describe how session tokens, API keys, and 2FA codes are stored, disclosed staff account-access support, team data sharing, and GitHub repo AI review, and fixed stale technical details in the Terms and Acceptable Use Policy.";

// BRANDING - UPDATE THESE FOR YOUR DEPLOYMENT

export const CONFIG_LOGO_URL = "/favicon.svg";
// Brand blue. Keep in sync with `--primary` in app/globals.css
// (hsl(213 94% 68%)). Used for the PWA theme colour and the browser UI tint.
export const CONFIG_PRIMARY_COLOR = "#60a5fa";
export const CONFIG_BACKGROUND_COLOR_DARK = "#0d1117";
export const CONFIG_BACKGROUND_COLOR_LIGHT = "#f5f7fa";
export const CONFIG_FOOTER_TEXT = `${CONFIG_APP_NAME} - Security Scanner`;

// SEO - UPDATE THESE FOR YOUR DEPLOYMENT
//
// Everything search engines and social cards read is declared here so a
// self-hosted deployment can rebrand without editing page files.

// Short pitch used as the default meta description and OpenGraph description.
export const CONFIG_SEO_TAGLINE = "Web Vulnerability Scanner";

// Terms to rank for. Keep these honest: stuffing unrelated terms is penalised.
export const CONFIG_SEO_KEYWORDS = [
  "vulnerability scanner",
  "web security scanner",
  "website security check",
  "security headers scanner",
  "SSL TLS scanner",
  "open source security scanner",
  "OWASP scanner",
  "API security testing",
  "self-hosted vulnerability scanner",
  "CI security scanning",
];

// Social card image, relative to the app root. 1200x630 is the size Twitter,
// LinkedIn, Slack, and Discord all render without cropping.
export const CONFIG_SEO_OG_IMAGE = GENERATED_OG_IMAGE;
export const CONFIG_SEO_OG_IMAGE_WIDTH = 1200;
export const CONFIG_SEO_OG_IMAGE_HEIGHT = 630;

// Social handles. Leave a value empty to omit that tag entirely.
export const CONFIG_SEO_TWITTER_HANDLE = "";
export const CONFIG_SEO_GITHUB_URL = `https://github.com/${CONFIG_APP_REPO}`;

// Search Console / Bing / Yandex ownership tokens. Leave empty to skip.
// Prefer setting these via env in a self-hosted deployment.
export const CONFIG_SEO_GOOGLE_VERIFICATION = "";
export const CONFIG_SEO_BING_VERIFICATION = "";

// Language and region the content targets.
export const CONFIG_SEO_LOCALE = "en_US";
export const CONFIG_SEO_LANGUAGE = "en";

// Organisation details for the JSON-LD Organization node.
export const CONFIG_SEO_ORG_FOUNDING_YEAR = "2025";
export const CONFIG_SEO_LICENSE = "GPL-3.0";

// COOKIE CONFIGURATION - UPDATE IF NEEDED FOR YOUR DEPLOYMENT

export const CONFIG_SESSION_COOKIE_NAME = "vulnradar_session";
export const CONFIG_SESSION_MAX_AGE_DAYS = 7;

export const CONFIG_VERSION_COOKIE_NAME = "vulnradar_last_seen_version";
export const CONFIG_VERSION_COOKIE_MAX_AGE_DAYS = 365;

export const CONFIG_DEVICE_TRUST_COOKIE_NAME = "vulnradar_device_trusted";
export const CONFIG_DEVICE_TRUST_MAX_AGE_DAYS = 30;

export const CONFIG_2FA_PENDING_COOKIE_NAME = "vulnradar_2fa_pending";
export const CONFIG_2FA_PENDING_MAX_AGE_SECONDS = 300;

// AUTHENTICATION TIMEOUTS - UPDATE IF NEEDED

export const CONFIG_SESSION_TIMEOUT_DAYS = 7;
export const CONFIG_PASSWORD_RESET_HOURS = 1;
export const CONFIG_EMAIL_VERIFICATION_HOURS = 24;
export const CONFIG_DEVICE_TRUST_DAYS = 30;
export const CONFIG_TOTP_VALIDITY_SECONDS = 30;
export const CONFIG_CLEANUP_INTERVAL_MS = 86400000;

// How long an emailed 6-digit 2FA code stays valid, whether it was sent by
// the password login flow, the OAuth login flow, or a manual resend. All
// three write to the same email_2fa_codes table with the same lifetime.
export const CONFIG_EMAIL_2FA_CODE_EXPIRY_MINUTES = 10;

// Minimum wait enforced between emailed 2FA code resend requests
// (app/api/v3/auth/2fa/email-send/route.ts). Guards both the SQL
// freshness check and the reported Retry-After.
export const CONFIG_EMAIL_2FA_RESEND_COOLDOWN_SECONDS = 60;

// OAuth state token lifetimes. NOT admin-configurable (see
// NEVER_CONFIGURABLE in registry.ts): these are anti-replay/anti-CSRF
// windows on the signed OAuth state token, and widening them weakens that
// protection. Read once per sign/verify call from these constants, not from
// the runtime resolver.
//
// How long a Discord-connect state token stays valid (seconds). Tight on
// purpose: this flow assumes an already-signed-in user re-approving a link,
// not a full first-time OAuth handshake.
export const CONFIG_DISCORD_OAUTH_STATE_TTL_SECONDS = 60;
// How long the Google/GitHub/Discord sign-in, sign-up, and account-link
// OAuth state token stays valid (seconds). Longer than the Discord-connect
// window above: this covers a full first-time provider consent screen.
export const CONFIG_OAUTH_STATE_TTL_SECONDS = 5 * 60;
// Maximum allowed future-dated timestamp skew accepted on an incoming OAuth
// state token before it is treated as forged/expired (seconds). Shared by
// both state formats above -- previously hardcoded identically in each
// file.
export const CONFIG_OAUTH_STATE_CLOCK_SKEW_SECONDS = 5 * 60;

// TOTP/2FA login code clock-drift tolerance: accepts the current 30-second
// step plus this many steps before/after. NOT admin-configurable (see
// NEVER_CONFIGURABLE in registry.ts): this is a brute-force/drift tradeoff
// on the second factor itself.
export const CONFIG_TOTP_VERIFY_WINDOW = 1;

// GDPR data export: how often a user can request a fresh export. See
// app/api/v3/data-request/route.ts, which enforces this same number
// server-side; kept here so the profile privacy tab can compute the exact
// cooldown-end timestamp itself right after a download instead of guessing.
export const CONFIG_DATA_EXPORT_COOLDOWN_DAYS = 30;

// Floor enforced on signup and reset alike, so the two flows cannot drift
// apart (they used to: 8 characters at signup, 12 at reset).
export const CONFIG_PASSWORD_MIN_LENGTH = 12;

// How often the periodic database cleanup pass (expired sessions, tokens,
// old scans, stale caches, etc, see lib/database/cleanup.ts) runs.
// Distinct from CONFIG_CLEANUP_INTERVAL_MS above, which only gates the
// much cheaper inline expired-session check inside getSession().
export const CONFIG_DB_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// How often the scheduled-scans worker (lib/scanner/scheduled-scans-worker.ts)
// polls scheduled_scans for due rows. Short enough that an hourly schedule's
// jitter window (up to 15 min, see schedule-timing.ts) is covered by several
// polling ticks, long enough that idle deployments with no due schedules
// aren't hitting the database every few seconds for nothing.
export const CONFIG_SCHEDULE_WORKER_POLL_INTERVAL_MS = 2 * 60 * 1000;

// How many due schedules the worker runs concurrently per polling tick.
// Bounds the worst case (a large backlog of overdue schedules, or many
// same-cadence schedules landing in one tick) to a fixed number of
// simultaneous scans instead of firing them all via one big Promise.all --
// the actual crash-prevention mechanism for a thundering herd. A backlog
// larger than this just spreads across more polling ticks instead of all
// running at once.
export const CONFIG_SCHEDULE_WORKER_BATCH_CONCURRENCY = 5;

// How long a claimed schedule row is "soft-locked" (next_run_at pushed
// forward) while its scan runs, in minutes. NOT admin-configurable (see
// NEVER_CONFIGURABLE in registry.ts): this must stay comfortably above
// CONFIG_SCAN_TIMEOUT_SECONDS / CONFIG_CRAWL_SCAN_TIMEOUT_SECONDS or a
// long-running scan's claim can expire mid-run and let a second worker
// double-claim it.
export const CONFIG_SCHEDULE_WORKER_CLAIM_BUFFER_MINUTES = 15;

// IP BINDING - UPDATE IF NEEDED
//
// Optionally binds a session or API key to the subnet it was first seen
// on, as a defense against a stolen session cookie or leaked API key
// being replayed from a different network. Comparison is subnet-level,
// not exact IP: mobile carriers, wifi-to-cellular handoffs, and
// corporate NATs routinely rotate the last IPv4 octet mid-session, and a
// strict exact-IP check would sign real users out constantly. A mismatch
// never hard-locks an account -- a session mismatch is treated like an
// expired session (log in again) and an API key mismatch declines only
// that one request without revoking the key -- and the account owner is
// notified either way. See lib/auth/auth.ts and lib/api/api-keys.ts.
//
// Both are off by default. This is a live SaaS with real mobile users as
// well as a self-hostable product marketed for CI use: a browser session
// genuinely does move between networks, and an API key is not
// necessarily the "stable script IP" it sounds like -- a key used from
// GitHub Actions or another shared-runner CI provider gets a different,
// unpredictable IP on every run, not a fixed one. Turning this on is the
// right call for a self-hoster running scans from one fixed server or a
// team that wants session hijacking alerts badly enough to accept some
// re-login prompts; it is not a safe blanket default for every
// deployment.
export const CONFIG_SESSION_IP_BINDING_ENABLED = false;
export const CONFIG_SESSION_IP_BINDING_IPV4_PREFIX = 24;
export const CONFIG_SESSION_IP_BINDING_IPV6_PREFIX = 48;

export const CONFIG_API_KEY_IP_BINDING_ENABLED = false;
// API keys are bound to a narrower subnet than sessions when enabled: a
// script or server that's a good fit for this feature at all usually has
// one address, not a rotating carrier-assigned range, so the tighter
// default is the stronger, still-correct policy for that case.
export const CONFIG_API_KEY_IP_BINDING_IPV4_PREFIX = 32;
export const CONFIG_API_KEY_IP_BINDING_IPV6_PREFIX = 128;

// DATABASE CONNECTION POOL - UPDATE IF NEEDED
//
// Defaults are sized for a single-box self-hosted deployment (the
// `docker compose up` path) against a stock PostgreSQL, which allows 100
// connections in total. Every app process opens its own pool, so the real
// ceiling is CONFIG_DB_POOL_MAX times the number of processes.
//
// Each value can be overridden per deployment without a rebuild. See
// lib/database/db.ts for the environment variable names.

// Maximum simultaneous connections held open by one app process.
// Raise this only after raising PostgreSQL's max_connections to match.
export const CONFIG_DB_POOL_MAX = 10;

// Minimum connections kept warm. 0 lets the pool drain fully when idle,
// which is what a small self-hosted box wants. Set it above 0 on a busy
// deployment to avoid paying TCP plus TLS setup on the first request
// after a quiet period.
export const CONFIG_DB_POOL_MIN = 0;

// How long an idle connection is kept before the pool closes it.
export const CONFIG_DB_IDLE_TIMEOUT_MS = 30000;

// How long a caller waits for a free connection before failing. This is
// the backpressure knob: when the pool is saturated, requests fail here
// with a clear error instead of piling up unbounded.
export const CONFIG_DB_CONNECTION_TIMEOUT_MS = 5000;

// Server-side cap on a single statement. Prevents one slow query from
// occupying a pool slot indefinitely and starving login.
export const CONFIG_DB_STATEMENT_TIMEOUT_MS = 30000;

// Client-side cap on a single query. Kept equal to the statement timeout
// so the driver and the server agree on when to give up.
export const CONFIG_DB_QUERY_TIMEOUT_MS = 30000;

// Budget for the database probe in the readiness endpoint. Deliberately
// short: a health check that hangs is worse than one that reports failure.
export const CONFIG_DB_HEALTHCHECK_TIMEOUT_MS = 3000;

// ADMIN ALERTS
//
// Outbound webhook for critical system events (boot-time schema failures,
// scans orphaned by an unclean shutdown), so an operator finds out without
// having to keep /admin open. Works with Slack/Discord/PagerDuty/any SIEM
// that accepts an incoming webhook -- no vendor-specific integration.
// Leave the URL empty to disable (default: off, no operator has configured
// one yet). See lib/admin/alert-webhook.ts.
export const CONFIG_ADMIN_ALERT_WEBHOOK_URL = "";
export const CONFIG_ADMIN_ALERT_WEBHOOK_SECRET = "";

// Staff/admin panel access already SHOWS which staff lack 2FA
// (components/admin/staff/staff-list.tsx) but never enforced it -- a
// password-only staff or admin account could still reach every admin
// route. Off by default so flipping on this app's own audit doesn't
// instantly lock out existing staff who haven't set up 2FA yet without
// warning; an operator turns this on once their staff are ready. See
// requireStaff/requireAdmin in lib/auth/authorization.ts.
export const CONFIG_ENFORCE_STAFF_2FA = false;

// Staff SSO: a generic OIDC login path for staff/admin accounts (AUDIT-010,
// admin-feature-gap: "privileged accounts authenticate the same as
// customers, so a self-hosting org can't put admin access behind their own
// IdP"). Deliberately protocol-generic (not a specific vendor SDK) so it
// points at any OIDC-compliant issuer (Okta, Azure AD/Entra ID, Google
// Workspace, Authentik, Keycloak, etc) via that issuer's own discovery
// document, the same way this app already lets an operator point
// AI_PROVIDER at any OpenAI-compatible endpoint rather than hardcoding one
// vendor. All three empty by default -- disabled until an operator
// configures their own IdP. See lib/auth/staff-oidc.ts.
export const CONFIG_STAFF_OIDC_ISSUER_URL = "";
export const CONFIG_STAFF_OIDC_CLIENT_ID = "";
export const CONFIG_STAFF_OIDC_CLIENT_SECRET = "";

// RATE LIMITING - UPDATE IF NEEDED

export const CONFIG_RATE_LIMIT_LOGIN_ATTEMPTS = 5;
export const CONFIG_RATE_LIMIT_LOGIN_WINDOW_MINUTES = 15;

export const CONFIG_RATE_LIMIT_SIGNUP_ATTEMPTS = 3;
export const CONFIG_RATE_LIMIT_SIGNUP_WINDOW_MINUTES = 60;

export const CONFIG_RATE_LIMIT_FORGOT_PASSWORD_ATTEMPTS = 3;
export const CONFIG_RATE_LIMIT_FORGOT_PASSWORD_WINDOW_MINUTES = 10;

export const CONFIG_RATE_LIMIT_API_REQUESTS = 100;
export const CONFIG_RATE_LIMIT_API_WINDOW_MINUTES = 60;

export const CONFIG_RATE_LIMIT_SCAN_REQUESTS = 100;
export const CONFIG_RATE_LIMIT_SCAN_WINDOW_MINUTES = 60;

export const CONFIG_RATE_LIMIT_BULK_SCAN_REQUESTS = 10;
export const CONFIG_RATE_LIMIT_BULK_SCAN_WINDOW_MINUTES = 60;

// Per-user cap on BrowserBase session creation. BrowserBase is a paid
// metered service, so without this a compromised session cookie can rack
// up real cost.
export const CONFIG_RATE_LIMIT_BROWSER_SESSION_ATTEMPTS = 20;
export const CONFIG_RATE_LIMIT_BROWSER_SESSION_WINDOW_MINUTES = 60;

// Per-user cap on AI support chat requests, to prevent cost amplification.
export const CONFIG_RATE_LIMIT_AI_CHAT_ATTEMPTS = 60;
export const CONFIG_RATE_LIMIT_AI_CHAT_WINDOW_MINUTES = 60;

// Per-admin cap on admin PATCH re-auth attempts, to prevent brute-forcing
// the admin password through the re-auth gate.
export const CONFIG_RATE_LIMIT_ADMIN_REAUTH_ATTEMPTS = 10;
export const CONFIG_RATE_LIMIT_ADMIN_REAUTH_WINDOW_MINUTES = 15;

// Per-user cap on billing verification code attempts. 6-digit codes have
// 900k combinations; without this gate an attacker with a stolen session
// cookie could brute-force the code in its validity window.
export const CONFIG_RATE_LIMIT_BILLING_VERIFY_ATTEMPTS = 5;
export const CONFIG_RATE_LIMIT_BILLING_VERIFY_WINDOW_MINUTES = 5;

// Per-user cap on team invite sends, to prevent email spam via a
// compromised or malicious team-owner account.
export const CONFIG_RATE_LIMIT_TEAM_INVITE_ATTEMPTS = 20;
export const CONFIG_RATE_LIMIT_TEAM_INVITE_WINDOW_MINUTES = 60;

// Per-user cap on AI finding-verification requests (POST /api/v3/scan/verify
// and POST /api/v3/scan/verify-batch share this one bucket -- both run the
// same per-finding AI verification pipeline, so a caller can't double their
// effective quota by hitting the two routes separately). Tighter than
// CONFIG_RATE_LIMIT_AI_CHAT_ATTEMPTS even though it fires far less often
// (once per scan review, not once per message): a single request here fans
// out into one AI call per finding, so its worst-case cost per request is
// much higher than one chat message.
export const CONFIG_RATE_LIMIT_AI_VERIFY_ATTEMPTS = 20;
export const CONFIG_RATE_LIMIT_AI_VERIFY_WINDOW_MINUTES = 60;

// Per-user cap on AI scan-summary generation (POST
// /api/v3/history/[id]/summary). A cached summary short-circuits before this
// gate is even checked (see the route), so this only bounds genuine
// generate/regenerate calls, not repeat views of an existing summary.
export const CONFIG_RATE_LIMIT_AI_SUMMARY_ATTEMPTS = 20;
export const CONFIG_RATE_LIMIT_AI_SUMMARY_WINDOW_MINUTES = 60;

// Per-user cap on scan tag add/remove calls (POST /api/v3/scan/tags). No
// external cost like AI or email, but still an unbounded write against a
// user's own scan history without a gate -- generous enough that normal
// tagging never hits it.
export const CONFIG_RATE_LIMIT_SCAN_TAGS_ATTEMPTS = 60;
export const CONFIG_RATE_LIMIT_SCAN_TAGS_WINDOW_MINUTES = 60;

// Per-IP cap on GET /api/v3/public-scans -- unauthenticated by design (it's
// a public directory), which means it's also unauthenticated by design for
// an attacker: no session/API-key gate to fall back on, so this is the only
// throttle standing between it and a paginated-query amplification target.
// Generous enough that a real visitor paging through the directory never
// hits it.
export const CONFIG_RATE_LIMIT_PUBLIC_SCANS_ATTEMPTS = 60;
export const CONFIG_RATE_LIMIT_PUBLIC_SCANS_WINDOW_MINUTES = 1;

// Per-userId cap on 2FA/TOTP verification attempts (POST
// /api/v3/auth/2fa/verify), the brute-force throttle on 6-digit codes.
export const CONFIG_RATE_LIMIT_2FA_VERIFY_ATTEMPTS = 5;
export const CONFIG_RATE_LIMIT_2FA_VERIFY_WINDOW_MINUTES = 5;

// SCANNING CONFIGURATION - UPDATE IF NEEDED

export const CONFIG_MAX_URL_LENGTH = 2048;
export const CONFIG_MAX_URLS_BULK = 100;
export const CONFIG_SCAN_TIMEOUT_SECONDS = 300;
export const CONFIG_BULK_SCAN_TIMEOUT_SECONDS = 1800;
// Watchdog ceiling for a background crawl scan job (discovery + up to
// MAX_PAGES pages, each with its own ~15s fetch and ~15s async-check
// budget). Longer than CONFIG_SCAN_TIMEOUT_SECONDS because it covers many
// pages, shorter than CONFIG_BULK_SCAN_TIMEOUT_SECONDS because a crawl is
// bounded to one site rather than up to CONFIG_MAX_URLS_BULK arbitrary URLs.
export const CONFIG_CRAWL_SCAN_TIMEOUT_SECONDS = 900;
// Suggested interval for a client polling GET /api/v3/scan/status/:id.
// Not enforced server-side; exported so a UI consuming the endpoint has one
// source of truth instead of a hardcoded number in a component.
export const CONFIG_SCAN_STATUS_POLL_INTERVAL_MS = 2000;
export const CONFIG_DEFAULT_SEVERITY_THRESHOLD = "low";

// Abort timeout for the primary target-page fetch in every scan route that
// runs outside the shared execute-scan pipeline (demo scan, bulk scan,
// authenticated scan). lib/scanner/safe-fetch.ts's own default covers the
// main POST /api/v3/scan and /scan/crawl pipeline separately.
export const CONFIG_SCAN_FETCH_TIMEOUT_MS = 15000;
// Promise.race ceiling for the async-checks layer (DNS/TLS/reputation etc)
// in those same three routes -- a check that hasn't finished by this point
// is dropped from the result rather than delaying the response further.
export const CONFIG_SCAN_ASYNC_CHECKS_TIMEOUT_MS = 15000;
// Bytes read from the scanned page's response body before body-based checks
// run, in demo/bulk/authenticated scanning.
export const CONFIG_SCAN_RESPONSE_BODY_MAX_BYTES = 1 * 1024 * 1024;

// SCANNER ENGINE CONFIGURATION - UPDATE IF NEEDED
//
// Tunables for the core scan-execution and discovery pipelines
// (lib/scanner/*). Distinct from the request-shape limits above.

// How long a discovered-subdomain result (crt.sh/hackertarget/
// subdomain.center/rapiddns) is cached before a fresh lookup runs. Shared by
// the write side (app/api/v3/scan/discover/route.ts), the read-only lookup
// used by the shared-scan view (lib/scanner/subdomain-cache.ts), and the
// cleanup job's housekeeping delete (lib/database/cleanup.ts) -- all three
// read/write the same subdomain_cache table and must agree on the window.
export const CONFIG_SUBDOMAIN_CACHE_TTL_HOURS = 4;
// Simultaneous HEAD-request reachability checks fired per batch while
// probing discovered subdomains.
export const CONFIG_SUBDOMAIN_DISCOVERY_HTTP_CONCURRENCY = 25;

// Caps for the link-following crawl-discovery endpoint (POST
// /api/v3/scan/crawl/discover), distinct from the main crawl-scan job below.
export const CONFIG_CRAWL_DISCOVER_MAX_PAGES = 20;
export const CONFIG_CRAWL_DISCOVER_FETCH_TIMEOUT_MS = 8000;
export const CONFIG_CRAWL_DISCOVER_BODY_MAX_BYTES = 512 * 1024;

// Caps for an actual crawl scan job (lib/scanner/execute-crawl-scan.ts, the
// background job body for POST /api/v3/scan/crawl).
export const CONFIG_CRAWL_SCAN_MAX_PAGES = 15;
export const CONFIG_CRAWL_PAGE_FETCH_TIMEOUT_MS = 8000;

// Bytes read from a page's response body before content-based checks run,
// shared by the single-URL and crawl scan pipelines
// (lib/scanner/execute-scan.ts, lib/scanner/execute-crawl-scan.ts).
export const CONFIG_SCANNER_MAX_RESPONSE_BODY_BYTES = 1 * 1024 * 1024;

// Ceiling for one top-level branch (DNS, TLS, or live-fetch) of the async
// checks layer (lib/scanner/async-checks.ts). A branch that hasn't
// finished by this point is reported as incomplete rather than blocking the
// others.
export const CONFIG_SCANNER_ASYNC_BRANCH_TIMEOUT_MS = 12000;

// How long the CISA Known Exploited Vulnerabilities catalog is cached
// (in-memory and DB-backed) before a fresh fetch runs. The feed itself
// updates roughly daily, so several hours of staleness is fine.
export const CONFIG_CVE_KEV_CACHE_TTL_HOURS = 12;

// Distinct S3/GCS/Azure bucket hostnames actively probed for public listing
// per scan. A site referencing more buckets than this only gets the first
// N checked.
export const CONFIG_SCANNER_BUCKET_PROBE_MAX_CANDIDATES = 5;

// Timeout for outbound calls to third-party threat-intel services: the CISA
// KEV feed, the FIRST.org EPSS API, and the Google Web Risk reputation
// lookup.
export const CONFIG_SCANNER_THREAT_INTEL_API_TIMEOUT_MS = 5000;

// Due schedules claimed per polling tick by the scheduled-scans worker
// (lib/scanner/scheduled-scans-worker.ts). A backlog larger than this just
// spreads across additional ticks rather than all being claimed at once.
export const CONFIG_SCHEDULE_WORKER_CLAIM_LIMIT = 200;

// Row cap on the main scan-history list endpoint (GET /api/v3/history),
// independent of CONFIG_PAGINATION_MAX_PAGE_SIZE, which this route doesn't
// use.
export const CONFIG_HISTORY_LIST_MAX_ROWS = 100;

// Client-enforced cap on how many URLs may be pasted into the bulk-scan
// form (components/scanner/scan-form.tsx). Deliberately kept independent of
// the server-enforced CONFIG_MAX_URLS_BULK: this form fans out one request
// per URL, so it needs its own, typically lower, ceiling.
export const CONFIG_BULK_SCAN_CLIENT_URL_LIMIT = 10;

// Discovered forms given a canary-reflection submission per scan by each
// form-submitting probe in lib/scanner/active-probes/. NOT admin-configurable
// (see NEVER_CONFIGURABLE in registry.ts): these are the only checks that
// submit real writes to the target, and raising it directly increases live
// traffic sent to someone else's site.
export const CONFIG_SCANNER_ACTIVE_PROBE_MAX_FORMS = 10;

// API CONFIGURATION

export const CONFIG_API_KEY_PREFIX = "vr_live_";
export const CONFIG_DEFAULT_API_KEY_DAILY_LIMIT = 50;
export const CONFIG_API_CURRENT_VERSION = "v3";
export const CONFIG_API_SUPPORTED_VERSIONS = ["v3"];

// AI CHAT CONFIGURATION
//
// CONFIG_AI_CHAT_MAX_TOKENS: budget for one assistant reply. Reasoning
//   models (MiniMax-M2.x, DeepSeek-R1, QwQ) spend tokens inside a <think>
//   block, and Anthropic/Gemini's native "thinking" params (see
//   lib/ai/reasoning.ts) spend tokens on a separate thinking budget, both
//   before the model writes the visible answer -- too small a cap here
//   truncates the answer, not just the reasoning. 8192 clears the
//   documented output ceiling of every provider this app talks to natively
//   (MiniMax M2.7 tops out at 131K output, but a support-chat reply has no
//   business running that long) while leaving real headroom over the old
//   4096 for a model that reasons first.
export const CONFIG_AI_CHAT_MAX_TOKENS = 8192;
// 90 days matches the retention window promised in the privacy policy
// ("AI chat history: 90 days, then automatically deleted" --
// app/legal/privacy/page.tsx). The shipped default has to agree with that
// public promise since lib/database/cleanup.ts enforces this exact setting.
export const CONFIG_AI_CHAT_HISTORY_DAYS = 90;
export const CONFIG_AI_CHAT_MAX_INPUT_LENGTH = 2000;

// AI VERIFICATION (deep scan) CONFIGURATION
// CONFIG_AI_VERIFY_MAX_TOKENS: budget for each per-finding AI call.
//   Reasoning models (DeepSeek-R1, MiniMax-M2, QwQ, o1) consume tokens inside
//   their <think> block before writing the answer, and Anthropic's native
//   `thinking` param (lib/ai/reasoning.ts) reserves up to half of this
//   budget for its own thinking block -- set this high enough that the
//   model finishes thinking AND still emits the JSON afterward. Raised from
//   1500, then from 3000: a finding whose evidence requires cross-checking
//   two headers against each other (e.g. an enforced CSP vs. its
//   report-only sibling for a Trusted Types directive) measurably needs
//   more of the thinking budget than a single-header presence check, and at
//   3000 the visible one-sentence JSON answer was getting cut off mid-word
//   after thinking ran long, landing as a real, reproduced truncation bug,
//   not just a hypothetical. Non-reasoning models only need ~100 tokens for
//   the tiny JSON output, but extra headroom is harmless.
export const CONFIG_AI_VERIFY_MAX_TOKENS = 6000;
// Per-finding HTTP timeout (ms): how long to wait for the AI API to respond.
// Raised from 40_000: a scan with 50+ findings routinely hit this ceiling on
// a slower or reasoning-model provider, silently dropping the finding to
// "no verdict" instead of "uncertain" (see callVerify's catch block in
// lib/ai/verify-findings.ts) well before CONFIG_AI_VERIFY_TOTAL_TIMEOUT_MS
// below was anywhere close to running out. CONFIG_AI_VERIFY_TOTAL_TIMEOUT_MS
// is raised proportionally alongside this so the worst-case chunk math still
// covers a large scan.
export const CONFIG_AI_VERIFY_CALL_TIMEOUT_MS = 60_000;
// How long to wait for the initial HTTP probe of the target site (ms).
export const CONFIG_AI_VERIFY_PROBE_TIMEOUT_MS = 8_000;
// Findings are verified in chunks of this many concurrent AI calls rather
// than firing every finding at once. Bounds how many simultaneous
// connections a single scan opens against the provider (avoiding
// rate-limit 429 storms on large scans) and keeps each chunk's own runtime
// predictable against CONFIG_AI_VERIFY_TOTAL_TIMEOUT_MS below.
//
// Raised from 5: at 5, the numbers below simply didn't support finishing a
// realistic large scan (this product markets "310+" checks, so a complex
// real-world site's finding count can run past 100). 10 keeps rate-limit
// exposure in the same ballpark -- still nowhere near "every finding at
// once" -- while roughly doubling throughput per round. Deliberately not
// pushed past ~10-15: that's the point where fan-out starts looking like
// the unbounded-Promise.race version this chunking replaced.
export const CONFIG_AI_VERIFY_CHUNK_SIZE = 10;
// Hard ceiling for the entire deep-scan batch (ms), across however many
// chunks it takes to get through every finding. Verdicts are persisted
// after each chunk (see lib/ai/verify-findings.ts), so hitting this
// ceiling stops further chunks rather than discarding work already done.
//
// Raised from 300_000 alongside CONFIG_AI_VERIFY_CALL_TIMEOUT_MS going from
// 40_000 to 60_000 above -- left alone, that call-timeout raise would have
// SHRUNK worst-case coverage (300_000 / 60_000 = 5 chunks instead of 7-8),
// the opposite of the point. Worst case now (every call in every chunk hangs
// for the full call timeout -- a provider outage): floor(600_000 / 60_000) =
// 10 full chunks attempted before the deadline check trips, plus the chunk
// already in flight when it does, so up to 11 chunks x 10 findings = 110
// findings attempted (all returning no verdict) over a bounded ~660s -- not
// unbounded, just wide enough to cover a real 50-100+ finding scan even on a
// slow or reasoning-model provider. Typical case (a responsive provider,
// call latency well under the 60s ceiling): a pessimistic ~15-20s per chunk
// still clears 30-40 chunks = 300-400 findings inside this budget.
// This is an on-demand, user-triggered action (the "Verify with AI" scan
// action), not part of the main scan request, so a multi-minute budget is
// acceptable UX the same way CONFIG_SCAN_TIMEOUT_SECONDS/
// CONFIG_CRAWL_SCAN_TIMEOUT_SECONDS already accept minutes for a scan the
// user explicitly asked for and is watching a progress state for.
//
// Note: the /api/v3/scan/verify and /api/v3/scan/verify-batch routes each
// also have their own `maxDuration` (currently 720s, i.e. this budget plus
// the probe timeout plus one more call-timeout's worth of overrun plus
// slack) -- this constant bounds lib/ai's own loop, not the platform, and
// the two must be kept in that order (route maxDuration > this value) or
// the platform kills the request before this deadline ever gets a chance
// to fire cleanly.
export const CONFIG_AI_VERIFY_TOTAL_TIMEOUT_MS = 600_000;

// Hard cap on findings[] accepted by one call to POST /api/v3/scan/verify-batch.
// Unlike /api/v3/scan/verify (which only ever processes findings already
// stored on one of the caller's own scans), verify-batch takes an arbitrary
// caller-supplied findings array -- with no cap, any authenticated caller
// (including a free-tier API key) could force unbounded AI spend in a single
// request. 50 is "a few dozen" with headroom: comfortably above a realistic
// scan's finding count, and small enough that 50 findings / 10-per-chunk
// (CONFIG_AI_VERIFY_CHUNK_SIZE) = 5 chunks finishes in a small fraction of
// CONFIG_AI_VERIFY_TOTAL_TIMEOUT_MS even in a slow-provider worst case.
export const CONFIG_AI_VERIFY_BATCH_MAX_FINDINGS = 50;

// Characters of the live-probed page body sent to the AI verifier for
// cross-checking body-content findings (mixed-content, inline styles,
// third-party scripts, autocomplete attributes). Raised from 8192: that was
// rarely enough to reach past a real page's <head>, so the verifier
// routinely couldn't see the markup it was asked to confirm.
export const CONFIG_AI_VERIFY_PROBE_BODY_SNIPPET_CHARS = 24576;

// AI SCAN SUMMARY CONFIGURATION (lib/ai/scan-summary.ts, POST
// /api/v3/history/[id]/summary)
//
// CONFIG_AI_SUMMARY_MAX_TOKENS: budget for the one-shot "3 to 5 sentence"
//   scan summary call. Same physics as CONFIG_AI_CHAT_MAX_TOKENS and
//   CONFIG_AI_VERIFY_MAX_TOKENS above: reasoning models (MiniMax-M2.x,
//   DeepSeek-R1, QwQ) spend tokens inside a <think> block, and Anthropic's
//   native `thinking` param (lib/ai/reasoning.ts) reserves up to half of
//   this budget for its own thinking block, both before the model writes
//   the visible summary -- too small a cap here truncates the prose itself,
//   not just the reasoning that preceded it. Raised from a hardcoded 400,
//   which left a reasoning model with almost nothing to answer with once
//   thinking ran (resolveAnthropicThinkingBudget(400) doesn't even clear
//   the 1024-token floor to request native thinking at all, and a
//   provider using inline <think> tags has no such floor -- it can spend
//   the entire 400 tokens thinking and leave zero for the answer).
//   Matched to CONFIG_AI_VERIFY_MAX_TOKENS rather than derived from
//   scratch: that constant was raised from 3000 to 6000 after the exact
//   same failure mode (a short visible answer -- there, one sentence of
//   JSON; here, one paragraph of prose) was measurably cut off mid-word by
//   thinking eating too much of a smaller budget. A summary's "3 to 5
//   sentences" is the same order of magnitude as verify's one-sentence
//   JSON reason field, so the number that already proved sufficient there
//   is a safer starting point than guessing a smaller one for this call.
export const CONFIG_AI_SUMMARY_MAX_TOKENS = 6000;

// CONFIG_AI_SUMMARY_CALL_TIMEOUT_MS: how long to wait for the AI provider on
//   the single scan-summary call above. Matched to
//   CONFIG_AI_VERIFY_CALL_TIMEOUT_MS (40s) rather than kept at the old
//   hardcoded 12s: that 12s value was sized for the original 400-token
//   budget, and was never raised alongside it when the budget above went to
//   6000 -- a reasoning model given 15x more room to think and write
//   routinely needs more than 12s, so the summary call started aborting
//   ("This operation was aborted") and POST /api/v3/history/[id]/summary
//   returning 502 far more often than before, even though nothing about the
//   AI provider itself had changed.
export const CONFIG_AI_SUMMARY_CALL_TIMEOUT_MS = 40_000;

// Highest-severity findings included in the scan-summary prompt, so a scan
// with hundreds of findings still produces a small prompt.
export const CONFIG_AI_SUMMARY_TOP_FINDINGS_LIMIT = 6;
// Character-length backstop on the cleaned summary text, a second,
// independent ceiling after the token budget above in case a model ignores
// the "3 to 5 sentences" instruction and writes at length anyway.
export const CONFIG_AI_SUMMARY_MAX_OUTPUT_CHARS = 4000;

// AI AUTO-TAG SUGGESTION CONFIGURATION (lib/ai/auto-tag-suggest.ts). Fires
// for a scan whose findings matched none of lib/tags/auto-tags.ts's
// hardcoded rules. Short and cheap by design -- this must never become a
// slow background job that piles up.
export const CONFIG_AI_AUTOTAG_CALL_TIMEOUT_MS = 12_000;
export const CONFIG_AI_AUTOTAG_MAX_TOKENS = 120;
export const CONFIG_AI_AUTOTAG_TOP_FINDINGS_LIMIT = 15;
// At most this many AI-suggested tags saved per scan. Tied to the "1 to 2
// tags" instruction in the model's system prompt, so raising this alone
// only changes the ceiling on what's kept, not model behavior.
export const CONFIG_AI_AUTOTAG_MAX_SUGGESTIONS = 2;

// UNIFIED AI USAGE (lib/billing/ai-usage.ts): fixed-window token tracking
// shared across AI chat (app/api/v3/ai/chat), AI finding verification
// (lib/ai/verify-findings.ts), and AI scan summaries
// (lib/ai/scan-summary.ts). GitHub repo AI code review resets on this
// exact same window (see CONFIG_BILLING_*_GITHUB_REVIEW_TOKENS_PER_WINDOW
// below), just through its own separate table/cap sized much larger per
// call, since one review call covers a whole repo instead of one chat/
// verify/summary call.
//
// A FIXED window, not the rolling window VulnRadar's own hosted AI
// provider uses (MiniMax's Token Plan quota is a 5-hour rolling window
// plus a weekly window -- platform.minimax.io/docs/guides/rate-limits).
// Fixed is much simpler to implement and reason about correctly than a
// rolling window, while staying the same cadence order-of-magnitude as
// the underlying provider.
export const CONFIG_AI_USAGE_WINDOW_HOURS = 5;

// Per-plan AI token budgets for the fixed window above. AI chat, AI
// finding verification, and AI scan summaries had ZERO plan-based gating
// before this -- only a flat per-hour request-count rate limit applied
// equally to every plan regardless of tier (see RATE_LIMITS.aiChat/
// aiVerify/aiSummary in lib/rate-limiting/rate-limit.ts, which still
// apply independently of this token cap). These are starting defaults
// sized so no existing free-tier user regresses to zero, not a final
// product decision -- tune via the admin Settings UI like every other
// Billing group value here. Like githubReviewTokensPerWindow, elite
// still gets a real finite number rather than -1 (unlimited): VulnRadar's
// AI usage runs through subsidized/free-tier provider capacity here too,
// so the same "no tier is ever an unbounded budget" reasoning applies.
export const CONFIG_BILLING_FREE_AI_TOKENS_PER_WINDOW = 80_000;
export const CONFIG_BILLING_CORE_SUPPORTER_AI_TOKENS_PER_WINDOW = 400_000;
export const CONFIG_BILLING_PRO_SUPPORTER_AI_TOKENS_PER_WINDOW = 2_000_000;
export const CONFIG_BILLING_ELITE_SUPPORTER_AI_TOKENS_PER_WINDOW = 8_000_000;

// GitHub repo AI code review (lib/ai/review-source.ts). Separate from the
// AI_VERIFY_* settings above: verify sends one small finding + a live HTTP
// probe per call, a code review sends whole file contents, so the token
// budget per call needs to be much larger.
//
// Hard per-run ceiling, in estimated tokens (see
// lib/scanner/github-repo-scan.ts's rough chars-per-token estimate). This
// applies regardless of plan or remaining monthly quota, and regardless of
// whether the user is using VulnRadar's own AI or their own key -- it is a
// blunt guard against a single run trying to push an enormous repo through
// one AI call and hanging or ballooning cost/latency. If a repo's estimated
// content exceeds this, the scan is rejected upfront with a clear message
// rather than silently truncated and reviewed as if nothing was missed.
export const CONFIG_GITHUB_REVIEW_MAX_TOKENS_PER_RUN = 300_000;

// Per-batch HTTP timeout for each AI code-review call in runGithubAiReview
// (lib/ai/review-source.ts).
export const CONFIG_GITHUB_REVIEW_CALL_TIMEOUT_MS = 60_000;
// Output token budget for each individual GitHub-review AI call, distinct
// from CONFIG_GITHUB_REVIEW_MAX_TOKENS_PER_RUN above, which only bounds
// total estimated input tokens for the whole run.
export const CONFIG_GITHUB_REVIEW_MAX_TOKENS_PER_CALL = 4000;
// Rough char budget per AI call: how many source-file characters get
// grouped into one review call before starting a new batch.
export const CONFIG_GITHUB_REVIEW_PER_CALL_CHAR_BUDGET = 40_000;

// GITHUB REPO SCAN CAPS (lib/scanner/github-repo-scan.ts,
// lib/github/repo-filter.ts). Bounds cost/abuse on the file tree fetched
// from GitHub for both the pattern-based secrets scan and the AI review
// pass -- independent of the token ceiling above, which only bounds the AI
// call itself.
export const CONFIG_GITHUB_REVIEW_MAX_FILES = 300;
export const CONFIG_GITHUB_REVIEW_MAX_TOTAL_BYTES = 5_000_000;
export const CONFIG_GITHUB_REVIEW_MAX_FILE_BYTES = 300_000;

// BROWSERBASE CONFIGURATION (live browser session viewer)
//
// To enable BrowserBase:
//   1. Create a project at https://www.browserbase.com
//   2. Set BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID in .env
//   3. Restart the server. If unset, the View Page button hides.
//
// Tunables:
//   CONFIG_BROWSERBASE_MAX_TTL_SECONDS = 300 (5 min hard cap -- matches the
//     product promise and prevents runaway sessions).

// 360s (6 min) gives a 60-second buffer over the 5-minute user budget to
// account for session boot and viewer page load time.
export const CONFIG_BROWSERBASE_MAX_TTL_SECONDS = 360;
export const CONFIG_BROWSERBASE_DEFAULT_TTL_SECONDS = 360;

// How often the browser session viewer page (app/browser/[id]/page.tsx)
// polls GET /api/v3/browser/sessions/logs for new network/console log lines.
export const CONFIG_BROWSERBASE_LOGS_POLL_INTERVAL_MS = 10_000;

// AUTHENTICATED SCANNING CONFIGURATION - UPDATE IF NEEDED
//
// Authenticated scanning is fully ephemeral: a caller supplies login material
// directly in a single scan request (POST /api/v3/scan/authenticated), it is
// used once, in memory, for that one request, and it is never written to a
// table, a log line, or an audit record, not even transiently. There is no
// credential vault. Set CONFIG_SCAN_AUTH_ENABLED to false to remove the
// feature from a deployment entirely.

export const CONFIG_SCAN_AUTH_ENABLED = true;

// Input caps. MAX_SECRET_LENGTH applies to each individual secret value
// (password, header value, cookie value) in the request body.
export const CONFIG_SCAN_AUTH_MAX_SECRET_LENGTH = 4096;
export const CONFIG_SCAN_AUTH_MAX_COOKIES = 20;

// Timeout for the verification fetch that proves a login worked.
export const CONFIG_SCAN_AUTH_VERIFY_TIMEOUT_MS = 10_000;

// Maximum bytes read from a verification page fetched over plain HTTP
// (header/cookie auth, and the post-login verify step for every auth type).
export const CONFIG_SCAN_AUTH_MAX_LOGIN_BODY_BYTES = 512 * 1024;

// Cookies whose lifetime the jar will honour at most, in seconds. A target that
// hands out a one-year cookie, or a browser session that picked one up, still
// only gets held for the length of a scan.
export const CONFIG_SCAN_AUTH_MAX_COOKIE_AGE_SECONDS = 3600;

// Minimum byte difference between the anonymous and authenticated fetch of the
// verification page before the difference counts as evidence the login worked.
export const CONFIG_SCAN_AUTH_BASELINE_DIFF_BYTES = 256;

// BROWSER-DRIVEN LOGIN (form auth only) - form-based authenticated scanning
// opens a real BrowserBase session so a JS-rendered login form gets a chance
// to render before the scanner looks for it. See lib/scanner/auth/browser-login.ts.

// How long to wait for the login page's `load` event before giving up.
export const CONFIG_SCAN_AUTH_BROWSER_NAV_TIMEOUT_MS = 20_000;

// After `load` fires, how long the page must go without a new network
// request before it counts as "fully settled" (catches a client-rendered
// form that appears after an XHR call following the initial load).
export const CONFIG_SCAN_AUTH_BROWSER_SETTLE_MS = 1_500;

// Hard ceiling on the whole "wait for the page to load" step, load event
// plus settle window included.
export const CONFIG_SCAN_AUTH_BROWSER_MAX_WAIT_MS = 25_000;

// BrowserBase session TTL for the login handshake. Short: the browser is
// only open long enough to render the login page and read its cookies.
export const CONFIG_SCAN_AUTH_BROWSER_SESSION_TIMEOUT_SECONDS = 90;

// Characters of rendered HTML captured from the browser for form detection
// and post-submit verification. Mirrors MAX_LOGIN_BODY_BYTES's purpose for
// the plain-HTTP path.
export const CONFIG_SCAN_AUTH_BROWSER_MAX_HTML_CHARS = 500_000;

// DEMO MODE CONFIGURATION - UPDATE IF NEEDED

export const CONFIG_DEMO_SCAN_LIMIT = 5;
export const CONFIG_DEMO_WINDOW_HOURS = 12;

// DATABASE CONSTRAINTS - UPDATE IF NEEDED

export const CONFIG_MAX_EMAIL_LENGTH = 255;
export const CONFIG_MAX_NAME_LENGTH = 255;
export const CONFIG_MAX_DESCRIPTION_LENGTH = 1000;
export const CONFIG_MAX_TEAM_NAME_LENGTH = 255;
export const CONFIG_MAX_TAGS_PER_SCAN = 10;
export const CONFIG_MAX_TAG_LENGTH = 30;

// How long a team invite link stays usable before it must be resent.
export const CONFIG_TEAM_INVITE_EXPIRY_DAYS = 7;

// ENGINE FEEDBACK CONFIGURATION - noise thresholds for the admin "Engine
// Feedback" panel (Admin > System > Engine Feedback), which aggregates
// scan_finding_feedback (per-check false-positive rate) and
// auto_tag_dismissals (per-auto-tag-rule dismissal rate). Both signals
// share the same two knobs: a rate a check/rule must clear, and a minimum
// sample size so one grumpy user on one scan can't flag a check. This is
// reporting only -- nothing reads these values to change detection logic
// automatically; a human decides what to do with a flagged check.
export const CONFIG_ENGINE_FEEDBACK_NOISE_THRESHOLD_PERCENT = 20;
export const CONFIG_ENGINE_FEEDBACK_MIN_SAMPLE_SIZE = 5;

// PAGINATION DEFAULTS

export const CONFIG_PAGINATION_DEFAULT_PAGE_SIZE = 20;
export const CONFIG_PAGINATION_MAX_PAGE_SIZE = 100;
export const CONFIG_PAGINATION_DEFAULT_PAGE = 1;

// MISC LIMITS - UPDATE IF NEEDED

// How long a CDN or browser caches the embeddable SVG scan-status badge and
// its JSON stats before re-fetching (app/api/v3/badge/[token]/route.ts and
// .../stats/route.ts).
export const CONFIG_BADGE_CACHE_MAX_AGE_SECONDS = 3600;

// Hard cap on contact-form and landing-page-contact message length.
export const CONFIG_CONTACT_MESSAGE_MAX_LENGTH = 5000;

// Row cap for both the "Recent Scans" and "Top Vulnerabilities" dashboard
// widgets (GET /api/v3/dashboard).
export const CONFIG_DASHBOARD_WIDGET_LIMIT = 6;

// Server-enforced avatar upload size cap, after base64 decode
// (lib/uploads/avatar.ts). The profile page's client-side pre-check
// (components/profile/tabs/profile-general-tab.tsx) uses this exact value
// too, so the two can never drift out of sync again.
export const CONFIG_MAX_AVATAR_UPLOAD_BYTES = 5 * 1024 * 1024;

// NOTIFICATION BELL CONFIGURATION - UPDATE IF NEEDED
//
// How often the header bell polls for new notifications (both site-wide
// admin_notifications and the per-user inbox in user_notifications, e.g.
// team invites). This is the value the bell has always polled at; it's
// centralized here so it isn't a bare literal inside the component.
export const CONFIG_NOTIFICATION_POLL_INTERVAL_MS = 5 * 60 * 1000;

// How long a dismissed admin_notifications broadcast stays dismissed when
// the notification itself does not set its own dismiss_duration_hours.
// Only the fallback: a notification with an explicit duration always uses
// that instead. Used by the "bell" type in components/shared/notification-
// center.tsx; the "banner"/"modal"/"toast" types in components/shared/
// site-notifications.tsx have their own, shorter fallback below.
export const CONFIG_NOTIFICATION_DEFAULT_DISMISS_DAYS = 365;

// Same fallback concept as above, for the banner/modal/toast notification
// types rendered by components/shared/site-notifications.tsx. Kept as its
// own setting rather than reusing CONFIG_NOTIFICATION_DEFAULT_DISMISS_DAYS:
// the two components have always shipped different defaults (this one 30
// days, the bell 365) and unifying them would be a behavior change, not a
// refactor.
export const CONFIG_SITE_NOTIFICATION_DEFAULT_DISMISS_DAYS = 30;

// BETA MODE CONFIGURATION - UPDATE IF NEEDED

export const CONFIG_BETA_ENABLED = false;
export const CONFIG_BETA_BANNER_MESSAGE = `You are using ${CONFIG_APP_NAME} v2.0 BETA - Some features may be unstable. Please report issues.`;

// FEATURE FLAGS - UPDATE IF NEEDED FOR YOUR DEPLOYMENT

export const CONFIG_FEATURE_DEMO_MODE = true;
export const CONFIG_FEATURE_TEAMS = true;
export const CONFIG_FEATURE_API_KEYS = true;
export const CONFIG_FEATURE_WEBHOOKS = true;
export const CONFIG_FEATURE_SCHEDULED_SCANS = true;
export const CONFIG_FEATURE_BULK_SCANS = true;
export const CONFIG_FEATURE_PDF_REPORTS = true;
export const CONFIG_FEATURE_EMAIL_NOTIFICATIONS = true;
// Domain ownership verification (lib/domains/) and, downstream of it,
// intrusive active-probing scans against a verified domain. Kill switch
// only -- unlike the flags above, turning this off does not remove the
// underlying safety requirement, it removes the ability to satisfy it, so
// disabling it should also be treated as disabling active-probes entirely
// (see app/api/v3/scan/route.ts's enforcement).
export const CONFIG_FEATURE_DOMAIN_VERIFICATION = true;

// POSTURE DIGEST - opt-in weekly/monthly cross-site summary email (see
// lib/notifications/posture-digest.ts). Separate deployment-wide switch
// from FEATURE_EMAIL_NOTIFICATIONS above so an admin can pause just this
// feature without disabling every other transactional email; the per-user
// opt-in (users.digest_email_enabled, default false) is the other half of
// the gate -- this only controls whether the worker runs at all.
export const CONFIG_POSTURE_DIGEST_ENABLED = true;
// How often the in-process worker checks for users whose digest is due.
// Independent of CONFIG_POSTURE_DIGEST_WINDOW_DAYS (the digest's own
// per-user cadence) -- same "poll on a short fixed cadence, not per-row
// timers" approach as the scheduled-scans worker and the cleanup job. NOT
// admin-configurable (see NEVER_CONFIGURABLE in registry.ts): read once
// when the timer is registered, so a runtime change would not take effect.
export const CONFIG_POSTURE_DIGEST_POLL_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
// Days of "since your last digest" coverage. A user becomes due once this
// many days have passed since users.last_digest_sent_at (or, for a user
// who has never received one, since they opted in).
export const CONFIG_POSTURE_DIGEST_WINDOW_DAYS = 7;
// Hard cap on individual findings itemized in one digest email -- the
// summary counts (siteCount, newFindingsTotal, etc.) are never truncated,
// only the itemized list.
export const CONFIG_POSTURE_DIGEST_MAX_FINDINGS_LISTED = 15;

// SCHEDULED BACKUPS - periodic pg_dump via scripts/backup-db.mjs (see
// lib/backup/scheduled-backup-worker.ts). Distinct from the migration-time
// backup (scripts/migrate/migrate.mjs) and the admin-triggered manual run
// (POST /api/v3/admin/backup): those only happen when a migration runs or a
// staff member clicks the button, so a self-hosted instance that never
// migrates and never has an admin remember to click backup had no backup at
// all between deploys (AUDIT-010, prodready-05). Deployment-wide switch, off
// by default -- unlike posture digests, a periodic pg_dump has real disk-
// space and pg_dump-availability preconditions an operator should opt into
// deliberately, not discover after the fact.
export const CONFIG_SCHEDULED_BACKUP_ENABLED = false;
// How often the in-process worker takes a backup. NOT admin-configurable
// (see NEVER_CONFIGURABLE in registry.ts): read once when the timer is
// registered, so a runtime change would not take effect.
export const CONFIG_SCHEDULED_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

// BILLING / PREMIUM CONFIGURATION - UPDATE IF NEEDED

// Set BILLING_ENABLED to false to disable all billing features and give
// all users unlimited access (or the unlimited_mode_limit if set)
export const CONFIG_BILLING_ENABLED = true;

export const CONFIG_BILLING_FREE_LIMIT = 25;
export const CONFIG_BILLING_CORE_SUPPORTER_LIMIT = 100;
export const CONFIG_BILLING_PRO_SUPPORTER_LIMIT = 150;
export const CONFIG_BILLING_ELITE_SUPPORTER_LIMIT = 500;

// -1 means keep forever on every plan: a scan result's JSON payload is small
// enough that automatic age-based deletion isn't worth the data loss. Still
// admin-configurable per plan (lib/config/registry.ts) if a self-hoster
// wants to reintroduce a retention window.
export const CONFIG_BILLING_FREE_RETENTION = -1;
export const CONFIG_BILLING_CORE_SUPPORTER_RETENTION = -1;
export const CONFIG_BILLING_PRO_SUPPORTER_RETENTION = -1;
export const CONFIG_BILLING_ELITE_SUPPORTER_RETENTION = -1;

export const CONFIG_BILLING_UNLIMITED_MODE_LIMIT = -1;

// How long the 6-digit billing verification code (POST
// /api/v3/billing/verify/send) stays valid before it must be re-sent. Keep
// at or below RATE_LIMIT_BILLING_VERIFY_WINDOW_MINUTES, the window the
// verification attempts themselves are rate-limited over.
export const CONFIG_BILLING_VERIFY_CODE_EXPIRY_MINUTES = 5;

// Invoice/payment rows returned by getBillingHistory to the Billing tab.
export const CONFIG_BILLING_HISTORY_PAGE_SIZE = 50;

// How often the hidden free-plan GitHub AI code review trial renews (see
// lib/billing/github-review-usage.ts). Only ever consulted for a plan whose
// githubReviewTokensPerWindow is 0.
export const CONFIG_GITHUB_REVIEW_FREE_TRIAL_WINDOW_HOURS = 24;

// How many existing Stripe webhook endpoints ensureStripeWebhook scans when
// checking whether this deployment's webhook already exists
// (lib/billing/stripe-webhook-setup.ts).
export const CONFIG_BILLING_STRIPE_WEBHOOK_LOOKUP_LIMIT = 100;

// Per-resource plan limits. -1 means unlimited, 0 means the plan does not
// include the resource at all. Mirrors lib/billing/catalog.ts's PLANS at
// the moment these were split out into the registry; catalog.ts keeps its
// own copy for Stripe product descriptions and marketing copy, this copy
// is what lib/billing/plan-limits.ts actually enforces against.

export const CONFIG_BILLING_FREE_API_KEYS = 1;
export const CONFIG_BILLING_CORE_SUPPORTER_API_KEYS = 3;
export const CONFIG_BILLING_PRO_SUPPORTER_API_KEYS = 10;
export const CONFIG_BILLING_ELITE_SUPPORTER_API_KEYS = -1;

export const CONFIG_BILLING_FREE_API_REQUESTS_PER_DAY = 25;
export const CONFIG_BILLING_CORE_SUPPORTER_API_REQUESTS_PER_DAY = 100;
export const CONFIG_BILLING_PRO_SUPPORTER_API_REQUESTS_PER_DAY = 5000;
export const CONFIG_BILLING_ELITE_SUPPORTER_API_REQUESTS_PER_DAY = -1;

export const CONFIG_BILLING_FREE_TEAMS = 0;
export const CONFIG_BILLING_CORE_SUPPORTER_TEAMS = 0;
export const CONFIG_BILLING_PRO_SUPPORTER_TEAMS = 1;
export const CONFIG_BILLING_ELITE_SUPPORTER_TEAMS = 3;

export const CONFIG_BILLING_FREE_TEAM_MEMBERS = 0;
export const CONFIG_BILLING_CORE_SUPPORTER_TEAM_MEMBERS = 0;
export const CONFIG_BILLING_PRO_SUPPORTER_TEAM_MEMBERS = 3;
export const CONFIG_BILLING_ELITE_SUPPORTER_TEAM_MEMBERS = 10;

export const CONFIG_BILLING_FREE_WEBHOOKS = 1;
export const CONFIG_BILLING_CORE_SUPPORTER_WEBHOOKS = 1;
export const CONFIG_BILLING_PRO_SUPPORTER_WEBHOOKS = 5;
export const CONFIG_BILLING_ELITE_SUPPORTER_WEBHOOKS = -1;

// 3 / 5 / 10 / unlimited -- free gets a real, if modest, allowance instead
// of the feature being paid-only.
export const CONFIG_BILLING_FREE_SCHEDULED_SCANS = 3;
export const CONFIG_BILLING_CORE_SUPPORTER_SCHEDULED_SCANS = 5;
export const CONFIG_BILLING_PRO_SUPPORTER_SCHEDULED_SCANS = 10;
export const CONFIG_BILLING_ELITE_SUPPORTER_SCHEDULED_SCANS = -1;

export const CONFIG_BILLING_FREE_BULK_SCAN_URLS = 5;
export const CONFIG_BILLING_CORE_SUPPORTER_BULK_SCAN_URLS = 10;
export const CONFIG_BILLING_PRO_SUPPORTER_BULK_SCAN_URLS = 25;
export const CONFIG_BILLING_ELITE_SUPPORTER_BULK_SCAN_URLS = 100;

// GitHub repo review: AI TOKENS allowed per fixed AI_USAGE_WINDOW_HOURS
// window (the same window CONFIG_BILLING_*_AI_TOKENS_PER_WINDOW below
// resets on -- see lib/billing/github-review-usage.ts, which reuses
// lib/billing/ai-usage.ts's window resolution directly instead of keeping
// an independent window-length setting), not a run count. Repos vary
// enormously in size -- one large repo can burn as many tokens as hundreds
// of small ones -- so a flat "N runs" cap doesn't bound cost the way a
// token cap does. VulnRadar's own AI usage runs through a subsidized/
// free-tier provider capacity, not an unlimited budget, so unlike
// dailyScans or apiRequestsPerDay this field is NEVER -1 (unlimited) at
// any tier, even elite: every plan gets a real finite number. Bringing
// your own AI provider key bypasses this cap entirely (see
// lib/billing/github-review-usage.ts) since those calls cost VulnRadar
// nothing. These are starting defaults for the repo owner to tune via the
// admin Settings UI, not a final product decision. Used to reset on its
// own separate calendar-month cadence instead of this window -- token
// AMOUNTS are unchanged from that era, only the reset cadence and these
// constant/setting names changed.
export const CONFIG_BILLING_FREE_GITHUB_REVIEW_TOKENS_PER_WINDOW = 0;
export const CONFIG_BILLING_CORE_SUPPORTER_GITHUB_REVIEW_TOKENS_PER_WINDOW = 200_000;
export const CONFIG_BILLING_PRO_SUPPORTER_GITHUB_REVIEW_TOKENS_PER_WINDOW = 1_000_000;
export const CONFIG_BILLING_ELITE_SUPPORTER_GITHUB_REVIEW_TOKENS_PER_WINDOW = 5_000_000;

// Browserbase live-browser session minutes allowed per calendar month (see
// lib/billing/browserbase-usage.ts). Browserbase is a real paid third-party
// API, not subsidized capacity like the AI fields above, but the same "never
// unbounded, even at the top tier" reasoning applies: a compromised session
// cookie or a runaway client shouldn't be able to run up real infra cost
// against this account without limit. A single session is separately capped
// at BROWSERBASE_MAX_TTL_SECONDS (6 minutes by default) regardless of how
// much of this monthly allowance remains. These are starting defaults for
// the repo owner to tune via the admin Settings UI (and against actual
// Browserbase wholesale cost per minute) before relying on them, not a
// final pricing decision.
export const CONFIG_BILLING_FREE_BROWSERBASE_MINUTES_PER_MONTH = 0;
export const CONFIG_BILLING_CORE_SUPPORTER_BROWSERBASE_MINUTES_PER_MONTH = 30;
export const CONFIG_BILLING_PRO_SUPPORTER_BROWSERBASE_MINUTES_PER_MONTH = 90;
export const CONFIG_BILLING_ELITE_SUPPORTER_BROWSERBASE_MINUTES_PER_MONTH = 300;

// Max scans a user may have in status 'pending'/'running' at once (see
// lib/rate-limiting/concurrent-scans.ts). VulnRadar runs as one persistent
// Node process with no job queue, so this is a real shared-capacity limit,
// not just a monetization tier -- keep these modest even at the top plan.
export const CONFIG_BILLING_FREE_CONCURRENT_SCANS = 1;
export const CONFIG_BILLING_CORE_SUPPORTER_CONCURRENT_SCANS = 2;
export const CONFIG_BILLING_PRO_SUPPORTER_CONCURRENT_SCANS = 3;
export const CONFIG_BILLING_ELITE_SUPPORTER_CONCURRENT_SCANS = 5;

// DATABASE CLEANUP RETENTION - UPDATE IF NEEDED
//
// How long each table's rows are kept before lib/database/cleanup.ts's
// periodic pass deletes them. Separate from the BILLING_*_RETENTION scan
// history windows above, which have their own per-plan settings.

export const CONFIG_CLEANUP_API_USAGE_RETENTION_DAYS = 90;
export const CONFIG_CLEANUP_REVOKED_API_KEYS_RETENTION_DAYS = 30;
export const CONFIG_CLEANUP_DATA_REQUESTS_RETENTION_DAYS = 60;
export const CONFIG_CLEANUP_ADMIN_AUDIT_LOG_RETENTION_DAYS = 365;
export const CONFIG_CLEANUP_ADMIN_USER_NOTES_RETENTION_DAYS = 365;
export const CONFIG_CLEANUP_SECURITY_ALERTS_RETENTION_DAYS = 180;
export const CONFIG_CLEANUP_SYSTEM_ERROR_LOGS_RETENTION_DAYS = 30;
export const CONFIG_CLEANUP_EMAIL_LOG_RETENTION_DAYS = 30;
export const CONFIG_CLEANUP_SCAN_FINDING_FEEDBACK_RETENTION_DAYS = 90;
export const CONFIG_CLEANUP_USER_NOTIFICATIONS_RETENTION_DAYS = 90;
export const CONFIG_CLEANUP_GITHUB_REVIEW_USAGE_RETENTION_DAYS = 180;
// Pure performance cache for the CISA KEV feed (see CONFIG_CVE_KEV_CACHE_TTL_HOURS
// above, which governs freshness -- this governs how long dead rows accumulate
// before this housekeeping delete runs).
export const CONFIG_CLEANUP_KEV_CACHE_RETENTION_DAYS = 7;

// SELF-UPDATER CONFIGURATION - UPDATE IF NEEDED
//
// Subprocess timeouts for the admin self-updater (lib/updater/apply.ts,
// lib/updater/github-release.ts). Sized for a low-CPU/shared-core
// self-hosted box (a Pterodactyl-style panel, this feature's primary
// target); a self-hoster on even more constrained hardware may need these
// raised further.

export const CONFIG_UPDATER_NPM_CI_TIMEOUT_MS = 10 * 60 * 1000;
// How long to wait when downloading the release tarball/checksums/cosign
// bundle from GitHub before aborting with AssetDownloadError.
export const CONFIG_UPDATER_ASSET_DOWNLOAD_TIMEOUT_MS = 120_000;
