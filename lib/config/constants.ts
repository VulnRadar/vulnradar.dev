// APP CONSTANTS - Centralized configuration for the entire application

// This file imports from config-values.ts which contains hardcoded defaults.
// Self-hosters: Modify lib/config/config-values.ts to customize your deployment.

import {
  CONFIG_APP_NAME,
  CONFIG_APP_SLUG,
  CONFIG_APP_VERSION,
  CONFIG_MIN_SCHEMA_VERSION,
  CONFIG_ENGINE_VERSION,
  CONFIG_APP_DESCRIPTION,
  CONFIG_TOTAL_CHECKS_LABEL,
  CONFIG_APP_URL,
  CONFIG_APP_REPO,
  CONFIG_SUPPORT_EMAIL,
  CONFIG_LEGAL_EMAIL,
  CONFIG_SECURITY_EMAIL,
  CONFIG_ENTERPRISE_EMAIL,
  CONFIG_NOREPLY_EMAIL,
  CONFIG_TERMS_UPDATED_AT,
  CONFIG_LOGO_URL,
  CONFIG_PRIMARY_COLOR,
  CONFIG_BACKGROUND_COLOR_DARK,
  CONFIG_BACKGROUND_COLOR_LIGHT,
  CONFIG_FOOTER_TEXT,
  CONFIG_SEO_TAGLINE,
  CONFIG_SEO_KEYWORDS,
  CONFIG_SEO_OG_IMAGE,
  CONFIG_SEO_OG_IMAGE_WIDTH,
  CONFIG_SEO_OG_IMAGE_HEIGHT,
  CONFIG_SEO_TWITTER_HANDLE,
  CONFIG_SEO_GITHUB_URL,
  CONFIG_SEO_GOOGLE_VERIFICATION,
  CONFIG_SEO_BING_VERIFICATION,
  CONFIG_SEO_LOCALE,
  CONFIG_SEO_LANGUAGE,
  CONFIG_SEO_ORG_FOUNDING_YEAR,
  CONFIG_SEO_LICENSE,
  CONFIG_DISCORD_INVITE_URL,
  CONFIG_SESSION_COOKIE_NAME,
  CONFIG_SESSION_MAX_AGE_DAYS,
  CONFIG_VERSION_COOKIE_NAME,
  CONFIG_VERSION_COOKIE_MAX_AGE_DAYS,
  CONFIG_DEVICE_TRUST_COOKIE_NAME,
  CONFIG_DEVICE_TRUST_MAX_AGE_DAYS,
  CONFIG_2FA_PENDING_COOKIE_NAME,
  CONFIG_2FA_PENDING_MAX_AGE_SECONDS,
  CONFIG_SESSION_TIMEOUT_DAYS,
  CONFIG_PASSWORD_RESET_HOURS,
  CONFIG_EMAIL_VERIFICATION_HOURS,
  CONFIG_DEVICE_TRUST_DAYS,
  CONFIG_TOTP_VALIDITY_SECONDS,
  CONFIG_CLEANUP_INTERVAL_MS,
  CONFIG_DB_CLEANUP_INTERVAL_MS,
  CONFIG_PASSWORD_MIN_LENGTH,
  CONFIG_RATE_LIMIT_LOGIN_ATTEMPTS,
  CONFIG_RATE_LIMIT_LOGIN_WINDOW_MINUTES,
  CONFIG_RATE_LIMIT_SIGNUP_ATTEMPTS,
  CONFIG_RATE_LIMIT_SIGNUP_WINDOW_MINUTES,
  CONFIG_RATE_LIMIT_FORGOT_PASSWORD_ATTEMPTS,
  CONFIG_RATE_LIMIT_FORGOT_PASSWORD_WINDOW_MINUTES,
  CONFIG_RATE_LIMIT_API_REQUESTS,
  CONFIG_RATE_LIMIT_API_WINDOW_MINUTES,
  CONFIG_RATE_LIMIT_SCAN_REQUESTS,
  CONFIG_RATE_LIMIT_SCAN_WINDOW_MINUTES,
  CONFIG_RATE_LIMIT_BULK_SCAN_REQUESTS,
  CONFIG_RATE_LIMIT_BULK_SCAN_WINDOW_MINUTES,
  CONFIG_RATE_LIMIT_BROWSER_SESSION_ATTEMPTS,
  CONFIG_RATE_LIMIT_BROWSER_SESSION_WINDOW_MINUTES,
  CONFIG_RATE_LIMIT_AI_CHAT_ATTEMPTS,
  CONFIG_RATE_LIMIT_AI_CHAT_WINDOW_MINUTES,
  CONFIG_RATE_LIMIT_ADMIN_REAUTH_ATTEMPTS,
  CONFIG_RATE_LIMIT_ADMIN_REAUTH_WINDOW_MINUTES,
  CONFIG_RATE_LIMIT_BILLING_VERIFY_ATTEMPTS,
  CONFIG_RATE_LIMIT_BILLING_VERIFY_WINDOW_MINUTES,
  CONFIG_RATE_LIMIT_TEAM_INVITE_ATTEMPTS,
  CONFIG_RATE_LIMIT_TEAM_INVITE_WINDOW_MINUTES,
  CONFIG_RATE_LIMIT_AI_VERIFY_ATTEMPTS,
  CONFIG_RATE_LIMIT_AI_VERIFY_WINDOW_MINUTES,
  CONFIG_RATE_LIMIT_AI_SUMMARY_ATTEMPTS,
  CONFIG_RATE_LIMIT_AI_SUMMARY_WINDOW_MINUTES,
  CONFIG_RATE_LIMIT_SCAN_TAGS_ATTEMPTS,
  CONFIG_RATE_LIMIT_SCAN_TAGS_WINDOW_MINUTES,
  CONFIG_RATE_LIMIT_PUBLIC_SCANS_ATTEMPTS,
  CONFIG_RATE_LIMIT_PUBLIC_SCANS_WINDOW_MINUTES,
  CONFIG_MAX_URL_LENGTH,
  CONFIG_MAX_URLS_BULK,
  CONFIG_SCAN_TIMEOUT_SECONDS,
  CONFIG_BULK_SCAN_TIMEOUT_SECONDS,
  CONFIG_CRAWL_SCAN_TIMEOUT_SECONDS,
  CONFIG_SCAN_STATUS_POLL_INTERVAL_MS,
  CONFIG_DEFAULT_SEVERITY_THRESHOLD,
  CONFIG_API_KEY_PREFIX,
  CONFIG_DEFAULT_API_KEY_DAILY_LIMIT,
  CONFIG_API_CURRENT_VERSION,
  CONFIG_BROWSERBASE_MAX_TTL_SECONDS,
  CONFIG_BROWSERBASE_DEFAULT_TTL_SECONDS,
  CONFIG_BROWSERBASE_LOGS_POLL_INTERVAL_MS,
  CONFIG_DEMO_SCAN_LIMIT,
  CONFIG_DEMO_WINDOW_HOURS,
  CONFIG_MAX_EMAIL_LENGTH,
  CONFIG_MAX_NAME_LENGTH,
  CONFIG_MAX_DESCRIPTION_LENGTH,
  CONFIG_MAX_TEAM_NAME_LENGTH,
  CONFIG_MAX_TAGS_PER_SCAN,
  CONFIG_PAGINATION_DEFAULT_PAGE_SIZE,
  CONFIG_PAGINATION_MAX_PAGE_SIZE,
  CONFIG_PAGINATION_DEFAULT_PAGE,
  CONFIG_NOTIFICATION_POLL_INTERVAL_MS,
  CONFIG_NOTIFICATION_DEFAULT_DISMISS_DAYS,
  CONFIG_SITE_NOTIFICATION_DEFAULT_DISMISS_DAYS,
  CONFIG_FEATURE_DEMO_MODE,
  CONFIG_FEATURE_TEAMS,
  CONFIG_FEATURE_API_KEYS,
  CONFIG_FEATURE_WEBHOOKS,
  CONFIG_FEATURE_SCHEDULED_SCANS,
  CONFIG_FEATURE_BULK_SCANS,
  CONFIG_FEATURE_PDF_REPORTS,
  CONFIG_FEATURE_EMAIL_NOTIFICATIONS,
  CONFIG_BILLING_ENABLED,
  CONFIG_BILLING_FREE_LIMIT,
  CONFIG_BILLING_CORE_SUPPORTER_LIMIT,
  CONFIG_BILLING_PRO_SUPPORTER_LIMIT,
  CONFIG_BILLING_ELITE_SUPPORTER_LIMIT,
  CONFIG_BILLING_FREE_RETENTION,
  CONFIG_BILLING_CORE_SUPPORTER_RETENTION,
  CONFIG_BILLING_PRO_SUPPORTER_RETENTION,
  CONFIG_BILLING_ELITE_SUPPORTER_RETENTION,
  CONFIG_BILLING_UNLIMITED_MODE_LIMIT,
  CONFIG_AI_CHAT_MAX_TOKENS,
  CONFIG_AI_CHAT_HISTORY_DAYS,
  CONFIG_AI_CHAT_MAX_INPUT_LENGTH,
  CONFIG_AI_VERIFY_MAX_TOKENS,
  CONFIG_AI_VERIFY_CALL_TIMEOUT_MS,
  CONFIG_AI_VERIFY_PROBE_TIMEOUT_MS,
  CONFIG_AI_VERIFY_TOTAL_TIMEOUT_MS,
  CONFIG_AI_SUMMARY_MAX_TOKENS,
  CONFIG_AI_USAGE_WINDOW_HOURS,
  CONFIG_SCAN_AUTH_ENABLED,
  CONFIG_SCAN_AUTH_MAX_SECRET_LENGTH,
  CONFIG_SCAN_AUTH_MAX_COOKIES,
  CONFIG_SCAN_AUTH_VERIFY_TIMEOUT_MS,
  CONFIG_SCAN_AUTH_MAX_LOGIN_BODY_BYTES,
  CONFIG_SCAN_AUTH_MAX_COOKIE_AGE_SECONDS,
  CONFIG_SCAN_AUTH_BASELINE_DIFF_BYTES,
  CONFIG_SCAN_AUTH_BROWSER_NAV_TIMEOUT_MS,
  CONFIG_SCAN_AUTH_BROWSER_SETTLE_MS,
  CONFIG_SCAN_AUTH_BROWSER_MAX_WAIT_MS,
  CONFIG_SCAN_AUTH_BROWSER_SESSION_TIMEOUT_SECONDS,
  CONFIG_SCAN_AUTH_BROWSER_MAX_HTML_CHARS,
  CONFIG_DATA_EXPORT_COOLDOWN_DAYS,
} from "./config-values";

export const DATA_EXPORT_COOLDOWN_DAYS = CONFIG_DATA_EXPORT_COOLDOWN_DAYS;
export const AI_MAX_TOKENS = CONFIG_AI_CHAT_MAX_TOKENS;
export const AI_CHAT_MAX_TOKENS = CONFIG_AI_CHAT_MAX_TOKENS;
export const AI_CHAT_HISTORY_DAYS = CONFIG_AI_CHAT_HISTORY_DAYS;
export const AI_CHAT_MAX_INPUT_LENGTH = CONFIG_AI_CHAT_MAX_INPUT_LENGTH;
export const AI_VERIFY_MAX_TOKENS = CONFIG_AI_VERIFY_MAX_TOKENS;
export const AI_VERIFY_CALL_TIMEOUT_MS = CONFIG_AI_VERIFY_CALL_TIMEOUT_MS;
export const AI_VERIFY_PROBE_TIMEOUT_MS = CONFIG_AI_VERIFY_PROBE_TIMEOUT_MS;
export const AI_VERIFY_TOTAL_TIMEOUT_MS = CONFIG_AI_VERIFY_TOTAL_TIMEOUT_MS;
export const AI_SUMMARY_MAX_TOKENS = CONFIG_AI_SUMMARY_MAX_TOKENS;
export const AI_USAGE_WINDOW_HOURS = CONFIG_AI_USAGE_WINDOW_HOURS;

// APPLICATION METADATA (from config-values.ts -> config.yaml)

export const APP_NAME = CONFIG_APP_NAME;
export const APP_SLUG = CONFIG_APP_SLUG;
export const APP_VERSION = CONFIG_APP_VERSION;
export const MIN_SCHEMA_VERSION = CONFIG_MIN_SCHEMA_VERSION;
export const ENGINE_VERSION = CONFIG_ENGINE_VERSION;
export const APP_DESCRIPTION = CONFIG_APP_DESCRIPTION;
export const TOTAL_CHECKS_LABEL = CONFIG_TOTAL_CHECKS_LABEL;
// Self-hosters set NEXT_PUBLIC_APP_URL (see the Dockerfile's build ARG and
// .env.example); read it here so it actually reaches this constant instead
// of always resolving to the hardcoded CONFIG_APP_URL placeholder. Every
// consumer of APP_URL below (emails, sitemap.xml, robots.txt, canonical/OG
// tags, PDF/SARIF reports, webhook payloads, docs) picks this up too.
//
// Still fully synchronous, so it has no idea about a database admin
// override: an admin-panel APP_URL change reaches THIS export -- and
// therefore every client bundle, since Next.js inlines NEXT_PUBLIC_* at
// `next build` time -- only after a rebuild and redeploy. Server code that
// needs the live, no-rebuild-required value (currently only the
// OAuth/Discord/GitHub sign-in routes, which must get their redirect_uri
// right on every request) should call resolveAppUrl(request) from
// lib/config/runtime-config.ts instead.
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || CONFIG_APP_URL;
export const APP_REPO = CONFIG_APP_REPO;
export const TERMS_UPDATED_AT = CONFIG_TERMS_UPDATED_AT;

// Scan note with version info
export const DEFAULT_SCAN_NOTE = `${APP_NAME} v${APP_VERSION} (Detection Engine v${ENGINE_VERSION})`;

export const VERSION_CHECK_URL = `https://api.github.com/repos/${APP_REPO}/releases/latest`;
export const RELEASES_URL = `https://github.com/${APP_REPO}/releases`;

// BRANDING (from config-values.ts)

export const LOGO_URL = process.env.LOGO_URL || `${APP_URL}${CONFIG_LOGO_URL}`;
export const BRANDING_PRIMARY_COLOR = CONFIG_PRIMARY_COLOR;
export const BRANDING_BACKGROUND_DARK = CONFIG_BACKGROUND_COLOR_DARK;
export const BRANDING_BACKGROUND_LIGHT = CONFIG_BACKGROUND_COLOR_LIGHT;
export const BRANDING_FOOTER_TEXT = CONFIG_FOOTER_TEXT;

// SEO (from config-values.ts, overridable by env for self-hosted deploys)

export const SEO_TAGLINE = CONFIG_SEO_TAGLINE;
export const SEO_KEYWORDS = CONFIG_SEO_KEYWORDS;
export const SEO_OG_IMAGE = CONFIG_SEO_OG_IMAGE;
export const SEO_OG_IMAGE_WIDTH = CONFIG_SEO_OG_IMAGE_WIDTH;
export const SEO_OG_IMAGE_HEIGHT = CONFIG_SEO_OG_IMAGE_HEIGHT;
export const SEO_TWITTER_HANDLE =
  process.env.NEXT_PUBLIC_SEO_TWITTER_HANDLE || CONFIG_SEO_TWITTER_HANDLE;
export const SEO_GITHUB_URL = CONFIG_SEO_GITHUB_URL;
// Verification tokens are per-deployment, so env wins over the checked-in
// default. A self-hoster sets these without touching the source.
export const SEO_GOOGLE_VERIFICATION =
  process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION ||
  CONFIG_SEO_GOOGLE_VERIFICATION;
export const SEO_BING_VERIFICATION =
  process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION ||
  CONFIG_SEO_BING_VERIFICATION;
export const SEO_LOCALE = CONFIG_SEO_LOCALE;
export const SEO_LANGUAGE = CONFIG_SEO_LANGUAGE;
export const SEO_ORG_FOUNDING_YEAR = CONFIG_SEO_ORG_FOUNDING_YEAR;
export const SEO_LICENSE = CONFIG_SEO_LICENSE;
export const DISCORD_INVITE_URL = CONFIG_DISCORD_INVITE_URL;

// COOKIE NAMES AND SETTINGS (from config-values.ts)

// Version notification
export const VERSION_COOKIE_NAME = CONFIG_VERSION_COOKIE_NAME;
export const VERSION_COOKIE_MAX_AGE =
  60 * 60 * 24 * CONFIG_VERSION_COOKIE_MAX_AGE_DAYS;

// Authentication
export const AUTH_SESSION_COOKIE_NAME = CONFIG_SESSION_COOKIE_NAME;
export const AUTH_SESSION_MAX_AGE = 60 * 60 * 24 * CONFIG_SESSION_MAX_AGE_DAYS;
export const AUTH_CLEANUP_INTERVAL = CONFIG_CLEANUP_INTERVAL_MS;
export const DB_CLEANUP_INTERVAL = CONFIG_DB_CLEANUP_INTERVAL_MS;
export const AUTH_2FA_PENDING_COOKIE = CONFIG_2FA_PENDING_COOKIE_NAME;
export const AUTH_2FA_PENDING_MAX_AGE = CONFIG_2FA_PENDING_MAX_AGE_SECONDS;

// Device trust
export const DEVICE_TRUST_COOKIE_NAME = CONFIG_DEVICE_TRUST_COOKIE_NAME;
export const DEVICE_TRUST_MAX_AGE =
  60 * 60 * 24 * CONFIG_DEVICE_TRUST_MAX_AGE_DAYS;

// TIME INTERVALS (from config-values.ts)

// Authentication timeouts
export const TOTP_CODE_VALIDITY = CONFIG_TOTP_VALIDITY_SECONDS;
export const SESSION_TIMEOUT = 60 * 60 * 24 * CONFIG_SESSION_TIMEOUT_DAYS;
export const PASSWORD_MIN_LENGTH = CONFIG_PASSWORD_MIN_LENGTH;
export const PASSWORD_RESET_TOKEN_LIFETIME =
  60 * 60 * CONFIG_PASSWORD_RESET_HOURS;
export const EMAIL_VERIFICATION_TOKEN_LIFETIME =
  60 * 60 * CONFIG_EMAIL_VERIFICATION_HOURS;

// Device trust
export const DEVICE_TRUST_DURATION = 60 * 60 * 24 * CONFIG_DEVICE_TRUST_DAYS;

// Rate limiting
export const RATE_LIMIT_LOGIN_ATTEMPTS = CONFIG_RATE_LIMIT_LOGIN_ATTEMPTS;
export const RATE_LIMIT_LOGIN_WINDOW =
  60 * CONFIG_RATE_LIMIT_LOGIN_WINDOW_MINUTES;
export const RATE_LIMIT_API_WINDOW = 60 * CONFIG_RATE_LIMIT_API_WINDOW_MINUTES;
export const RATE_LIMIT_SIGNUP_ATTEMPTS = CONFIG_RATE_LIMIT_SIGNUP_ATTEMPTS;
export const RATE_LIMIT_SIGNUP_WINDOW =
  60 * CONFIG_RATE_LIMIT_SIGNUP_WINDOW_MINUTES;

// Scanning
export const SCAN_TIMEOUT = CONFIG_SCAN_TIMEOUT_SECONDS;
export const BULK_SCAN_TIMEOUT = CONFIG_BULK_SCAN_TIMEOUT_SECONDS;

// NOTIFICATION BELL (from config-values.ts)

export const NOTIFICATION_POLL_INTERVAL_MS =
  CONFIG_NOTIFICATION_POLL_INTERVAL_MS;
export const NOTIFICATION_DEFAULT_DISMISS_MAX_AGE =
  60 * 60 * 24 * CONFIG_NOTIFICATION_DEFAULT_DISMISS_DAYS;
export const SITE_NOTIFICATION_DEFAULT_DISMISS_MAX_AGE_MS =
  60 * 60 * 24 * CONFIG_SITE_NOTIFICATION_DEFAULT_DISMISS_DAYS * 1000;

// HTTP HEADERS

export const COMMON_HEADERS = {
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

// ERROR MESSAGES

export const ERROR_MESSAGES = {
  // Authentication - Professional, clear messages
  INVALID_CREDENTIALS:
    "The email or password you entered is incorrect. Please try again.",
  EMAIL_NOT_VERIFIED: "Please verify your email address before signing in.",
  ACCOUNT_DISABLED:
    "Your account has been suspended. Please contact support for assistance.",
  SESSION_EXPIRED:
    "Your session has expired. Please sign in again to continue.",
  INVALID_2FA:
    "The verification code you entered is invalid. Please try again.",
  INVALID_2FA_SESSION:
    "Your verification session has expired. Please sign in again.",

  // Validation - Clear, actionable messages
  REQUIRED_FIELD: (field: string) => `${field} is required.`,
  INVALID_EMAIL: "Please enter a valid email address.",
  WEAK_PASSWORD: "Password must be at least 8 characters long.",
  PASSWORDS_NOT_MATCH: "The passwords you entered do not match.",

  // Rate limiting - Informative with timing
  TOO_MANY_ATTEMPTS: (resource: string, minutes: number) =>
    `Too many ${resource} attempts. Please wait ${minutes} minute${minutes > 1 ? "s" : ""} before trying again.`,

  // Database - User-friendly errors
  DATABASE_ERROR: "A temporary error occurred. Please try again in a moment.",
  DUPLICATE_EMAIL: "An account with this email address already exists.",

  // Authorization - Clear, professional responses
  UNAUTHORIZED:
    "Authentication required. Please sign in to access this resource.",
  FORBIDDEN: "You do not have permission to access this resource.",
  NOT_FOUND: "The requested resource could not be found.",
  SERVER_ERROR: "An unexpected error occurred. Please try again later.",

  // API-specific messages
  INVALID_API_KEY: "The API key provided is invalid or has been revoked.",
  API_KEY_REQUIRED: "An API key is required to access this endpoint.",
  RATE_LIMIT_EXCEEDED: "Rate limit exceeded. Please slow down your requests.",
  INVALID_REQUEST:
    "The request could not be processed. Please check your input.",
  METHOD_NOT_ALLOWED: "This HTTP method is not supported for this endpoint.",
};

// SUCCESS MESSAGES

export const SUCCESS_MESSAGES = {
  LOGIN: "Logged in successfully",
  SIGNUP: "Account created successfully",
  LOGOUT: "Logged out successfully",
  EMAIL_VERIFIED: "Email verified successfully",
  PASSWORD_RESET: "Password reset successfully",
  SETTINGS_UPDATED: "Settings updated successfully",
  TWO_FA_ENABLED: "Two-factor authentication enabled",
  TWO_FA_DISABLED: "Two-factor authentication disabled",
  DEVICE_REMEMBERED: "Device will be remembered for 30 days",
  DELETED: "Resource deleted successfully",
};

// REGEX PATTERNS

export const PATTERNS = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  URL: /^https?:\/\/.+/i,
  DOMAIN:
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i,
  PASSWORD: /^.{8,}$/, // At least 8 characters
  BACKUP_CODE: /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/,
  TOTP_CODE: /^\d{6}$/,
};

// RATE LIMIT CONFIGS (from config-values.ts)
//
// Compiled defaults only -- NOT resolver-aware, does not consult an admin's
// live override. lib/rate-limiting/rate-limit.ts imports this (aliased to
// RATE_LIMIT_DEFAULTS) to build its OWN `RATE_LIMITS` export, which tags
// each entry with a `limit` name checkRateLimit() uses to look up the
// admin-configured value. A route that imports RATE_LIMITS from here
// instead of from lib/rate-limiting/rate-limit.ts silently always
// enforces this hardcoded default and ignores whatever the admin panel
// says -- this exact bug hit 11 routes (AUDIT-009#dup-01), so this export
// is deliberately NOT named RATE_LIMITS anymore to make that collision
// impossible. If you need a rate limit in a route handler, import
// RATE_LIMITS from lib/rate-limiting/rate-limit.ts, never from here.
export const RATE_LIMIT_DEFAULTS = {
  login: {
    maxAttempts: CONFIG_RATE_LIMIT_LOGIN_ATTEMPTS,
    windowSeconds: 60 * CONFIG_RATE_LIMIT_LOGIN_WINDOW_MINUTES,
  },
  forgotPassword: {
    maxAttempts: CONFIG_RATE_LIMIT_FORGOT_PASSWORD_ATTEMPTS,
    windowSeconds: 60 * CONFIG_RATE_LIMIT_FORGOT_PASSWORD_WINDOW_MINUTES,
  },
  signup: {
    maxAttempts: CONFIG_RATE_LIMIT_SIGNUP_ATTEMPTS,
    windowSeconds: 60 * CONFIG_RATE_LIMIT_SIGNUP_WINDOW_MINUTES,
  },
  api: {
    maxAttempts: CONFIG_RATE_LIMIT_API_REQUESTS,
    windowSeconds: 60 * CONFIG_RATE_LIMIT_API_WINDOW_MINUTES,
  },
  scan: {
    maxAttempts: CONFIG_RATE_LIMIT_SCAN_REQUESTS,
    windowSeconds: 60 * CONFIG_RATE_LIMIT_SCAN_WINDOW_MINUTES,
  },
  bulkScan: {
    maxAttempts: CONFIG_RATE_LIMIT_BULK_SCAN_REQUESTS,
    windowSeconds: 60 * CONFIG_RATE_LIMIT_BULK_SCAN_WINDOW_MINUTES,
  },
  // rate-limit: per-user cap on BrowserBase session creation.
  // BrowserBase is a paid metered service — without this, a
  // compromised session cookie can rack up real costs.
  browserSession: {
    maxAttempts: CONFIG_RATE_LIMIT_BROWSER_SESSION_ATTEMPTS,
    windowSeconds: 60 * CONFIG_RATE_LIMIT_BROWSER_SESSION_WINDOW_MINUTES,
  },
  // rate-limit: per-user cap on AI chat requests to prevent cost amplification.
  aiChat: {
    maxAttempts: CONFIG_RATE_LIMIT_AI_CHAT_ATTEMPTS,
    windowSeconds: 60 * CONFIG_RATE_LIMIT_AI_CHAT_WINDOW_MINUTES,
  },
  // rate-limit: per-admin cap on admin PATCH re-auth attempts to prevent
  // brute-forcing the admin password through the re-auth gate.
  adminReauth: {
    maxAttempts: CONFIG_RATE_LIMIT_ADMIN_REAUTH_ATTEMPTS,
    windowSeconds: 60 * CONFIG_RATE_LIMIT_ADMIN_REAUTH_WINDOW_MINUTES,
  },
  // rate-limit: per-user cap on billing verify code attempts.
  // 6-digit codes have 900k combinations; without this gate an attacker
  // with a stolen session cookie could brute-force the code in the
  // validity window (ref: AUDIT-006#billing-01).
  billingVerify: {
    maxAttempts: CONFIG_RATE_LIMIT_BILLING_VERIFY_ATTEMPTS,
    windowSeconds: 60 * CONFIG_RATE_LIMIT_BILLING_VERIFY_WINDOW_MINUTES,
  },
  // rate-limit: per-user cap on team invite sends to prevent email spam
  // via a compromised or malicious team-owner account (ref: AUDIT-006#team-01).
  teamInvite: {
    maxAttempts: CONFIG_RATE_LIMIT_TEAM_INVITE_ATTEMPTS,
    windowSeconds: 60 * CONFIG_RATE_LIMIT_TEAM_INVITE_WINDOW_MINUTES,
  },
  // rate-limit: per-user cap on AI finding-verification requests, shared by
  // /api/v3/scan/verify and /api/v3/scan/verify-batch (same underlying
  // per-finding AI pipeline, so they share one bucket rather than doubling
  // effective quota across the two routes).
  aiVerify: {
    maxAttempts: CONFIG_RATE_LIMIT_AI_VERIFY_ATTEMPTS,
    windowSeconds: 60 * CONFIG_RATE_LIMIT_AI_VERIFY_WINDOW_MINUTES,
  },
  // rate-limit: per-user cap on AI scan-summary generation requests
  // (/api/v3/history/[id]/summary). Only consulted on an actual
  // generate/regenerate call -- a cached summary short-circuits before this
  // gate is checked.
  aiSummary: {
    maxAttempts: CONFIG_RATE_LIMIT_AI_SUMMARY_ATTEMPTS,
    windowSeconds: 60 * CONFIG_RATE_LIMIT_AI_SUMMARY_WINDOW_MINUTES,
  },
  // rate-limit: per-user cap on scan tag add/remove calls
  // (POST /api/v3/scan/tags). No external cost, but still an unbounded
  // write against a user's own scan history without a gate.
  scanTags: {
    maxAttempts: CONFIG_RATE_LIMIT_SCAN_TAGS_ATTEMPTS,
    windowSeconds: 60 * CONFIG_RATE_LIMIT_SCAN_TAGS_WINDOW_MINUTES,
  },
  // rate-limit: per-IP cap on GET /api/v3/public-scans. Unauthenticated
  // by design (it's a public directory) -- no session/API-key gate to
  // fall back on, so this is the only throttle in front of it.
  publicScans: {
    maxAttempts: CONFIG_RATE_LIMIT_PUBLIC_SCANS_ATTEMPTS,
    windowSeconds: 60 * CONFIG_RATE_LIMIT_PUBLIC_SCANS_WINDOW_MINUTES,
  },
};

// AUTHENTICATED SCANNING (from config-values.ts). Fully ephemeral: see
// lib/scanner/auth/types.ts and app/api/v3/scan/authenticated/route.ts.

export const SCAN_AUTH = {
  ENABLED: CONFIG_SCAN_AUTH_ENABLED,
  MAX_SECRET_LENGTH: CONFIG_SCAN_AUTH_MAX_SECRET_LENGTH,
  MAX_COOKIES: CONFIG_SCAN_AUTH_MAX_COOKIES,
  VERIFY_TIMEOUT_MS: CONFIG_SCAN_AUTH_VERIFY_TIMEOUT_MS,
  MAX_LOGIN_BODY_BYTES: CONFIG_SCAN_AUTH_MAX_LOGIN_BODY_BYTES,
  MAX_COOKIE_AGE_SECONDS: CONFIG_SCAN_AUTH_MAX_COOKIE_AGE_SECONDS,
  BASELINE_DIFF_BYTES: CONFIG_SCAN_AUTH_BASELINE_DIFF_BYTES,
  BROWSER_NAV_TIMEOUT_MS: CONFIG_SCAN_AUTH_BROWSER_NAV_TIMEOUT_MS,
  BROWSER_SETTLE_MS: CONFIG_SCAN_AUTH_BROWSER_SETTLE_MS,
  BROWSER_MAX_WAIT_MS: CONFIG_SCAN_AUTH_BROWSER_MAX_WAIT_MS,
  BROWSER_SESSION_TIMEOUT_SECONDS:
    CONFIG_SCAN_AUTH_BROWSER_SESSION_TIMEOUT_SECONDS,
  BROWSER_MAX_HTML_CHARS: CONFIG_SCAN_AUTH_BROWSER_MAX_HTML_CHARS,
};

// DATABASE CONSTRAINTS (from config-values.ts)

export const DATABASE = {
  MAX_EMAIL_LENGTH: CONFIG_MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH: CONFIG_MAX_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH: CONFIG_MAX_DESCRIPTION_LENGTH,
  MAX_TEAM_NAME_LENGTH: CONFIG_MAX_TEAM_NAME_LENGTH,
  MAX_TAGS_PER_SCAN: CONFIG_MAX_TAGS_PER_SCAN,
};

// SECURITY SCANNING CONSTRAINTS (from config-values.ts)

export const SCANNING = {
  MAX_URL_LENGTH: CONFIG_MAX_URL_LENGTH,
  MAX_URLS_IN_BULK: CONFIG_MAX_URLS_BULK,
  TIMEOUT_SECONDS: CONFIG_SCAN_TIMEOUT_SECONDS,
  BULK_TIMEOUT_SECONDS: CONFIG_BULK_SCAN_TIMEOUT_SECONDS,
  CRAWL_TIMEOUT_SECONDS: CONFIG_CRAWL_SCAN_TIMEOUT_SECONDS,
  STATUS_POLL_INTERVAL_MS: CONFIG_SCAN_STATUS_POLL_INTERVAL_MS,
  DEFAULT_SEVERITY_THRESHOLD: CONFIG_DEFAULT_SEVERITY_THRESHOLD,
};

// PAGINATION (from config-values.ts)

export const PAGINATION = {
  DEFAULT_PAGE_SIZE: CONFIG_PAGINATION_DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE: CONFIG_PAGINATION_MAX_PAGE_SIZE,
  DEFAULT_PAGE: CONFIG_PAGINATION_DEFAULT_PAGE,
};

// BILLING / PREMIUM (from config-values.ts)

// When BILLING_ENABLED is false, all users get unlimited access
// Self-hosters can disable this to remove all premium restrictions

export const BILLING_ENABLED = CONFIG_BILLING_ENABLED;
export const BILLING_PLAN_LIMITS = {
  free: CONFIG_BILLING_FREE_LIMIT,
  core_supporter: CONFIG_BILLING_CORE_SUPPORTER_LIMIT,
  pro_supporter: CONFIG_BILLING_PRO_SUPPORTER_LIMIT,
  elite_supporter: CONFIG_BILLING_ELITE_SUPPORTER_LIMIT,
};
export const BILLING_HISTORY_RETENTION = {
  free: CONFIG_BILLING_FREE_RETENTION,
  core_supporter: CONFIG_BILLING_CORE_SUPPORTER_RETENTION,
  pro_supporter: CONFIG_BILLING_PRO_SUPPORTER_RETENTION,
  elite_supporter: CONFIG_BILLING_ELITE_SUPPORTER_RETENTION,
};
export const BILLING_UNLIMITED_MODE_LIMIT = CONFIG_BILLING_UNLIMITED_MODE_LIMIT;

// TEAM ROLES

export const TEAM_ROLES = {
  OWNER: "owner",
  ADMIN: "admin",
  MEMBER: "member",
  VIEWER: "viewer",
};

export const TEAM_ROLE_PERMISSIONS = {
  [TEAM_ROLES.OWNER]: [
    "manage_team",
    "manage_members",
    "manage_scans",
    "view_reports",
  ],
  [TEAM_ROLES.ADMIN]: ["manage_members", "manage_scans", "view_reports"],
  [TEAM_ROLES.MEMBER]: ["manage_scans", "view_reports"],
  [TEAM_ROLES.VIEWER]: ["view_reports"],
};

// VULNERABILITY SEVERITY LEVELS

//
// SEVERITY_LEVELS lives in lib/config/client-constants.ts (single source).
// Re-exported here for server-side convenience.
export { SEVERITY_LEVELS } from "@/lib/config/client-constants";

export const SEVERITY_PRIORITY = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

// EMAIL / SMTP CONFIG (from config.yaml + env vars)

export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || CONFIG_SUPPORT_EMAIL;
export const LEGAL_EMAIL = CONFIG_LEGAL_EMAIL;
export const SECURITY_EMAIL = CONFIG_SECURITY_EMAIL;
export const ENTERPRISE_EMAIL = CONFIG_ENTERPRISE_EMAIL;
export const NOREPLY_EMAIL = CONFIG_NOREPLY_EMAIL;

export const SMTP_HOST = process.env.SMTP_HOST || "";
export const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
export const SMTP_USER = process.env.SMTP_USER || "";
export const SMTP_PASS = process.env.SMTP_PASS || "";
export const SMTP_FROM =
  process.env.SMTP_FROM || process.env.SMTP_USER || SMTP_USER;

// API KEY CONFIGURATION (from config-values.ts)

export const API_KEY_PREFIX = CONFIG_API_KEY_PREFIX;
export const DEFAULT_API_KEY_DAILY_LIMIT = CONFIG_DEFAULT_API_KEY_DAILY_LIMIT;
export const API_CURRENT_VERSION = CONFIG_API_CURRENT_VERSION;

// Auth / headers
export const AUTH_HEADER = "authorization";
export const BEARER_PREFIX = "Bearer ";

// TOTP issuer
export const TOTP_ISSUER = APP_NAME;

// TURNSTILE / CAPTCHA CONFIG

export const TURNSTILE_ENABLED = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

// BROWSERBASE / LIVE BROWSER VIEWER CONFIG

export const BROWSERBASE_ENABLED = !!(
  process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID
);
export const BROWSERBASE_MAX_TTL_SECONDS = CONFIG_BROWSERBASE_MAX_TTL_SECONDS;
export const BROWSERBASE_DEFAULT_TTL_SECONDS =
  CONFIG_BROWSERBASE_DEFAULT_TTL_SECONDS;
export const BROWSERBASE_LOGS_POLL_INTERVAL_MS =
  CONFIG_BROWSERBASE_LOGS_POLL_INTERVAL_MS;

// DEMO SCAN LIMITS (from config-values.ts)

export const DEMO_SCAN_LIMIT = CONFIG_DEMO_SCAN_LIMIT;
export const DEMO_SCAN_WINDOW = 60 * 60 * CONFIG_DEMO_WINDOW_HOURS;

// STAFF / ADMIN ROLES, ROLE BADGE STYLES, ROUTES, API, API_VERSION

// All client-safe constants live in lib/config/client-constants.ts as
// the single source of truth. Server-side this module re-exports them
// so existing imports (`from "@/lib/config/constants"`) keep working
// unchanged while adding new routes stays a single-file edit.

export {
  STAFF_ROLES,
  type StaffRole,
  STAFF_ROLE_HIERARCHY,
  STAFF_ROLE_LABELS,
  ROLE_BADGE_STYLES,
  ROUTES,
  API_VERSION,
  API,
  API_KEY_SCOPES,
  type ApiKeyScope,
  ALL_API_KEY_SCOPES,
  DEFAULT_NEW_KEY_SCOPES,
  API_KEY_SCOPE_LABELS,
  API_KEY_SCOPE_DESCRIPTIONS,
  resolveApiKeyScopes,
} from "@/lib/config/client-constants";

// Additions that only exist on the server side are now in client-constants.ts.
// (PRICING_ROUTE and GDPR_REQUEST_ROUTE are aliases of ROUTES.PRICING and
// ROUTES.GDPR_REQUEST respectively.)

// API V3 ENDPOINTS

export const API_V3 = {
  AUTH: {
    ME: "/api/v3/auth/me",
    LOGIN: "/api/v3/auth/login",
    SIGNUP: "/api/v3/auth/signup",
    LOGOUT: "/api/v3/auth/logout",
    UPDATE: "/api/v3/auth/update",
    FORGOT_PASSWORD: "/api/v3/auth/forgot-password",
    RESET_PASSWORD: "/api/v3/auth/reset-password",
    VERIFY_EMAIL: "/api/v3/auth/verify-email",
    RESEND_VERIFICATION: "/api/v3/auth/resend-verification",
    ACCEPT_TOS: "/api/v3/auth/accept-tos",
    ONBOARDING: "/api/v3/auth/onboarding",
    TWO_FA: {
      SETUP: "/api/v3/auth/2fa/setup",
      VERIFY: "/api/v3/auth/2fa/verify",
      DISABLE: "/api/v3/auth/2fa/disable",
      EMAIL_SETUP: "/api/v3/auth/2fa/email-setup",
      EMAIL_SEND: "/api/v3/auth/2fa/email-send",
      BACKUP_CODES: "/api/v3/auth/2fa/backup-codes",
    },
  },
  SCAN: "/api/v3/scan",
  SCAN_BULK: "/api/v3/scan/bulk",
  SCAN_TAGS: "/api/v3/scan/tags",
  SCAN_DISCOVER: "/api/v3/scan/discover",
  SCAN_DISCOVER_PROGRESS: (requestId: string) =>
    `/api/v3/scan/discover/progress/${requestId}`,
  SCAN_CRAWL_DISCOVER: "/api/v3/scan/crawl/discover",
  DEMO_SCAN: "/api/v3/demo-scan",
  HISTORY: "/api/v3/history",
  DASHBOARD: "/api/v3/dashboard",
  SHARES: "/api/v3/shares",
  KEYS: "/api/v3/keys",
  WEBHOOKS: "/api/v3/webhooks",
  SCHEDULES: "/api/v3/schedules",
  TEAMS: "/api/v3/teams",
  TEAMS_MEMBERS: "/api/v3/teams/members",
  TEAMS_ACCEPT_INVITE: "/api/v3/teams/accept-invite",
  NOTIFICATIONS: "/api/v3/notifications",
  CONTACT: "/api/v3/contact",
  LANDING_CONTACT: "/api/v3/landing-contact",
  ADMIN: "/api/v3/admin",
  BADGE_SCANS: "/api/v3/badge/scans",
  DATA_REQUEST: "/api/v3/data-request",
  ACCOUNT_DELETE: "/api/v3/account/delete",
  ACCOUNT_NOTIFICATIONS: "/api/v3/account/notifications",
  FINDING_TYPES: "/api/v3/finding-types",
  COMPARE: "/api/v3/compare",
} as const;

// Backwards-compatible alias for the v2 constant name (now points to v3)
export const API_V2 = API_V3;

// FEATURE FLAGS (from config-values.ts)

export const FEATURES = {
  DEMO_MODE: CONFIG_FEATURE_DEMO_MODE,
  TEAMS: CONFIG_FEATURE_TEAMS,
  API_KEYS: CONFIG_FEATURE_API_KEYS,
  WEBHOOKS: CONFIG_FEATURE_WEBHOOKS,
  SCHEDULED_SCANS: CONFIG_FEATURE_SCHEDULED_SCANS,
  BULK_SCANS: CONFIG_FEATURE_BULK_SCANS,
  PDF_REPORTS: CONFIG_FEATURE_PDF_REPORTS,
  EMAIL_NOTIFICATIONS: CONFIG_FEATURE_EMAIL_NOTIFICATIONS,
} as const;

// RE-EXPORT CONFIG FOR CONVENIENCE

export { getConfig, CONFIG } from "./config";
