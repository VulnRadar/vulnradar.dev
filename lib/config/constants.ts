// ============================================================================
// APP CONSTANTS - Centralized configuration for the entire application
// ============================================================================
// ALL configuration now comes from config-values.ts which reads from
// build-time injected environment variables (set by next.config.mjs from config.yaml).
// This ensures config works in ALL runtimes: Node.js, Edge (middleware), and browser.
//
// Self-hosters: Edit config.yaml and restart dev server (or rebuild for prod).
// Set environment variables for sensitive values (API keys, database URLs, etc).
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
  CONFIG_API_VERSION,
  CONFIG_DISCORD_INVITE_URL,
  // Branding
  CONFIG_LOGO_URL,
  CONFIG_PRIMARY_COLOR,
  CONFIG_FOOTER_TEXT,
  // Cookies
  CONFIG_COOKIE_SESSION_NAME,
  CONFIG_COOKIE_SESSION_MAX_AGE_DAYS,
  CONFIG_COOKIE_VERSION_NAME,
  CONFIG_COOKIE_VERSION_MAX_AGE_DAYS,
  CONFIG_COOKIE_DEVICE_TRUST_NAME,
  CONFIG_COOKIE_DEVICE_TRUST_MAX_AGE_DAYS,
  CONFIG_COOKIE_2FA_PENDING_NAME,
  CONFIG_COOKIE_2FA_PENDING_MAX_AGE_SECONDS,
  // Auth
  CONFIG_AUTH_SESSION_TIMEOUT_DAYS,
  CONFIG_AUTH_PASSWORD_RESET_HOURS,
  CONFIG_AUTH_EMAIL_VERIFICATION_HOURS,
  CONFIG_AUTH_DEVICE_TRUST_DAYS,
  CONFIG_AUTH_TOTP_VALIDITY_SECONDS,
  CONFIG_AUTH_CLEANUP_INTERVAL_MS,
  // Rate limits
  CONFIG_RATE_LIMIT_LOGIN_MAX,
  CONFIG_RATE_LIMIT_LOGIN_WINDOW,
  CONFIG_RATE_LIMIT_SIGNUP_MAX,
  CONFIG_RATE_LIMIT_SIGNUP_WINDOW,
  CONFIG_RATE_LIMIT_FORGOT_PASSWORD_MAX,
  CONFIG_RATE_LIMIT_FORGOT_PASSWORD_WINDOW,
  CONFIG_RATE_LIMIT_API_MAX,
  CONFIG_RATE_LIMIT_API_WINDOW,
  CONFIG_RATE_LIMIT_SCAN_MAX,
  CONFIG_RATE_LIMIT_SCAN_WINDOW,
  CONFIG_RATE_LIMIT_BULK_SCAN_MAX,
  CONFIG_RATE_LIMIT_BULK_SCAN_WINDOW,
  // Scanning
  CONFIG_SCAN_MAX_URL_LENGTH,
  CONFIG_SCAN_MAX_URLS_BULK,
  CONFIG_SCAN_TIMEOUT_SECONDS,
  CONFIG_SCAN_BULK_TIMEOUT_SECONDS,
  CONFIG_SCAN_DEFAULT_SEVERITY_THRESHOLD,
  // API
  CONFIG_API_KEY_PREFIX,
  CONFIG_API_DEFAULT_DAILY_LIMIT,
  CONFIG_API_CURRENT_VERSION,
  // Demo
  CONFIG_DEMO_SCAN_LIMIT,
  CONFIG_DEMO_WINDOW_HOURS,
  // Database
  CONFIG_DB_MAX_EMAIL_LENGTH,
  CONFIG_DB_MAX_NAME_LENGTH,
  CONFIG_DB_MAX_DESCRIPTION_LENGTH,
  CONFIG_DB_MAX_TEAM_NAME_LENGTH,
  CONFIG_DB_MAX_TAGS_PER_SCAN,
  // Pagination
  CONFIG_PAGINATION_DEFAULT_SIZE,
  CONFIG_PAGINATION_MAX_SIZE,
  CONFIG_PAGINATION_DEFAULT_PAGE,
  // Beta
  CONFIG_BETA_ENABLED,
  CONFIG_BETA_BANNER_MESSAGE,
  // Billing
  CONFIG_BILLING_ENABLED,
  CONFIG_BILLING_FREE_LIMIT,
  CONFIG_BILLING_CORE_LIMIT,
  CONFIG_BILLING_PRO_LIMIT,
  CONFIG_BILLING_ELITE_LIMIT,
  CONFIG_BILLING_FREE_HISTORY,
  CONFIG_BILLING_CORE_HISTORY,
  CONFIG_BILLING_PRO_HISTORY,
  CONFIG_BILLING_ELITE_HISTORY,
  CONFIG_BILLING_UNLIMITED_LIMIT,
} from "./config-values"

// ============================================================================
// APPLICATION METADATA
// ============================================================================

export const APP_NAME = CONFIG_APP_NAME
export const APP_SLUG = CONFIG_APP_SLUG
export const APP_VERSION = CONFIG_APP_VERSION
export const ENGINE_VERSION = CONFIG_ENGINE_VERSION
export const APP_DESCRIPTION = CONFIG_APP_DESCRIPTION
export const TOTAL_CHECKS_LABEL = CONFIG_TOTAL_CHECKS_LABEL
export const APP_URL = CONFIG_APP_URL
export const APP_REPO = CONFIG_APP_REPO
export const TERMS_UPDATED_AT = CONFIG_TERMS_UPDATED_AT
export const DISCORD_INVITE_URL = CONFIG_DISCORD_INVITE_URL

// Scan note with version info
export const DEFAULT_SCAN_NOTE = `${APP_NAME} v${APP_VERSION} (Detection Engine v${ENGINE_VERSION})`

export const VERSION_CHECK_URL = APP_REPO ? `https://api.github.com/repos/${APP_REPO}/releases/latest` : ''
export const RELEASES_URL = APP_REPO ? `https://github.com/${APP_REPO}/releases` : ''

// ============================================================================
// BRANDING
// ============================================================================

// Safe URL construction helper
function safeUrlConstruct(path: string, base: string, fallback: string): string {
  try {
    if (!base || !base.trim()) return fallback
    return new URL(path, base).toString()
  } catch {
    return fallback
  }
}

export const LOGO_URL = process.env.LOGO_URL || safeUrlConstruct(CONFIG_LOGO_URL, APP_URL, "/logo.svg")
export const BRANDING_PRIMARY_COLOR = CONFIG_PRIMARY_COLOR
export const BRANDING_FOOTER_TEXT = CONFIG_FOOTER_TEXT

// ============================================================================
// COOKIE NAMES AND SETTINGS
// ============================================================================

// Version notification
export const VERSION_COOKIE_NAME = CONFIG_COOKIE_VERSION_NAME
export const VERSION_COOKIE_MAX_AGE = 60 * 60 * 24 * CONFIG_COOKIE_VERSION_MAX_AGE_DAYS

// Authentication
export const AUTH_SESSION_COOKIE_NAME = CONFIG_COOKIE_SESSION_NAME
export const AUTH_SESSION_MAX_AGE = 60 * 60 * 24 * CONFIG_COOKIE_SESSION_MAX_AGE_DAYS
export const AUTH_CLEANUP_INTERVAL = CONFIG_AUTH_CLEANUP_INTERVAL_MS
export const AUTH_2FA_PENDING_COOKIE = CONFIG_COOKIE_2FA_PENDING_NAME
export const AUTH_2FA_PENDING_MAX_AGE = CONFIG_COOKIE_2FA_PENDING_MAX_AGE_SECONDS

// Device trust
export const DEVICE_TRUST_COOKIE_NAME = CONFIG_COOKIE_DEVICE_TRUST_NAME
export const DEVICE_TRUST_MAX_AGE = 60 * 60 * 24 * CONFIG_COOKIE_DEVICE_TRUST_MAX_AGE_DAYS

// ============================================================================
// TIME INTERVALS
// ============================================================================

// Authentication timeouts
export const TOTP_CODE_VALIDITY = CONFIG_AUTH_TOTP_VALIDITY_SECONDS
export const SESSION_TIMEOUT = 60 * 60 * 24 * CONFIG_AUTH_SESSION_TIMEOUT_DAYS
export const PASSWORD_RESET_TOKEN_LIFETIME = 60 * 60 * CONFIG_AUTH_PASSWORD_RESET_HOURS
export const EMAIL_VERIFICATION_TOKEN_LIFETIME = 60 * 60 * CONFIG_AUTH_EMAIL_VERIFICATION_HOURS

// Device trust
export const DEVICE_TRUST_DURATION = 60 * 60 * 24 * CONFIG_AUTH_DEVICE_TRUST_DAYS

// Rate limiting
export const RATE_LIMIT_LOGIN_ATTEMPTS = CONFIG_RATE_LIMIT_LOGIN_MAX
export const RATE_LIMIT_LOGIN_WINDOW = 60 * CONFIG_RATE_LIMIT_LOGIN_WINDOW
export const RATE_LIMIT_API_WINDOW = 60 * CONFIG_RATE_LIMIT_API_WINDOW
export const RATE_LIMIT_SIGNUP_ATTEMPTS = CONFIG_RATE_LIMIT_SIGNUP_MAX
export const RATE_LIMIT_SIGNUP_WINDOW = 60 * CONFIG_RATE_LIMIT_SIGNUP_WINDOW

// Scanning
export const SCAN_TIMEOUT = CONFIG_SCAN_TIMEOUT_SECONDS
export const BULK_SCAN_TIMEOUT = CONFIG_SCAN_BULK_TIMEOUT_SECONDS

// ============================================================================
// HTTP HEADERS
// ============================================================================

export const COMMON_HEADERS = {
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
}

// ============================================================================
// ERROR MESSAGES
// ============================================================================

export const ERROR_MESSAGES = {
  INVALID_CREDENTIALS: "The email or password you entered is incorrect. Please try again.",
  EMAIL_NOT_VERIFIED: "Please verify your email address before signing in.",
  ACCOUNT_DISABLED: "Your account has been suspended. Please contact support for assistance.",
  SESSION_EXPIRED: "Your session has expired. Please sign in again to continue.",
  INVALID_2FA: "The verification code you entered is invalid. Please try again.",
  INVALID_2FA_SESSION: "Your verification session has expired. Please sign in again.",
  REQUIRED_FIELD: (field: string) => `${field} is required.`,
  INVALID_EMAIL: "Please enter a valid email address.",
  WEAK_PASSWORD: "Password must be at least 8 characters long.",
  PASSWORDS_NOT_MATCH: "The passwords you entered do not match.",
  TOO_MANY_ATTEMPTS: (resource: string, minutes: number) =>
    `Too many ${resource} attempts. Please wait ${minutes} minute${minutes > 1 ? 's' : ''} before trying again.`,
  DATABASE_ERROR: "A temporary error occurred. Please try again in a moment.",
  DUPLICATE_EMAIL: "An account with this email address already exists.",
  UNAUTHORIZED: "Authentication required. Please sign in to access this resource.",
  FORBIDDEN: "You do not have permission to access this resource.",
  NOT_FOUND: "The requested resource could not be found.",
  SERVER_ERROR: "An unexpected error occurred. Please try again later.",
  INVALID_API_KEY: "The API key provided is invalid or has been revoked.",
  API_KEY_REQUIRED: "An API key is required to access this endpoint.",
  RATE_LIMIT_EXCEEDED: "Rate limit exceeded. Please slow down your requests.",
  INVALID_REQUEST: "The request could not be processed. Please check your input.",
  METHOD_NOT_ALLOWED: "This HTTP method is not supported for this endpoint.",
}

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
}

// ============================================================================
// REGEX PATTERNS
// ============================================================================

export const PATTERNS = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  URL: /^https?:\/\/.+/i,
  DOMAIN: /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i,
  PASSWORD: /^.{8,}$/,
  BACKUP_CODE: /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/,
  TOTP_CODE: /^\d{6}$/,
}

// ============================================================================
// RATE LIMIT CONFIGS
// ============================================================================

export const RATE_LIMITS = {
  login: {
    maxAttempts: CONFIG_RATE_LIMIT_LOGIN_MAX,
    windowSeconds: 60 * CONFIG_RATE_LIMIT_LOGIN_WINDOW,
  },
  forgotPassword: {
    maxAttempts: CONFIG_RATE_LIMIT_FORGOT_PASSWORD_MAX,
    windowSeconds: 60 * CONFIG_RATE_LIMIT_FORGOT_PASSWORD_WINDOW,
  },
  signup: {
    maxAttempts: CONFIG_RATE_LIMIT_SIGNUP_MAX,
    windowSeconds: 60 * CONFIG_RATE_LIMIT_SIGNUP_WINDOW,
  },
  api: {
    maxAttempts: CONFIG_RATE_LIMIT_API_MAX,
    windowSeconds: 60 * CONFIG_RATE_LIMIT_API_WINDOW,
  },
  scan: {
    maxAttempts: CONFIG_RATE_LIMIT_SCAN_MAX,
    windowSeconds: 60 * CONFIG_RATE_LIMIT_SCAN_WINDOW,
  },
  bulkScan: {
    maxAttempts: CONFIG_RATE_LIMIT_BULK_SCAN_MAX,
    windowSeconds: 60 * CONFIG_RATE_LIMIT_BULK_SCAN_WINDOW,
  },
}

// ============================================================================
// DATABASE CONSTRAINTS
// ============================================================================

export const DATABASE = {
  MAX_EMAIL_LENGTH: CONFIG_DB_MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH: CONFIG_DB_MAX_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH: CONFIG_DB_MAX_DESCRIPTION_LENGTH,
  MAX_TEAM_NAME_LENGTH: CONFIG_DB_MAX_TEAM_NAME_LENGTH,
  MAX_TAGS_PER_SCAN: CONFIG_DB_MAX_TAGS_PER_SCAN,
}

// ============================================================================
// SECURITY SCANNING CONSTRAINTS
// ============================================================================

export const SCANNING = {
  MAX_URL_LENGTH: CONFIG_SCAN_MAX_URL_LENGTH,
  MAX_URLS_IN_BULK: CONFIG_SCAN_MAX_URLS_BULK,
  TIMEOUT_SECONDS: CONFIG_SCAN_TIMEOUT_SECONDS,
  BULK_TIMEOUT_SECONDS: CONFIG_SCAN_BULK_TIMEOUT_SECONDS,
  DEFAULT_SEVERITY_THRESHOLD: CONFIG_SCAN_DEFAULT_SEVERITY_THRESHOLD,
}

// ============================================================================
// PAGINATION
// ============================================================================

export const PAGINATION = {
  DEFAULT_PAGE_SIZE: CONFIG_PAGINATION_DEFAULT_SIZE,
  MAX_PAGE_SIZE: CONFIG_PAGINATION_MAX_SIZE,
  DEFAULT_PAGE: CONFIG_PAGINATION_DEFAULT_PAGE,
}

// ============================================================================
// BILLING / PREMIUM
// ============================================================================

export const BILLING_ENABLED = CONFIG_BILLING_ENABLED
export const BILLING_PLAN_LIMITS = {
  free: CONFIG_BILLING_FREE_LIMIT,
  core_supporter: CONFIG_BILLING_CORE_LIMIT,
  pro_supporter: CONFIG_BILLING_PRO_LIMIT,
  elite_supporter: CONFIG_BILLING_ELITE_LIMIT,
}
export const BILLING_HISTORY_RETENTION = {
  free: CONFIG_BILLING_FREE_HISTORY,
  core_supporter: CONFIG_BILLING_CORE_HISTORY,
  pro_supporter: CONFIG_BILLING_PRO_HISTORY,
  elite_supporter: CONFIG_BILLING_ELITE_HISTORY,
}
export const BILLING_UNLIMITED_MODE_LIMIT = CONFIG_BILLING_UNLIMITED_LIMIT

// ============================================================================
// TEAM ROLES
// ============================================================================

export const TEAM_ROLES = {
  OWNER: "owner",
  ADMIN: "admin",
  MEMBER: "member",
  VIEWER: "viewer",
}

export const TEAM_ROLE_PERMISSIONS = {
  [TEAM_ROLES.OWNER]: ["manage_team", "manage_members", "manage_scans", "view_reports"],
  [TEAM_ROLES.ADMIN]: ["manage_members", "manage_scans", "view_reports"],
  [TEAM_ROLES.MEMBER]: ["manage_scans", "view_reports"],
  [TEAM_ROLES.VIEWER]: ["view_reports"],
}

// ============================================================================
// VULNERABILITY SEVERITY LEVELS
// ============================================================================

export const SEVERITY_LEVELS = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  INFO: "info",
} as const

export const SEVERITY_PRIORITY = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
}

// ============================================================================
// EMAIL / SMTP CONFIG
// ============================================================================

export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || CONFIG_SUPPORT_EMAIL
export const LEGAL_EMAIL = CONFIG_LEGAL_EMAIL
export const SECURITY_EMAIL = CONFIG_SECURITY_EMAIL
export const ENTERPRISE_EMAIL = CONFIG_ENTERPRISE_EMAIL
export const NOREPLY_EMAIL = CONFIG_NOREPLY_EMAIL

export const SMTP_HOST = process.env.SMTP_HOST || ""
export const SMTP_PORT = Number(process.env.SMTP_PORT) || 587
export const SMTP_USER = process.env.SMTP_USER || ""
export const SMTP_PASS = process.env.SMTP_PASS || ""
export const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER

// ============================================================================
// API KEY CONFIGURATION
// ============================================================================

export const API_KEY_PREFIX = CONFIG_API_KEY_PREFIX
export const DEFAULT_API_KEY_DAILY_LIMIT = CONFIG_API_DEFAULT_DAILY_LIMIT
export const API_CURRENT_VERSION = CONFIG_API_CURRENT_VERSION

// Auth / headers
export const AUTH_HEADER = "authorization"
export const BEARER_PREFIX = "Bearer "

// TOTP issuer
export const TOTP_ISSUER = APP_NAME

// ============================================================================
// BETA MODE CONFIGURATION
// ============================================================================

export const BETA_MODE = CONFIG_BETA_ENABLED
export const BETA_BANNER_MESSAGE = CONFIG_BETA_BANNER_MESSAGE

// ============================================================================
// TURNSTILE / CAPTCHA CONFIG
// ============================================================================

export const TURNSTILE_ENABLED = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

// ============================================================================
// DEMO SCAN LIMITS
// ============================================================================

export const DEMO_SCAN_LIMIT = CONFIG_DEMO_SCAN_LIMIT
export const DEMO_SCAN_WINDOW = 60 * 60 * CONFIG_DEMO_WINDOW_HOURS

// ============================================================================
// STAFF / ADMIN ROLES
// ============================================================================

export const STAFF_ROLES = {
  USER: "user",
  BETA_TESTER: "beta_tester",
  SUPPORT: "support",
  MODERATOR: "moderator",
  ADMIN: "admin",
} as const

export type StaffRole = (typeof STAFF_ROLES)[keyof typeof STAFF_ROLES]

export const STAFF_ROLE_HIERARCHY: Record<string, number> = {
  user: 0,
  beta_tester: 0,
  support: 1,
  moderator: 2,
  admin: 3,
}

export const STAFF_ROLE_LABELS: Record<string, string> = {
  user: "User",
  beta_tester: "Beta Tester",
  support: "Support",
  moderator: "Moderator",
  admin: "Admin",
}

// ============================================================================
// ROLE BADGE STYLES
// ============================================================================

export const ROLE_BADGE_STYLES: Record<string, string> = {
  admin: "bg-primary/10 text-primary border-primary/20",
  moderator: "bg-[hsl(var(--severity-medium))]/10 text-[hsl(var(--severity-medium))] border-[hsl(var(--severity-medium))]/20",
  support: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  beta_tester: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  user: "bg-muted text-muted-foreground border-border",
}

// ============================================================================
// APPLICATION ROUTES
// ============================================================================

export const ROUTES = {
  HOME: "/",
  LOGIN: "/login",
  SIGNUP: "/signup",
  FORGOT_PASSWORD: "/forgot-password",
  RESET_PASSWORD: "/reset-password",
  VERIFY_EMAIL: "/verify-email",
  DASHBOARD: "/dashboard",
  HISTORY: "/history",
  COMPARE: "/compare",
  BADGE: "/badge",
  SHARES: "/shares",
  PROFILE: "/profile",
  ADMIN: "/admin",
  TEAMS: "/teams",
  TEAMS_JOIN: "/teams/join",
  CONTACT: "/contact",
  CHANGELOG: "/changelog",
  DEMO: "/demo",
  STAFF: "/staff",
  DONATE: "/donate",
  PRICING: "/pricing",
  DOCS: "/docs",
  DOCS_API: "/docs/api",
  DOCS_SETUP: "/docs/setup",
  LANDING: "/landing",
  LEGAL_TERMS: "/legal/terms",
  LEGAL_PRIVACY: "/legal/privacy",
  LEGAL_DISCLAIMER: "/legal/disclaimer",
  LEGAL_ACCEPTABLE_USE: "/legal/acceptable-use",
  GDPR_REQUEST: "/legal/privacy#gdpr",
} as const

// ============================================================================
// API VERSION CONSTANT
// ============================================================================

export const API_VERSION = CONFIG_API_VERSION

// ============================================================================
// API ENDPOINTS (dynamically versioned)
// ============================================================================

export const API = {
  ME: `/api/${API_VERSION}/auth/me`,
  AUTH: {
    ME: `/api/${API_VERSION}/auth/me`,
    LOGIN: `/api/${API_VERSION}/auth/login`,
    SIGNUP: `/api/${API_VERSION}/auth/signup`,
    LOGOUT: `/api/${API_VERSION}/auth/logout`,
    FORGOT_PASSWORD: `/api/${API_VERSION}/auth/forgot-password`,
    RESET_PASSWORD: `/api/${API_VERSION}/auth/reset-password`,
    VERIFY_EMAIL: `/api/${API_VERSION}/auth/verify-email`,
    RESEND_VERIFICATION: `/api/${API_VERSION}/auth/resend-verification`,
    CHANGE_EMAIL: `/api/${API_VERSION}/auth/change-email`,
    VERIFY_EMAIL_CHANGE: `/api/${API_VERSION}/auth/verify-email-change`,
    TWO_FA: {
      STATUS: `/api/${API_VERSION}/auth/2fa/status`,
      SETUP: `/api/${API_VERSION}/auth/2fa/setup`,
      ENABLE: `/api/${API_VERSION}/auth/2fa/enable`,
      DISABLE: `/api/${API_VERSION}/auth/2fa/disable`,
      VERIFY: `/api/${API_VERSION}/auth/2fa/verify`,
      RECOVERY: `/api/${API_VERSION}/auth/2fa/recovery`,
    },
    UPDATE_PASSWORD: `/api/${API_VERSION}/auth/update-password`,
    DELETE_ACCOUNT: `/api/${API_VERSION}/auth/delete-account`,
  },
  USER: {
    PROFILE: `/api/${API_VERSION}/user/profile`,
    APPEARANCE: `/api/${API_VERSION}/user/appearance`,
    NOTIFICATIONS: `/api/${API_VERSION}/user/notifications`,
    ACTIVITY_LOG: `/api/${API_VERSION}/user/activity-log`,
    EXPORT: `/api/${API_VERSION}/user/export`,
    SESSIONS: `/api/${API_VERSION}/user/sessions`,
  },
  SCAN: {
    BASE: `/api/${API_VERSION}/scan`,
    HISTORY: `/api/${API_VERSION}/scan/history`,
    EXPORT: `/api/${API_VERSION}/scan/export`,
    COMPARE: `/api/${API_VERSION}/scan/compare`,
    SCHEDULED: `/api/${API_VERSION}/scan/scheduled`,
    BULK: `/api/${API_VERSION}/scan/bulk`,
    DEMO: `/api/${API_VERSION}/scan/demo`,
    TAGS: `/api/${API_VERSION}/scan/tags`,
    NOTES: `/api/${API_VERSION}/scan/notes`,
    SHARE: `/api/${API_VERSION}/scan/share`,
    WEBHOOK_TEST: `/api/${API_VERSION}/scan/webhook-test`,
    RESCAN: `/api/${API_VERSION}/scan/rescan`,
    BADGE: `/api/${API_VERSION}/scan/badge`,
    BADGE_IMAGE: `/api/${API_VERSION}/scan/badge/image`,
    DELETE: `/api/${API_VERSION}/scan/delete`,
    REPORT: `/api/${API_VERSION}/scan/report`,
  },
  TEAMS: {
    BASE: `/api/${API_VERSION}/teams`,
    LIST: `/api/${API_VERSION}/teams/list`,
    CREATE: `/api/${API_VERSION}/teams/create`,
    JOIN: `/api/${API_VERSION}/teams/join`,
    LEAVE: `/api/${API_VERSION}/teams/leave`,
    UPDATE: `/api/${API_VERSION}/teams/update`,
    DELETE: `/api/${API_VERSION}/teams/delete`,
    MEMBERS: `/api/${API_VERSION}/teams/members`,
    INVITE: `/api/${API_VERSION}/teams/invite`,
    REVOKE_INVITE: `/api/${API_VERSION}/teams/revoke-invite`,
    REMOVE_MEMBER: `/api/${API_VERSION}/teams/remove-member`,
    UPDATE_ROLE: `/api/${API_VERSION}/teams/update-role`,
    TRANSFER_OWNERSHIP: `/api/${API_VERSION}/teams/transfer-ownership`,
  },
  INTEGRATIONS: {
    WEBHOOKS: `/api/${API_VERSION}/integrations/webhooks`,
    API_KEYS: `/api/${API_VERSION}/integrations/api-keys`,
    DISCORD: `/api/${API_VERSION}/integrations/discord`,
  },
  ADMIN: {
    USERS: `/api/${API_VERSION}/admin/users`,
    SCANS: `/api/${API_VERSION}/admin/scans`,
    STATS: `/api/${API_VERSION}/admin/stats`,
    CONFIG: `/api/${API_VERSION}/admin/config`,
    AUDIT_LOG: `/api/${API_VERSION}/admin/audit-log`,
    API_LOGS: `/api/${API_VERSION}/admin/api-logs`,
    ANNOUNCEMENTS: `/api/${API_VERSION}/admin/announcements`,
  },
  STAFF: {
    USERS: `/api/${API_VERSION}/staff/users`,
    LOOKUP: `/api/${API_VERSION}/staff/lookup`,
    BAN: `/api/${API_VERSION}/staff/ban`,
    UNBAN: `/api/${API_VERSION}/staff/unban`,
  },
  CONTACT: `/api/${API_VERSION}/contact`,
  CHANGELOG: `/api/${API_VERSION}/changelog`,
  VERSION_CHECK: `/api/${API_VERSION}/version-check`,
  PUBLIC: {
    SHARED_SCAN: `/api/${API_VERSION}/public/scan`,
  },
  BILLING: {
    CHECKOUT: `/api/${API_VERSION}/billing/checkout`,
    PORTAL: `/api/${API_VERSION}/billing/portal`,
    STATUS: `/api/${API_VERSION}/billing/status`,
    SUBSCRIBE: `/api/${API_VERSION}/billing/subscribe`,
    CANCEL: `/api/${API_VERSION}/billing/cancel`,
    WEBHOOK: `/api/${API_VERSION}/billing/webhook`,
    PLANS: `/api/${API_VERSION}/billing/plans`,
  },
  LEGAL: {
    ACCEPT_TERMS: `/api/${API_VERSION}/legal/accept-terms`,
    TERMS_STATUS: `/api/${API_VERSION}/legal/terms-status`,
  },
} as const

// Alias for v2 API (for backwards compatibility with code that expects API_V2)
export const API_V2 = API

