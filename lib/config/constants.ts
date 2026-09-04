// APP CONSTANTS - Centralized configuration for the entire application

// This file imports from config-values.ts which contains hardcoded defaults.
// Self-hosters: Modify lib/config/config-values.ts to customize your deployment.

// SERVER-SIDE SUPERSET. This module is the union of
// lib/config/client-constants.ts (re-exported wholesale at the bottom) and the
// values below, which read non-public environment variables or exist only to
// serve server code. A `"use client"` file must import client-constants.ts
// instead: importing this one pulls the environment reads into the browser
// bundle, which is what AUDIT-012#fe-15 found in the committed build (the
// /layout chunk, on all 311 routes, carried `i.env.SMTP_PASS` and
// `i.env.BROWSERBASE_API_KEY` as bare expression statements).
//
// The SMTP credentials and the Browserbase configured-check that this file
// used to declare now live in lib/config/server-constants.ts behind an
// `import "server-only"` guard, so no rename can put them back on the wire.
// This module will get the same guard once the last client component is
// migrated off it.

import {
  CONFIG_MIN_SCHEMA_VERSION,
  CONFIG_APP_DESCRIPTION,
  CONFIG_SUPPORT_EMAIL,
  CONFIG_LEGAL_EMAIL,
  CONFIG_SECURITY_EMAIL,
  CONFIG_ENTERPRISE_EMAIL,
  CONFIG_NOREPLY_EMAIL,
  CONFIG_TERMS_UPDATED_AT,
  CONFIG_LOGO_URL,
  CONFIG_PRIMARY_COLOR,
  CONFIG_BACKGROUND_COLOR_DARK,
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
  CONFIG_CHROME_WEB_STORE_URL,
  CONFIG_FIREFOX_ADDON_URL,
  CONFIG_SESSION_COOKIE_NAME,
  CONFIG_SESSION_MAX_AGE_DAYS,
  CONFIG_DEVICE_TRUST_COOKIE_NAME,
  CONFIG_2FA_PENDING_COOKIE_NAME,
  CONFIG_CLEANUP_INTERVAL_MS,
  CONFIG_DB_CLEANUP_INTERVAL_MS,
  CONFIG_RATE_LIMIT_LOGIN_ATTEMPTS,
  CONFIG_RATE_LIMIT_LOGIN_WINDOW_MINUTES,
  CONFIG_RATE_LIMIT_SIGNUP_ATTEMPTS,
  CONFIG_RATE_LIMIT_SIGNUP_WINDOW_MINUTES,
  CONFIG_RATE_LIMIT_FORGOT_PASSWORD_ATTEMPTS,
  CONFIG_RATE_LIMIT_FORGOT_PASSWORD_WINDOW_MINUTES,
  CONFIG_RATE_LIMIT_SIGNUP_EMAIL_ATTEMPTS,
  CONFIG_RATE_LIMIT_SIGNUP_EMAIL_WINDOW_MINUTES,
  CONFIG_RATE_LIMIT_FORGOT_PASSWORD_EMAIL_ATTEMPTS,
  CONFIG_RATE_LIMIT_FORGOT_PASSWORD_EMAIL_WINDOW_MINUTES,
  CONFIG_RATE_LIMIT_DOMAIN_ADD_ATTEMPTS,
  CONFIG_RATE_LIMIT_DOMAIN_ADD_WINDOW_MINUTES,
  CONFIG_RATE_LIMIT_DOMAIN_VERIFY_ATTEMPTS,
  CONFIG_RATE_LIMIT_DOMAIN_VERIFY_WINDOW_MINUTES,
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
  CONFIG_API_KEY_PREFIX,
  CONFIG_DEFAULT_API_KEY_DAILY_LIMIT,
  CONFIG_BROWSERBASE_MAX_TTL_SECONDS,
  CONFIG_BROWSERBASE_DEFAULT_TTL_SECONDS,
  CONFIG_MAX_EMAIL_LENGTH,
  CONFIG_MAX_NAME_LENGTH,
  CONFIG_MAX_DESCRIPTION_LENGTH,
  CONFIG_MAX_TEAM_NAME_LENGTH,
  CONFIG_MAX_TAGS_PER_SCAN,
  CONFIG_PAGINATION_DEFAULT_PAGE_SIZE,
  CONFIG_PAGINATION_MAX_PAGE_SIZE,
  CONFIG_PAGINATION_DEFAULT_PAGE,
  CONFIG_BILLING_UNLIMITED_MODE_LIMIT,
  CONFIG_AI_CHAT_MAX_TOKENS,
  CONFIG_AI_VERIFY_MAX_TOKENS,
  CONFIG_AI_VERIFY_CALL_TIMEOUT_MS,
  CONFIG_AI_VERIFY_PROBE_TIMEOUT_MS,
  CONFIG_AI_VERIFY_TOTAL_TIMEOUT_MS,
  CONFIG_AI_SUMMARY_MAX_TOKENS,
  CONFIG_DATA_EXPORT_COOLDOWN_DAYS,
  CONFIG_RATE_LIMIT_2FA_VERIFY_ATTEMPTS,
  CONFIG_RATE_LIMIT_2FA_VERIFY_WINDOW_MINUTES,
} from "./config-values";
// Imported for local use below (LOGO_URL, TOTP_ISSUER, VERSION_CHECK_URL);
// the same names are re-exported wholesale at the bottom of this file.
import { APP_NAME, APP_URL, APP_REPO } from "@/lib/config/client-constants";

export const DATA_EXPORT_COOLDOWN_DAYS = CONFIG_DATA_EXPORT_COOLDOWN_DAYS;
export const AI_CHAT_MAX_TOKENS = CONFIG_AI_CHAT_MAX_TOKENS;
export const AI_VERIFY_MAX_TOKENS = CONFIG_AI_VERIFY_MAX_TOKENS;
export const AI_VERIFY_CALL_TIMEOUT_MS = CONFIG_AI_VERIFY_CALL_TIMEOUT_MS;
export const AI_VERIFY_PROBE_TIMEOUT_MS = CONFIG_AI_VERIFY_PROBE_TIMEOUT_MS;
export const AI_VERIFY_TOTAL_TIMEOUT_MS = CONFIG_AI_VERIFY_TOTAL_TIMEOUT_MS;
export const AI_SUMMARY_MAX_TOKENS = CONFIG_AI_SUMMARY_MAX_TOKENS;

// APPLICATION METADATA (from config-values.ts -> config.yaml)
//
// APP_NAME, APP_SLUG, APP_VERSION, ENGINE_VERSION, TOTAL_CHECKS_LABEL,
// APP_URL, APP_REPO and DEFAULT_SCAN_NOTE all moved to client-constants.ts
// (AUDIT-012#fe-15) and are re-exported from here unchanged. Only the values
// no client component has any business reading are still declared below.

export const MIN_SCHEMA_VERSION = CONFIG_MIN_SCHEMA_VERSION;
export const APP_DESCRIPTION = CONFIG_APP_DESCRIPTION;
export const TERMS_UPDATED_AT = CONFIG_TERMS_UPDATED_AT;

export const VERSION_CHECK_URL = `https://api.github.com/repos/${APP_REPO}/releases/latest`;
export const RELEASES_URL = `https://github.com/${APP_REPO}/releases`;
// Extension store listings. The shipped defaults are VulnRadar's own, and
// components/seo/structured-data.tsx emits them in the JSON-LD Organization
// node's sameAs array, which claims they are the same organisation's
// profiles. A fork points these at its own listings with the env vars rather
// than editing the source (same pattern as the SEO verification tokens
// below). An empty or unset variable falls back to the compiled default, so
// a fork with no listing at all blanks CONFIG_* in config-values.ts instead.
export const CHROME_WEB_STORE_URL =
  process.env.NEXT_PUBLIC_CHROME_WEB_STORE_URL || CONFIG_CHROME_WEB_STORE_URL;
export const FIREFOX_ADDON_URL =
  process.env.NEXT_PUBLIC_FIREFOX_ADDON_URL || CONFIG_FIREFOX_ADDON_URL;

// BRANDING (from config-values.ts)

// Server-side twin of client-constants.ts's LOGO_URL, which resolves to
// `${APP_URL}${CONFIG_LOGO_URL}`. Only this one honours the bare `LOGO_URL`
// variable, and it can only be this one: Next inlines NEXT_PUBLIC_* alone
// into client code, so the same read in a browser bundle is always undefined
// and does nothing but ship the variable name.
export const LOGO_URL = process.env.LOGO_URL || `${APP_URL}${CONFIG_LOGO_URL}`;
export const BRANDING_PRIMARY_COLOR = CONFIG_PRIMARY_COLOR;
export const BRANDING_BACKGROUND_DARK = CONFIG_BACKGROUND_COLOR_DARK;

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

// COOKIE NAMES AND SETTINGS (from config-values.ts)
//
// The version-notification cookie moved to client-constants.ts: the banner
// that sets it renders in the browser.

// Authentication
export const AUTH_SESSION_COOKIE_NAME = CONFIG_SESSION_COOKIE_NAME;
// LEGACY DEFAULT ONLY -- no importers, and do not add one. Session lifetime
// moved to the admin-configurable SESSION_MAX_AGE_DAYS setting; every call
// site reads getSetting("SESSION_MAX_AGE_DAYS") now. This constant is the
// compiled fallback the registry seeds that setting from, nothing else.
// Importing it would freeze one caller at the shipped default while the rest
// of the app follows the admin's value, with no compiler error to say so
// (AUDIT-009#drift-01).
export const AUTH_SESSION_MAX_AGE = 60 * 60 * 24 * CONFIG_SESSION_MAX_AGE_DAYS;
export const AUTH_CLEANUP_INTERVAL = CONFIG_CLEANUP_INTERVAL_MS;
export const DB_CLEANUP_INTERVAL = CONFIG_DB_CLEANUP_INTERVAL_MS;
export const AUTH_2FA_PENDING_COOKIE = CONFIG_2FA_PENDING_COOKIE_NAME;
// There is deliberately no compiled AUTH_2FA_PENDING_MAX_AGE export here any
// more. It existed for exactly one caller, the login route's pending-2FA
// cookie maxAge, and that was the bug: every route that VALIDATES a pending
// token reads getSetting("2FA_PENDING_MAX_AGE_SECONDS"), so an admin who
// widened the window widened the check while the browser still dropped the
// cookie at the shipped default. The login route now resolves the same live
// setting the validators do (AUDIT-009#settings-04).

// Device trust
export const DEVICE_TRUST_COOKIE_NAME = CONFIG_DEVICE_TRUST_COOKIE_NAME;

// TIME INTERVALS (from config-values.ts)
//
// The auth timings the sign-in and reset forms quote back to the user
// (TOTP_CODE_VALIDITY, PASSWORD_MIN_LENGTH, the two token lifetimes,
// DEVICE_TRUST_DURATION) live in client-constants.ts and are re-exported
// below.

// Rate limiting
export const RATE_LIMIT_LOGIN_ATTEMPTS = CONFIG_RATE_LIMIT_LOGIN_ATTEMPTS;
export const RATE_LIMIT_SIGNUP_ATTEMPTS = CONFIG_RATE_LIMIT_SIGNUP_ATTEMPTS;

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
  // Takes the minimum rather than hardcoding it: this used to be a flat
  // string saying 8, four lines below PASSWORD_MIN_LENGTH, which is 12 and
  // admin-editable on top of that. Nothing rendered it, so no user ever saw
  // the wrong number, but the next caller to reach for it would have
  // shipped one. Pass the resolved minimum, the same way
  // components/auth/reset-password-form.tsx already interpolates it.
  WEAK_PASSWORD: (min: number) =>
    `Password must be at least ${min} characters long.`,
  PASSWORDS_NOT_MATCH: "The passwords you entered do not match.",

  // Rate limiting - Informative with timing
  //
  // `resource` is the WHOLE noun phrase ("reset attempts", "AI requests",
  // "tag changes"), not a bare noun the template completes. It used to append
  // a literal " attempts", and every one of the four live callers already
  // passed a phrase ending in that word, so the shipped sentence read "Too
  // many reset attempts attempts." on the forgot-password and signup limits.
  // Appending it also made the helper unusable for most of the routes that
  // still hand-roll this sentence, since theirs are "Too many AI requests"
  // and "Too many domains added recently", not attempts at anything.
  TOO_MANY_ATTEMPTS: (resource: string, minutes: number) =>
    `Too many ${resource}. Please wait ${minutes} minute${minutes > 1 ? "s" : ""} before trying again.`,

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
//
// LEGACY DEFAULT ONLY -- zero importers. Validation is done with zod schemas
// at each route boundary, which is where it belongs; these were the
// pre-zod shapes. Do not reach for PATTERNS.EMAIL over z.string().email():
// the regex here accepts addresses zod rejects, so a route validating with
// this one would let through what the rest of the app will not
// (AUDIT-011#drift-24).
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
  // rate-limit: the per-EMAIL companions to the two per-IP auth limits above.
  // The per-IP bucket is defeated by a residential proxy pool; these are keyed
  // on the normalized address, so every attempt against one account lands in
  // the same bucket however the request is routed.
  signupEmail: {
    maxAttempts: CONFIG_RATE_LIMIT_SIGNUP_EMAIL_ATTEMPTS,
    windowSeconds: 60 * CONFIG_RATE_LIMIT_SIGNUP_EMAIL_WINDOW_MINUTES,
  },
  forgotPasswordEmail: {
    maxAttempts: CONFIG_RATE_LIMIT_FORGOT_PASSWORD_EMAIL_ATTEMPTS,
    windowSeconds: 60 * CONFIG_RATE_LIMIT_FORGOT_PASSWORD_EMAIL_WINDOW_MINUTES,
  },
  // rate-limit: per-user caps on domain verification. Adding mints a token and
  // writes a row; verifying fires a live DNS lookup. Verify is the looser of
  // the two because a user fixing a typo'd TXT record legitimately retries.
  domainAdd: {
    maxAttempts: CONFIG_RATE_LIMIT_DOMAIN_ADD_ATTEMPTS,
    windowSeconds: 60 * CONFIG_RATE_LIMIT_DOMAIN_ADD_WINDOW_MINUTES,
  },
  domainVerify: {
    maxAttempts: CONFIG_RATE_LIMIT_DOMAIN_VERIFY_ATTEMPTS,
    windowSeconds: 60 * CONFIG_RATE_LIMIT_DOMAIN_VERIFY_WINDOW_MINUTES,
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
  // BrowserBase is a paid metered service, so without this a
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
  // rate-limit: per-userId cap on 2FA/TOTP verification attempts
  // (POST /api/v3/auth/2fa/verify), the brute-force throttle on 6-digit
  // codes.
  twoFactorVerify: {
    maxAttempts: CONFIG_RATE_LIMIT_2FA_VERIFY_ATTEMPTS,
    windowSeconds: 60 * CONFIG_RATE_LIMIT_2FA_VERIFY_WINDOW_MINUTES,
  },
};

// DATABASE CONSTRAINTS (from config-values.ts)
//
// LEGACY DEFAULT ONLY -- zero importers. The length limits are enforced by
// each route's own zod schema and by the column widths in instrumentation.ts,
// not from here. Same caveat as PAGINATION below: read the live setting, not
// this object (AUDIT-011#drift-24).
export const DATABASE = {
  MAX_EMAIL_LENGTH: CONFIG_MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH: CONFIG_MAX_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH: CONFIG_MAX_DESCRIPTION_LENGTH,
  MAX_TEAM_NAME_LENGTH: CONFIG_MAX_TEAM_NAME_LENGTH,
  MAX_TAGS_PER_SCAN: CONFIG_MAX_TAGS_PER_SCAN,
};

// PAGINATION (from config-values.ts)
//
// LEGACY DEFAULT ONLY -- zero importers. Every paginated route parses its own
// `page` / `limit` query params and clamps them locally, so this object is the
// shipped default the registry seeds PAGINATION_* from and nothing more.
// Kept rather than deleted because /docs/config documents the CONFIG_ values
// behind it as self-host knobs; a route that imported this instead of reading
// the live setting would silently ignore the admin's page-size
// (AUDIT-009#drift-01, AUDIT-011#drift-24).
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: CONFIG_PAGINATION_DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE: CONFIG_PAGINATION_MAX_PAGE_SIZE,
  DEFAULT_PAGE: CONFIG_PAGINATION_DEFAULT_PAGE,
};

// BILLING / PREMIUM (from config-values.ts)
//
// BILLING_ENABLED, BILLING_PLAN_LIMITS and BILLING_HISTORY_RETENTION are in
// client-constants.ts (sixteen client components gate CTAs on the first
// alone) and re-exported below. Only the unlimited-mode sentinel, which no
// UI reads, is still declared here.

export const BILLING_UNLIMITED_MODE_LIMIT = CONFIG_BILLING_UNLIMITED_MODE_LIMIT;

// EMAIL ADDRESSES (from config.yaml + env vars)

/**
 * Server-side twin of client-constants.ts's SUPPORT_EMAIL, which checks
 * `NEXT_PUBLIC_SUPPORT_EMAIL` only.
 *
 * `SUPPORT_EMAIL` is a plain server variable: it resolves at runtime in
 * server code (the email templates, which is where most of these live), so an
 * operator setting it in their environment gets their own address in outgoing
 * mail without rebuilding.
 *
 * That branch cannot work in the browser: Next.js only inlines
 * `NEXT_PUBLIC_*` there, so the four client components that read this
 * (contact-quick-links, demo-error, and the two error boundaries) always got
 * the build-time literal and shipped the bare variable name for nothing. They
 * import the client twin now, which resolves to exactly the same value.
 *
 * `NEXT_PUBLIC_SUPPORT_EMAIL` is the client-side half, matching how APP_URL
 * already solves the same problem. Set both, or set neither.
 */
export const SUPPORT_EMAIL =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL ||
  process.env.SUPPORT_EMAIL ||
  CONFIG_SUPPORT_EMAIL;
export const LEGAL_EMAIL = CONFIG_LEGAL_EMAIL;
export const SECURITY_EMAIL = CONFIG_SECURITY_EMAIL;
export const ENTERPRISE_EMAIL = CONFIG_ENTERPRISE_EMAIL;
export const NOREPLY_EMAIL = CONFIG_NOREPLY_EMAIL;

// SMTP credentials are NOT here. They read SMTP_PASS and friends, and this
// module still reaches client bundles through the components that have not
// been migrated yet, so they live in lib/config/server-constants.ts behind
// `import "server-only"` (AUDIT-012#fe-15).

// API KEY CONFIGURATION (from config-values.ts)

export const API_KEY_PREFIX = CONFIG_API_KEY_PREFIX;
// LEGACY DEFAULT ONLY -- no importers, and do not add one. Same shape as
// AUTH_SESSION_MAX_AGE above: lib/api/api-keys.ts:89 reads
// getSetting("DEFAULT_API_KEY_DAILY_LIMIT"), so a key created against this
// compiled value would ignore whatever the admin panel says
// (AUDIT-009#drift-01).
export const DEFAULT_API_KEY_DAILY_LIMIT = CONFIG_DEFAULT_API_KEY_DAILY_LIMIT;

// Auth / headers
export const AUTH_HEADER = "authorization";
export const BEARER_PREFIX = "Bearer ";

// TOTP issuer
export const TOTP_ISSUER = APP_NAME;

// How long a staff invite link (app/api/v3/admin/staff-invites/route.ts,
// lib/admin/staff-invites.ts) stays valid. Lives here rather than in
// lib/admin/staff-invites.ts itself so lib/email/email.ts -- which needs it
// purely for the "expires in N days" copy in the invite email -- doesn't
// have to import that module and, transitively, the real DB pool it opens
// at module load time (that transitive import previously broke every test
// that touches email.ts without also mocking @/lib/database/db).
export const STAFF_INVITE_EXPIRY_DAYS = 7;

// BROWSERBASE / LIVE BROWSER VIEWER CONFIG
//
// BROWSERBASE_ENABLED is the one that reads the API key, so it moved to
// lib/config/server-constants.ts. These two are plain numbers and stay.

export const BROWSERBASE_MAX_TTL_SECONDS = CONFIG_BROWSERBASE_MAX_TTL_SECONDS;
export const BROWSERBASE_DEFAULT_TTL_SECONDS =
  CONFIG_BROWSERBASE_DEFAULT_TTL_SECONDS;

// CLIENT-SAFE CONSTANTS
//
// All client-safe constants live in lib/config/client-constants.ts as the
// single source of truth. Server-side this module re-exports them so existing
// imports (`from "@/lib/config/constants"`) keep working unchanged while
// adding a new route or a new shared value stays a single-file edit.
//
// Client components must import them from client-constants.ts directly. That
// is not a style preference: this module's own declarations above read
// non-public environment variables, and every one of them rides along into
// whatever bundle imports this file (AUDIT-012#fe-15).

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
  OG_INSPECT_URL_TEMPLATE,
  SEVERITY_LEVELS,
  SEVERITY_ORDER,
  SEVERITY_PRIORITY,
  APP_NAME,
  APP_SLUG,
  APP_VERSION,
  ENGINE_VERSION,
  TOTAL_CHECKS_LABEL,
  APP_URL,
  APP_REPO,
  API_CURRENT_VERSION,
  DEFAULT_SCAN_NOTE,
  DISCORD_INVITE_URL,
  SOCIAL_PLATFORM_IDS,
  type SocialPlatformId,
  type SocialLink,
  SOCIAL_LINKS,
  SOCIAL_PROFILE_URLS,
  TURNSTILE_ENABLED,
  VERSION_COOKIE_NAME,
  VERSION_COOKIE_MAX_AGE,
  TOTP_CODE_VALIDITY,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RESET_TOKEN_LIFETIME,
  EMAIL_VERIFICATION_TOKEN_LIFETIME,
  DEVICE_TRUST_DURATION,
  NOTIFICATION_POLL_INTERVAL_MS,
  NOTIFICATION_DEFAULT_DISMISS_MAX_AGE,
  BROWSERBASE_LOGS_POLL_INTERVAL_MS,
  BROWSERBASE_VIEWPORT,
  SCANNING,
  SCAN_AUTH,
  BULK_SCAN_CLIENT_URL_LIMIT,
  MAX_AVATAR_UPLOAD_BYTES,
  DEMO_SCAN_LIMIT,
  AI_CHAT_HISTORY_DAYS,
  AI_CHAT_MAX_INPUT_LENGTH,
  AI_USAGE_WINDOW_HOURS,
  GITHUB_REVIEW_FREE_TRIAL_WINDOW_HOURS,
  BILLING_ENABLED,
  BILLING_PLAN_LIMITS,
  BILLING_HISTORY_RETENTION,
  FEATURES,
  TEAM_ROLES,
  TEAM_ROLE_PERMISSIONS,
  TEAM_ROLE_INVITE_LABELS,
  hasTeamPermission,
  canAssignTeamRole,
} from "@/lib/config/client-constants";

// API V3 ENDPOINTS
//
// There is no API_V3 map here any more. It was a second, fully hardcoded copy
// of the route table above: 55 literal "/api/v3/..." strings sitting directly
// beneath the comment that says API_VERSION is what switches the API between
// versions (AUDIT-014#hc-10). Its only two consumers were
// lib/config/public-paths.ts and one test, both of which now read the same
// `API` map every other caller uses, so the version appears once in the
// source instead of twice. If you need a route here, add it to the API map in
// lib/config/client-constants.ts.
