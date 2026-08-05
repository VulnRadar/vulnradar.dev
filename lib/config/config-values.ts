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
export const CONFIG_SEO_OG_IMAGE = "/og-image-310.png";
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

// SCANNING CONFIGURATION - UPDATE IF NEEDED

export const CONFIG_MAX_URL_LENGTH = 2048;
export const CONFIG_MAX_URLS_BULK = 100;
export const CONFIG_SCAN_TIMEOUT_SECONDS = 300;
export const CONFIG_BULK_SCAN_TIMEOUT_SECONDS = 1800;
export const CONFIG_DEFAULT_SEVERITY_THRESHOLD = "low";

// API CONFIGURATION

export const CONFIG_API_KEY_PREFIX = "vr_live_";
export const CONFIG_DEFAULT_API_KEY_DAILY_LIMIT = 50;
export const CONFIG_API_CURRENT_VERSION = "v3";
export const CONFIG_API_SUPPORTED_VERSIONS = ["v3"];

// AI CHAT CONFIGURATION
export const CONFIG_AI_CHAT_MAX_TOKENS = 4096;
export const CONFIG_AI_CHAT_HISTORY_DAYS = 7;
export const CONFIG_AI_CHAT_MAX_INPUT_LENGTH = 500;

// AI VERIFICATION (deep scan) CONFIGURATION
// CONFIG_AI_VERIFY_MAX_TOKENS: budget for each per-finding AI call.
//   Reasoning models (DeepSeek-R1, MiniMax-M2, QwQ, o1) consume tokens inside
//   their <think> block before writing the answer — set this high enough that
//   the model finishes thinking AND emits the JSON (typically 1000-2000).
//   Non-reasoning models only need ~100 tokens for the tiny JSON output, but
//   extra headroom is harmless.
export const CONFIG_AI_VERIFY_MAX_TOKENS = 1500;
// Per-finding HTTP timeout (ms): how long to wait for the AI API to respond.
export const CONFIG_AI_VERIFY_CALL_TIMEOUT_MS = 25_000;
// How long to wait for the initial HTTP probe of the target site (ms).
export const CONFIG_AI_VERIFY_PROBE_TIMEOUT_MS = 8_000;
// Hard ceiling for the entire deep-scan batch (ms).
// All parallel calls are raced against this; any that haven't settled are
// counted as "skipped (timed out)" in the summary modal.
export const CONFIG_AI_VERIFY_TOTAL_TIMEOUT_MS = 60_000;

// BROWSERBASE CONFIGURATION (live browser session viewer)
//
// To enable BrowserBase:
//   1. Create a project at https://www.browserbase.com
//   2. Set BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID in .env
//   3. Restart the server. If unset, the View Page button hides.
//
// Tunables:
//   CONFIG_BROWSERBASE_MAX_TTL_SECONDS = 300 (5 min hard cap — matches the
//     product promise and prevents runaway sessions).

// 360s (6 min) gives a 60-second buffer over the 5-minute user budget to
// account for session boot and viewer page load time.
export const CONFIG_BROWSERBASE_MAX_TTL_SECONDS = 360;
export const CONFIG_BROWSERBASE_DEFAULT_TTL_SECONDS = 360;

// DEMO MODE CONFIGURATION - UPDATE IF NEEDED

export const CONFIG_DEMO_SCAN_LIMIT = 5;
export const CONFIG_DEMO_WINDOW_HOURS = 12;

// DATABASE CONSTRAINTS - UPDATE IF NEEDED

export const CONFIG_MAX_EMAIL_LENGTH = 255;
export const CONFIG_MAX_NAME_LENGTH = 255;
export const CONFIG_MAX_DESCRIPTION_LENGTH = 1000;
export const CONFIG_MAX_TEAM_NAME_LENGTH = 255;
export const CONFIG_MAX_TAGS_PER_SCAN = 10;

// PAGINATION DEFAULTS

export const CONFIG_PAGINATION_DEFAULT_PAGE_SIZE = 20;
export const CONFIG_PAGINATION_MAX_PAGE_SIZE = 100;
export const CONFIG_PAGINATION_DEFAULT_PAGE = 1;

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
