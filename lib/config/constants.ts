// ============================================================================
// APP CONSTANTS - Centralized configuration for the entire application
// ============================================================================
// This file imports from config-values.ts which contains hardcoded defaults.
// Self-hosters: Modify lib/config/config-values.ts to customize your deployment.
// ============================================================================

import {
  CONFIG_APP_NAME,
  CONFIG_APP_SLUG,
  CONFIG_APP_VERSION,
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
  CONFIG_FOOTER_TEXT,
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
  CONFIG_MAX_URL_LENGTH,
  CONFIG_MAX_URLS_BULK,
  CONFIG_SCAN_TIMEOUT_SECONDS,
  CONFIG_BULK_SCAN_TIMEOUT_SECONDS,
  CONFIG_DEFAULT_SEVERITY_THRESHOLD,
  CONFIG_API_KEY_PREFIX,
  CONFIG_DEFAULT_API_KEY_DAILY_LIMIT,
  CONFIG_API_CURRENT_VERSION,
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
  CONFIG_BETA_ENABLED,
  CONFIG_BETA_BANNER_MESSAGE,
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
} from "./config-values";

// ============================================================================
// APPLICATION METADATA (from config-values.ts -> config.yaml)
// ============================================================================

export const APP_NAME = CONFIG_APP_NAME;
export const APP_SLUG = CONFIG_APP_SLUG;
export const APP_VERSION = CONFIG_APP_VERSION;
export const ENGINE_VERSION = CONFIG_ENGINE_VERSION;
export const APP_DESCRIPTION = CONFIG_APP_DESCRIPTION;
export const TOTAL_CHECKS_LABEL = CONFIG_TOTAL_CHECKS_LABEL;
export const APP_URL = CONFIG_APP_URL;
export const APP_REPO = CONFIG_APP_REPO;
export const TERMS_UPDATED_AT = CONFIG_TERMS_UPDATED_AT;

// Scan note with version info
export const DEFAULT_SCAN_NOTE = `${APP_NAME} v${APP_VERSION} (Detection Engine v${ENGINE_VERSION})`;

export const VERSION_CHECK_URL = `https://api.github.com/repos/${APP_REPO}/releases/latest`;
export const RELEASES_URL = `https://github.com/${APP_REPO}/releases`;

// ============================================================================
// BRANDING (from config-values.ts)
// ============================================================================

export const LOGO_URL = process.env.LOGO_URL || `${APP_URL}${CONFIG_LOGO_URL}`;
export const BRANDING_PRIMARY_COLOR = CONFIG_PRIMARY_COLOR;
export const BRANDING_FOOTER_TEXT = CONFIG_FOOTER_TEXT;

// ============================================================================
// COOKIE NAMES AND SETTINGS (from config-values.ts)
// ============================================================================

// Version notification
export const VERSION_COOKIE_NAME = CONFIG_VERSION_COOKIE_NAME;
export const VERSION_COOKIE_MAX_AGE =
  60 * 60 * 24 * CONFIG_VERSION_COOKIE_MAX_AGE_DAYS;

// Authentication
export const AUTH_SESSION_COOKIE_NAME = CONFIG_SESSION_COOKIE_NAME;
export const AUTH_SESSION_MAX_AGE = 60 * 60 * 24 * CONFIG_SESSION_MAX_AGE_DAYS;
export const AUTH_CLEANUP_INTERVAL = CONFIG_CLEANUP_INTERVAL_MS;
export const AUTH_2FA_PENDING_COOKIE = CONFIG_2FA_PENDING_COOKIE_NAME;
export const AUTH_2FA_PENDING_MAX_AGE = CONFIG_2FA_PENDING_MAX_AGE_SECONDS;

// Device trust
export const DEVICE_TRUST_COOKIE_NAME = CONFIG_DEVICE_TRUST_COOKIE_NAME;
export const DEVICE_TRUST_MAX_AGE =
  60 * 60 * 24 * CONFIG_DEVICE_TRUST_MAX_AGE_DAYS;

// ============================================================================
// TIME INTERVALS (from config-values.ts)
// ============================================================================

// Authentication timeouts
export const TOTP_CODE_VALIDITY = CONFIG_TOTP_VALIDITY_SECONDS;
export const SESSION_TIMEOUT = 60 * 60 * 24 * CONFIG_SESSION_TIMEOUT_DAYS;
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

// ============================================================================
// HTTP HEADERS
// ============================================================================

export const COMMON_HEADERS = {
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
};

// ============================================================================
// ERROR MESSAGES
// ============================================================================

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

// ============================================================================
// SUCCESS MESSAGES
// ============================================================================

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

// ============================================================================
// REGEX PATTERNS
// ============================================================================

export const PATTERNS = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  URL: /^https?:\/\/.+/i,
  DOMAIN:
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i,
  PASSWORD: /^.{8,}$/, // At least 8 characters
  BACKUP_CODE: /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/,
  TOTP_CODE: /^\d{6}$/,
};

// ============================================================================
// RATE LIMIT CONFIGS (from config-values.ts)
// ============================================================================

export const RATE_LIMITS = {
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
};

// ============================================================================
// DATABASE CONSTRAINTS (from config-values.ts)
// ============================================================================

export const DATABASE = {
  MAX_EMAIL_LENGTH: CONFIG_MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH: CONFIG_MAX_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH: CONFIG_MAX_DESCRIPTION_LENGTH,
  MAX_TEAM_NAME_LENGTH: CONFIG_MAX_TEAM_NAME_LENGTH,
  MAX_TAGS_PER_SCAN: CONFIG_MAX_TAGS_PER_SCAN,
};

// ============================================================================
// SECURITY SCANNING CONSTRAINTS (from config-values.ts)
// ============================================================================

export const SCANNING = {
  MAX_URL_LENGTH: CONFIG_MAX_URL_LENGTH,
  MAX_URLS_IN_BULK: CONFIG_MAX_URLS_BULK,
  TIMEOUT_SECONDS: CONFIG_SCAN_TIMEOUT_SECONDS,
  BULK_TIMEOUT_SECONDS: CONFIG_BULK_SCAN_TIMEOUT_SECONDS,
  DEFAULT_SEVERITY_THRESHOLD: CONFIG_DEFAULT_SEVERITY_THRESHOLD,
};

// ============================================================================
// PAGINATION (from config-values.ts)
// ============================================================================

export const PAGINATION = {
  DEFAULT_PAGE_SIZE: CONFIG_PAGINATION_DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE: CONFIG_PAGINATION_MAX_PAGE_SIZE,
  DEFAULT_PAGE: CONFIG_PAGINATION_DEFAULT_PAGE,
};

// ============================================================================
// BILLING / PREMIUM (from config-values.ts)
// ============================================================================
// When BILLING_ENABLED is false, all users get unlimited access
// Self-hosters can disable this to remove all premium restrictions
// ============================================================================

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

// ============================================================================
// TEAM ROLES
// ============================================================================

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

// ============================================================================
// VULNERABILITY SEVERITY LEVELS
// ============================================================================
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

// ============================================================================
// EMAIL / SMTP CONFIG (from config.yaml + env vars)
// ============================================================================

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

// ============================================================================
// API KEY CONFIGURATION (from config-values.ts)
// ============================================================================

export const API_KEY_PREFIX = CONFIG_API_KEY_PREFIX;
export const DEFAULT_API_KEY_DAILY_LIMIT = CONFIG_DEFAULT_API_KEY_DAILY_LIMIT;
export const API_CURRENT_VERSION = CONFIG_API_CURRENT_VERSION;

// Auth / headers
export const AUTH_HEADER = "authorization";
export const BEARER_PREFIX = "Bearer ";

// TOTP issuer
export const TOTP_ISSUER = APP_NAME;

// ============================================================================
// BETA MODE CONFIGURATION (from config-values.ts)
// ============================================================================

export const BETA_MODE = CONFIG_BETA_ENABLED;
export const BETA_BANNER_MESSAGE = CONFIG_BETA_BANNER_MESSAGE;

// ============================================================================
// TURNSTILE / CAPTCHA CONFIG
// ============================================================================

export const TURNSTILE_ENABLED = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

// ============================================================================
// DEMO SCAN LIMITS (from config-values.ts)
// ============================================================================
export const DEMO_SCAN_LIMIT = CONFIG_DEMO_SCAN_LIMIT;
export const DEMO_SCAN_WINDOW = 60 * 60 * CONFIG_DEMO_WINDOW_HOURS;

// ============================================================================
// STAFF / ADMIN ROLES, ROLE BADGE STYLES, ROUTES, API, API_VERSION
// ============================================================================
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
} from "@/lib/config/client-constants";

// Additions that only exist on the server side are now in client-constants.ts.
// (PRICING_ROUTE and GDPR_REQUEST_ROUTE are aliases of ROUTES.PRICING and
// ROUTES.GDPR_REQUEST respectively.)

// ============================================================================
// API V2 ENDPOINTS
// ============================================================================

export const API_V2 = {
  AUTH: {
    ME: "/api/v2/auth/me",
    LOGIN: "/api/v2/auth/login",
    SIGNUP: "/api/v2/auth/signup",
    LOGOUT: "/api/v2/auth/logout",
    UPDATE: "/api/v2/auth/update",
    FORGOT_PASSWORD: "/api/v2/auth/forgot-password",
    RESET_PASSWORD: "/api/v2/auth/reset-password",
    VERIFY_EMAIL: "/api/v2/auth/verify-email",
    RESEND_VERIFICATION: "/api/v2/auth/resend-verification",
    ACCEPT_TOS: "/api/v2/auth/accept-tos",
    ONBOARDING: "/api/v2/auth/onboarding",
    TWO_FA: {
      SETUP: "/api/v2/auth/2fa/setup",
      VERIFY: "/api/v2/auth/2fa/verify",
      DISABLE: "/api/v2/auth/2fa/disable",
      EMAIL_SETUP: "/api/v2/auth/2fa/email-setup",
      EMAIL_SEND: "/api/v2/auth/2fa/email-send",
      BACKUP_CODES: "/api/v2/auth/2fa/backup-codes",
    },
  },
  SCAN: "/api/v2/scan",
  SCAN_BULK: "/api/v2/scan/bulk",
  SCAN_TAGS: "/api/v2/scan/tags",
  SCAN_DISCOVER: "/api/v2/scan/discover",
  SCAN_CRAWL_DISCOVER: "/api/v2/scan/crawl/discover",
  DEMO_SCAN: "/api/v2/demo-scan",
  HISTORY: "/api/v2/history",
  DASHBOARD: "/api/v2/dashboard",
  SHARES: "/api/v2/shares",
  KEYS: "/api/v2/keys",
  WEBHOOKS: "/api/v2/webhooks",
  SCHEDULES: "/api/v2/schedules",
  TEAMS: "/api/v2/teams",
  TEAMS_MEMBERS: "/api/v2/teams/members",
  TEAMS_ACCEPT_INVITE: "/api/v2/teams/accept-invite",
  CONTACT: "/api/v2/contact",
  LANDING_CONTACT: "/api/v2/landing-contact",
  ADMIN: "/api/v2/admin",
  STAFF: "/api/v2/staff",
  BADGE_SCANS: "/api/v2/badge/scans",
  DATA_REQUEST: "/api/v2/data-request",
  ACCOUNT_DELETE: "/api/v2/account/delete",
  ACCOUNT_NOTIFICATIONS: "/api/v2/account/notifications",
  FINDING_TYPES: "/api/v2/finding-types",
} as const;

// ============================================================================
// FEATURE FLAGS (from config-values.ts)
// ============================================================================

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

// ============================================================================
// RE-EXPORT CONFIG FOR CONVENIENCE
// ============================================================================

export { getConfig, CONFIG } from "./config";
