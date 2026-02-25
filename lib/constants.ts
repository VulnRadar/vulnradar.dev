// ============================================================================
// APP CONSTANTS - Centralized configuration for the entire application
// ============================================================================

// Checks count (used in descriptions and UI)
export const TOTAL_CHECKS_LABEL = "175+"

// Application metadata
export const APP_NAME = "VulnRadar"
export const APP_VERSION = "1.9.3"
export const ENGINE_VERSION = "2.0.0"
export const DEFAULT_SCAN_NOTE = `${APP_NAME} v${APP_VERSION} (Detection Engine v${ENGINE_VERSION})`
export const APP_DESCRIPTION = `Scan websites for ${TOTAL_CHECKS_LABEL} security vulnerabilities. Get instant reports with severity ratings, actionable fix guidance, and team collaboration tools.`
export const APP_URL = "https://vulnradar.dev"
export const APP_REPO = "VulnRadar/vulnradar.dev"
export const VERSION_CHECK_URL = `https://api.github.com/repos/${APP_REPO}/releases/latest`
export const RELEASES_URL = `https://github.com/${APP_REPO}/releases`

// Short slug used for filenames and slugs
export const APP_SLUG = "vulnradar"

// ============================================================================
// COOKIE NAMES AND SETTINGS
// ============================================================================

// Version notification
export const VERSION_COOKIE_NAME = "vulnradar_last_seen_version"
export const VERSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

// Authentication
export const AUTH_SESSION_COOKIE_NAME = "vulnradar_session"
export const AUTH_SESSION_MAX_AGE = 60 * 60 * 24 * 7 // 7 days
export const AUTH_CLEANUP_INTERVAL = 24 * 60 * 60 * 1000 // 24 hours
export const AUTH_2FA_PENDING_COOKIE = "vulnradar_2fa_pending"
export const AUTH_2FA_PENDING_MAX_AGE = 300 // 5 minutes

// Device trust
export const DEVICE_TRUST_COOKIE_NAME = "vulnradar_device_trusted"
export const DEVICE_TRUST_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

// ============================================================================
// TIME INTERVALS (in seconds)
// ============================================================================

// Authentication timeouts
export const TOTP_CODE_VALIDITY = 30 // TOTP codes valid for 30 seconds
export const SESSION_TIMEOUT = 60 * 60 * 24 * 7 // 7 days
export const PASSWORD_RESET_TOKEN_LIFETIME = 60 * 60 // 1 hour
export const EMAIL_VERIFICATION_TOKEN_LIFETIME = 60 * 60 * 24 // 24 hours

// Device trust
export const DEVICE_TRUST_DURATION = 60 * 60 * 24 * 30 // 30 days

// Rate limiting
export const RATE_LIMIT_LOGIN_ATTEMPTS = 5
export const RATE_LIMIT_LOGIN_WINDOW = 60 * 15 // 15 minutes
export const RATE_LIMIT_API_WINDOW = 60 * 60 // 1 hour
export const RATE_LIMIT_SIGNUP_ATTEMPTS = 3
export const RATE_LIMIT_SIGNUP_WINDOW = 60 * 60 // 1 hour

// Scanning
export const SCAN_TIMEOUT = 60 * 5 // 5 minutes
export const BULK_SCAN_TIMEOUT = 60 * 30 // 30 minutes

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
  // Authentication
  INVALID_CREDENTIALS: "Invalid email or password",
  EMAIL_NOT_VERIFIED: "Please verify your email before logging in",
  ACCOUNT_DISABLED: "This account has been suspended. Please contact support.",
  SESSION_EXPIRED: "Your session has expired. Please log in again.",
  INVALID_2FA: "Invalid 2FA code. Please try again.",
  INVALID_2FA_SESSION: "Invalid or expired 2FA session. Please log in again.",

  // Validation
  REQUIRED_FIELD: (field: string) => `${field} is required`,
  INVALID_EMAIL: "Invalid email address",
  WEAK_PASSWORD: "Password must be at least 8 characters",
  PASSWORDS_NOT_MATCH: "Passwords do not match",

  // Rate limiting
  TOO_MANY_ATTEMPTS: (resource: string, minutes: number) =>
    `Too many ${resource} attempts. Try again in ${minutes} minute(s).`,

  // Database
  DATABASE_ERROR: "Database error occurred. Please try again.",
  DUPLICATE_EMAIL: "Email already registered",

  // General
  UNAUTHORIZED: "Unauthorized",
  FORBIDDEN: "Forbidden",
  NOT_FOUND: "Not found",
  SERVER_ERROR: "Something went wrong. Please try again.",
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
  PASSWORD: /^.{8,}$/, // At least 8 characters
  BACKUP_CODE: /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/,
  TOTP_CODE: /^\d{6}$/,
}

// ============================================================================
// RATE LIMIT CONFIGS
// ============================================================================

export const RATE_LIMITS = {
  login: {
    maxAttempts: RATE_LIMIT_LOGIN_ATTEMPTS,
    windowSeconds: RATE_LIMIT_LOGIN_WINDOW,
  },
  forgotPassword: {
    maxAttempts: 3,
    windowSeconds: 600, // 10 minutes
  },
  signup: {
    maxAttempts: RATE_LIMIT_SIGNUP_ATTEMPTS,
    windowSeconds: RATE_LIMIT_SIGNUP_WINDOW,
  },
  api: {
    maxAttempts: 100,
    windowSeconds: RATE_LIMIT_API_WINDOW,
  },
  scan: {
    maxAttempts: 100,
    windowSeconds: RATE_LIMIT_API_WINDOW,
  },
  bulkScan: {
    maxAttempts: 10,
    windowSeconds: RATE_LIMIT_API_WINDOW,
  },
}

// ============================================================================
// DATABASE CONSTRAINTS
// ============================================================================

export const DATABASE = {
  MAX_EMAIL_LENGTH: 255,
  MAX_NAME_LENGTH: 255,
  MAX_DESCRIPTION_LENGTH: 1000,
  MAX_TEAM_NAME_LENGTH: 255,
  MAX_TAGS_PER_SCAN: 10,
}

// ============================================================================
// SECURITY SCANNING CONSTRAINTS
// ============================================================================

export const SCANNING = {
  MAX_URL_LENGTH: 2048,
  MAX_URLS_IN_BULK: 100,
  TIMEOUT_SECONDS: SCAN_TIMEOUT,
  BULK_TIMEOUT_SECONDS: BULK_SCAN_TIMEOUT,
  DEFAULT_SEVERITY_THRESHOLD: "low", // "critical" | "high" | "medium" | "low"
}

// ============================================================================
// PAGINATION
// ============================================================================

export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  DEFAULT_PAGE: 1,
}

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

export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "support@vulnradar.dev"
export const LOGO_URL = process.env.LOGO_URL || `${APP_URL}/favicon.png`

export const SMTP_HOST = process.env.SMTP_HOST || ""
export const SMTP_PORT = Number(process.env.SMTP_PORT) || 587
export const SMTP_USER = process.env.SMTP_USER || ""
export const SMTP_PASS = process.env.SMTP_PASS || ""
export const SMTP_FROM = process.env.SMTP_FROM || process.env.SMTP_USER || SMTP_USER

// API key configuration
export const API_KEY_PREFIX = "vr_live_"
export const DEFAULT_API_KEY_DAILY_LIMIT = 50

// Auth / headers
export const AUTH_HEADER = "authorization"
export const BEARER_PREFIX = "Bearer "

// TOTP issuer
export const TOTP_ISSUER = APP_NAME

// ============================================================================
// DEMO SCAN LIMITS
// ============================================================================
export const DEMO_SCAN_LIMIT = 5
export const DEMO_SCAN_WINDOW = 60 * 60 * 12 // 12 hours in seconds

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
// ROLE BADGE STYLES (used across admin, shared, staff pages)
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
// API ENDPOINTS
// ============================================================================

export const API = {
  AUTH: {
    ME: "/api/auth/me",
    LOGIN: "/api/auth/login",
    SIGNUP: "/api/auth/signup",
    LOGOUT: "/api/auth/logout",
    UPDATE: "/api/auth/update",
    FORGOT_PASSWORD: "/api/auth/forgot-password",
    RESET_PASSWORD: "/api/auth/reset-password",
    VERIFY_EMAIL: "/api/auth/verify-email",
    RESEND_VERIFICATION: "/api/auth/resend-verification",
    ACCEPT_TOS: "/api/auth/accept-tos",
    ONBOARDING: "/api/auth/onboarding",
    TWO_FA: {
      SETUP: "/api/auth/2fa/setup",
      VERIFY: "/api/auth/2fa/verify",
      DISABLE: "/api/auth/2fa/disable",
      EMAIL_SETUP: "/api/auth/2fa/email-setup",
      EMAIL_SEND: "/api/auth/2fa/email-send",
      BACKUP_CODES: "/api/auth/2fa/backup-codes",
    },
  },
  SCAN: "/api/scan",
  SCAN_BULK: "/api/scan/bulk",
  SCAN_TAGS: "/api/scan/tags",
  SCAN_DISCOVER: "/api/scan/discover",
  SCAN_CRAWL_DISCOVER: "/api/scan/crawl/discover",
  DEMO_SCAN: "/api/demo-scan",
  HISTORY: "/api/history",
  DASHBOARD: "/api/dashboard",
  SHARES: "/api/shares",
  KEYS: "/api/keys",
  WEBHOOKS: "/api/webhooks",
  SCHEDULES: "/api/schedules",
  TEAMS: "/api/teams",
  TEAMS_MEMBERS: "/api/teams/members",
  TEAMS_ACCEPT_INVITE: "/api/teams/accept-invite",
  CONTACT: "/api/contact",
  LANDING_CONTACT: "/api/landing-contact",
  ADMIN: "/api/admin",
  STAFF: "/api/staff",
  VERSION: "/api/version",
  BADGE_SCANS: "/api/badge/scans",
  DATA_REQUEST: "/api/data-request",
  ACCOUNT_DELETE: "/api/account/delete",
  ACCOUNT_NOTIFICATIONS: "/api/account/notifications",
} as const
