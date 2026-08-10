// CONFIG VALUES - Hardcoded Configuration Values

// These values are the source of truth for application configuration.
// Self-hosters: Modify these values to customize your deployment.

// App metadata - UPDATE THESE FOR YOUR DEPLOYMENT
export const CONFIG_APP_NAME = "VulnRadar";
export const CONFIG_APP_SLUG = "vulnradar";
export const CONFIG_APP_VERSION = "3.0.0";
// The minimum database schema version this app requires.
// App 3.0.0 requires schema v3.0.0 (ai_conversations + email unsubscribe).
// Run `npm run db:migrate` to upgrade a v2 database before starting.
export const CONFIG_MIN_SCHEMA_VERSION = "3.0.0";
export const CONFIG_ENGINE_VERSION = "3.0.0";
export const CONFIG_APP_DESCRIPTION =
  "Scan websites for security vulnerabilities. Get instant reports with severity ratings, actionable fix guidance, and team collaboration tools.";
export const CONFIG_TOTAL_CHECKS_LABEL = "650+";
export const CONFIG_APP_URL = "https://sandbox.vulnradar.dev";
export const CONFIG_APP_REPO = "VulnRadar/vulnradar.dev";
export const CONFIG_DISCORD_INVITE_URL = "https://discord.gg/Y7R6hdGbNe";

// Emails - UPDATE THESE FOR YOUR DEPLOYMENT
export const CONFIG_SUPPORT_EMAIL = "support@vulnradar.dev";
export const CONFIG_LEGAL_EMAIL = "legal@vulnradar.dev";
export const CONFIG_SECURITY_EMAIL = "security@vulnradar.dev";
export const CONFIG_ENTERPRISE_EMAIL = "enterprise@vulnradar.dev";
export const CONFIG_NOREPLY_EMAIL = "noreply@vulnradar.dev";
export const CONFIG_TERMS_UPDATED_AT = "2026-03-16";
// Short admin-editable note describing what changed, shown in the re-accept
// modal's "what changed" callout alongside CONFIG_TERMS_UPDATED_AT. Empty
// hides that callout entirely.
export const CONFIG_TERMS_CHANGE_SUMMARY =
  "Enhanced CCPA/CPRA compliance, added arbitration clauses, and improved liability limitations.";

// BRANDING - UPDATE THESE FOR YOUR DEPLOYMENT

export const CONFIG_LOGO_URL = "/favicon.svg";
// Brand cyan. Keep in sync with `--primary` in app/globals.css
// (hsl(190 90% 42%)). Used for the PWA theme colour and the browser UI tint.
export const CONFIG_PRIMARY_COLOR = "#0babcb";
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
export const CONFIG_SEO_OG_IMAGE = "/og-image-700.png";
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
export const CONFIG_AI_CHAT_MAX_INPUT_LENGTH = 500;

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
export const CONFIG_AI_VERIFY_CALL_TIMEOUT_MS = 25_000;
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
// Raised from 90_000: worst case (every call in every chunk hangs for the
// full CONFIG_AI_VERIFY_CALL_TIMEOUT_MS -- a provider outage), this is
// floor(300_000 / 25_000) = 12 full chunks attempted before the deadline
// check trips, plus the chunk already in flight when it does, so up to 13
// chunks x 10 findings = 130 findings attempted (all returning no verdict)
// over a bounded ~325s -- not unbounded, just wide enough to cover a
// realistic worst case instead of the old ~3 chunks (~15 findings). Typical
// case (a responsive provider, call latency well under the 25s ceiling):
// even a pessimistic ~15-20s per chunk clears 15-20 chunks = 150-200
// findings inside this budget, comfortably past the 100+ findings a complex
// scan can produce and past the 57 that exposed this in the first place.
// This is an on-demand, user-triggered action (the "Verify with AI" scan
// action), not part of the main scan request, so a multi-minute budget is
// acceptable UX the same way CONFIG_SCAN_TIMEOUT_SECONDS/
// CONFIG_CRAWL_SCAN_TIMEOUT_SECONDS already accept minutes for a scan the
// user explicitly asked for and is watching a progress state for.
//
// Note: the /api/v3/scan/verify and /api/v3/scan/verify-batch routes each
// also have their own `maxDuration` (currently 360s, i.e. this budget plus
// the probe timeout plus one more call-timeout's worth of overrun plus
// slack) -- this constant bounds lib/ai's own loop, not the platform, and
// the two must be kept in that order (route maxDuration > this value) or
// the platform kills the request before this deadline ever gets a chance
// to fire cleanly.
export const CONFIG_AI_VERIFY_TOTAL_TIMEOUT_MS = 300_000;

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

// PAGINATION DEFAULTS

export const CONFIG_PAGINATION_DEFAULT_PAGE_SIZE = 20;
export const CONFIG_PAGINATION_MAX_PAGE_SIZE = 100;
export const CONFIG_PAGINATION_DEFAULT_PAGE = 1;

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

// BILLING / PREMIUM CONFIGURATION - UPDATE IF NEEDED

// Set BILLING_ENABLED to false to disable all billing features and give
// all users unlimited access (or the unlimited_mode_limit if set)
export const CONFIG_BILLING_ENABLED = true;

export const CONFIG_BILLING_FREE_LIMIT = 25;
export const CONFIG_BILLING_CORE_SUPPORTER_LIMIT = 100;
export const CONFIG_BILLING_PRO_SUPPORTER_LIMIT = 150;
export const CONFIG_BILLING_ELITE_SUPPORTER_LIMIT = 500;

export const CONFIG_BILLING_FREE_RETENTION = 30;
export const CONFIG_BILLING_CORE_SUPPORTER_RETENTION = 90;
export const CONFIG_BILLING_PRO_SUPPORTER_RETENTION = -1;
export const CONFIG_BILLING_ELITE_SUPPORTER_RETENTION = -1;

export const CONFIG_BILLING_UNLIMITED_MODE_LIMIT = -1;

// How long the 6-digit billing verification code (POST
// /api/v3/billing/verify/send) stays valid before it must be re-sent. Keep
// at or below RATE_LIMIT_BILLING_VERIFY_WINDOW_MINUTES, the window the
// verification attempts themselves are rate-limited over.
export const CONFIG_BILLING_VERIFY_CODE_EXPIRY_MINUTES = 5;

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

export const CONFIG_BILLING_FREE_WEBHOOKS = 0;
export const CONFIG_BILLING_CORE_SUPPORTER_WEBHOOKS = 1;
export const CONFIG_BILLING_PRO_SUPPORTER_WEBHOOKS = 5;
export const CONFIG_BILLING_ELITE_SUPPORTER_WEBHOOKS = -1;

export const CONFIG_BILLING_FREE_SCHEDULED_SCANS = 0;
export const CONFIG_BILLING_CORE_SUPPORTER_SCHEDULED_SCANS = 0;
export const CONFIG_BILLING_PRO_SUPPORTER_SCHEDULED_SCANS = 5;
export const CONFIG_BILLING_ELITE_SUPPORTER_SCHEDULED_SCANS = -1;

export const CONFIG_BILLING_FREE_BULK_SCAN_URLS = 0;
export const CONFIG_BILLING_CORE_SUPPORTER_BULK_SCAN_URLS = 10;
export const CONFIG_BILLING_PRO_SUPPORTER_BULK_SCAN_URLS = 25;
export const CONFIG_BILLING_ELITE_SUPPORTER_BULK_SCAN_URLS = 100;

// GitHub repo review: AI TOKENS allowed per calendar month, not a run
// count. Repos vary enormously in size -- one large repo can burn as many
// tokens as hundreds of small ones -- so a flat "N runs" cap doesn't bound
// cost the way a token cap does. VulnRadar's own AI usage runs through a
// subsidized/free-tier provider capacity, not an unlimited budget, so
// unlike dailyScans or apiRequestsPerDay this field is NEVER -1 (unlimited)
// at any tier, even elite: every plan gets a real finite number. Bringing
// your own AI provider key bypasses this cap entirely (see
// lib/billing/github-review-usage.ts) since those calls cost VulnRadar
// nothing. These are starting defaults for the repo owner to tune via the
// admin Settings UI, not a final product decision.
export const CONFIG_BILLING_FREE_GITHUB_REVIEW_TOKENS_PER_MONTH = 0;
export const CONFIG_BILLING_CORE_SUPPORTER_GITHUB_REVIEW_TOKENS_PER_MONTH = 200_000;
export const CONFIG_BILLING_PRO_SUPPORTER_GITHUB_REVIEW_TOKENS_PER_MONTH = 1_000_000;
export const CONFIG_BILLING_ELITE_SUPPORTER_GITHUB_REVIEW_TOKENS_PER_MONTH = 5_000_000;
