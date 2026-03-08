// ============================================================================
// APP CONSTANTS - Centralized configuration for the entire application
// ============================================================================
// This file reads from config.yaml via the config system.
// Self-hosters: Modify config.yaml to customize your deployment.
// ============================================================================

import { getConfig } from "./config"

// Get config (loads from config.yaml or uses defaults)
const config = getConfig()

// ============================================================================
// APPLICATION METADATA (from config.yaml)
// ============================================================================

export const APP_NAME = config.app.name
export const APP_SLUG = config.app.slug
export const APP_VERSION = config.app.version
export const ENGINE_VERSION = config.app.engine_version
export const APP_DESCRIPTION = config.app.description
export const TOTAL_CHECKS_LABEL = config.app.total_checks_label
export const APP_URL = config.app.url
export const APP_REPO = config.app.repo

// Derived values
export const DEFAULT_SCAN_NOTE = `${APP_NAME} v${APP_VERSION} (Detection Engine v${ENGINE_VERSION})`
export const VERSION_CHECK_URL = `https://api.github.com/repos/${APP_REPO}/releases/latest`
export const RELEASES_URL = `https://github.com/${APP_REPO}/releases`

// ============================================================================
// BRANDING (from config.yaml)
// ============================================================================

export const LOGO_URL = process.env.LOGO_URL || `${APP_URL}${config.branding.logo_url}`
export const BRANDING_PRIMARY_COLOR = config.branding.primary_color
export const BRANDING_FOOTER_TEXT = config.branding.footer_text

// ============================================================================
// COOKIE NAMES AND SETTINGS (from config.yaml)
// ============================================================================

// Version notification
export const VERSION_COOKIE_NAME = config.cookies.version.name
export const VERSION_COOKIE_MAX_AGE = 60 * 60 * 24 * config.cookies.version.max_age_days

// Authentication
export const AUTH_SESSION_COOKIE_NAME = config.cookies.session.name
export const AUTH_SESSION_MAX_AGE = 60 * 60 * 24 * config.cookies.session.max_age_days
export const AUTH_CLEANUP_INTERVAL = config.auth.cleanup_interval_ms
export const AUTH_2FA_PENDING_COOKIE = config.cookies.two_fa_pending.name
export const AUTH_2FA_PENDING_MAX_AGE = config.cookies.two_fa_pending.max_age_seconds

// Device trust
export const DEVICE_TRUST_COOKIE_NAME = config.cookies.device_trust.name
export const DEVICE_TRUST_MAX_AGE = 60 * 60 * 24 * config.cookies.device_trust.max_age_days

// ============================================================================
// TIME INTERVALS (from config.yaml)
// ============================================================================

// Authentication timeouts
export const TOTP_CODE_VALIDITY = config.auth.totp_validity_seconds
export const SESSION_TIMEOUT = 60 * 60 * 24 * config.auth.session_timeout_days
export const PASSWORD_RESET_TOKEN_LIFETIME = 60 * 60 * config.auth.password_reset_hours
export const EMAIL_VERIFICATION_TOKEN_LIFETIME = 60 * 60 * config.auth.email_verification_hours

// Device trust
export const DEVICE_TRUST_DURATION = 60 * 60 * 24 * config.auth.device_trust_days

// Rate limiting
export const RATE_LIMIT_LOGIN_ATTEMPTS = config.rate_limits.login.max_attempts || 5
export const RATE_LIMIT_LOGIN_WINDOW = 60 * config.rate_limits.login.window_minutes
export const RATE_LIMIT_API_WINDOW = 60 * config.rate_limits.api.window_minutes
export const RATE_LIMIT_SIGNUP_ATTEMPTS = config.rate_limits.signup.max_attempts || 3
export const RATE_LIMIT_SIGNUP_WINDOW = 60 * config.rate_limits.signup.window_minutes

// Scanning
export const SCAN_TIMEOUT = config.scanning.timeout_seconds
export const BULK_SCAN_TIMEOUT = config.scanning.bulk_timeout_seconds

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
// RATE LIMIT CONFIGS (from config.yaml)
// ============================================================================

export const RATE_LIMITS = {
  login: {
    maxAttempts: config.rate_limits.login.max_attempts || 5,
    windowSeconds: 60 * config.rate_limits.login.window_minutes,
  },
  forgotPassword: {
    maxAttempts: config.rate_limits.forgot_password.max_attempts || 3,
    windowSeconds: 60 * config.rate_limits.forgot_password.window_minutes,
  },
  signup: {
    maxAttempts: config.rate_limits.signup.max_attempts || 3,
    windowSeconds: 60 * config.rate_limits.signup.window_minutes,
  },
  api: {
    maxAttempts: config.rate_limits.api.max_requests || 100,
    windowSeconds: 60 * config.rate_limits.api.window_minutes,
  },
  scan: {
    maxAttempts: config.rate_limits.scan.max_requests || 100,
    windowSeconds: 60 * config.rate_limits.scan.window_minutes,
  },
  bulkScan: {
    maxAttempts: config.rate_limits.bulk_scan.max_requests || 10,
    windowSeconds: 60 * config.rate_limits.bulk_scan.window_minutes,
  },
}

// ============================================================================
// DATABASE CONSTRAINTS (from config.yaml)
// ============================================================================

export const DATABASE = {
  MAX_EMAIL_LENGTH: config.database.max_email_length,
  MAX_NAME_LENGTH: config.database.max_name_length,
  MAX_DESCRIPTION_LENGTH: config.database.max_description_length,
  MAX_TEAM_NAME_LENGTH: config.database.max_team_name_length,
  MAX_TAGS_PER_SCAN: config.database.max_tags_per_scan,
}

// ============================================================================
// SECURITY SCANNING CONSTRAINTS (from config.yaml)
// ============================================================================

export const SCANNING = {
  MAX_URL_LENGTH: config.scanning.max_url_length,
  MAX_URLS_IN_BULK: config.scanning.max_urls_bulk,
  TIMEOUT_SECONDS: config.scanning.timeout_seconds,
  BULK_TIMEOUT_SECONDS: config.scanning.bulk_timeout_seconds,
  DEFAULT_SEVERITY_THRESHOLD: config.scanning.default_severity_threshold,
}

// ============================================================================
// PAGINATION (from config.yaml)
// ============================================================================

export const PAGINATION = {
  DEFAULT_PAGE_SIZE: config.pagination.default_page_size,
  MAX_PAGE_SIZE: config.pagination.max_page_size,
  DEFAULT_PAGE: config.pagination.default_page,
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
// EMAIL / SMTP CONFIG (from config.yaml + env vars)
// ============================================================================

export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || config.app.support_email

export const SMTP_HOST = process.env.SMTP_HOST || ""
export const SMTP_PORT = Number(process.env.SMTP_PORT) || 587
export const SMTP_USER = process.env.SMTP_USER || ""
export const SMTP_PASS = process.env.SMTP_PASS || ""
export const SMTP_FROM = process.env.SMTP_FROM || process.env.SMTP_USER || SMTP_USER

// ============================================================================
// API KEY CONFIGURATION (from config.yaml)
// ============================================================================

export const API_KEY_PREFIX = config.api.key_prefix
export const DEFAULT_API_KEY_DAILY_LIMIT = config.api.default_daily_limit
export const API_CURRENT_VERSION = config.api.current_version

// Auth / headers
export const AUTH_HEADER = "authorization"
export const BEARER_PREFIX = "Bearer "

// TOTP issuer
export const TOTP_ISSUER = APP_NAME

// ============================================================================
// BETA MODE CONFIGURATION (from config.yaml)
// ============================================================================

export const BETA_MODE = config.beta.enabled
export const BETA_BANNER_MESSAGE = config.beta.banner_message

// ============================================================================
// TURNSTILE / CAPTCHA CONFIG
// ============================================================================

export const TURNSTILE_ENABLED = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY

// ============================================================================
// DEMO SCAN LIMITS (from config.yaml)
// ============================================================================
export const DEMO_SCAN_LIMIT = config.demo.scan_limit
export const DEMO_SCAN_WINDOW = 60 * 60 * config.demo.window_hours

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
    ME: "/api/v1/auth/me",
    LOGIN: "/api/v1/auth/login",
    SIGNUP: "/api/v1/auth/signup",
    LOGOUT: "/api/v1/auth/logout",
    UPDATE: "/api/v1/auth/update",
    FORGOT_PASSWORD: "/api/v1/auth/forgot-password",
    RESET_PASSWORD: "/api/v1/auth/reset-password",
    VERIFY_EMAIL: "/api/v1/auth/verify-email",
    RESEND_VERIFICATION: "/api/v1/auth/resend-verification",
    ACCEPT_TOS: "/api/v1/auth/accept-tos",
    ONBOARDING: "/api/v1/auth/onboarding",
    TWO_FA: {
      SETUP: "/api/v1/auth/2fa/setup",
      VERIFY: "/api/v1/auth/2fa/verify",
      DISABLE: "/api/v1/auth/2fa/disable",
      EMAIL_SETUP: "/api/v1/auth/2fa/email-setup",
      EMAIL_SEND: "/api/v1/auth/2fa/email-send",
      BACKUP_CODES: "/api/v1/auth/2fa/backup-codes",
    },
  },
  SCAN: "/api/v1/scan",
  SCAN_BULK: "/api/v1/scan/bulk",
  SCAN_TAGS: "/api/v1/scan/tags",
  SCAN_DISCOVER: "/api/v1/scan/discover",
  SCAN_CRAWL_DISCOVER: "/api/v1/scan/crawl/discover",
  DEMO_SCAN: "/api/v1/demo-scan",
  HISTORY: "/api/v1/history",
  DASHBOARD: "/api/v1/dashboard",
  SHARES: "/api/v1/shares",
  KEYS: "/api/v1/keys",
  WEBHOOKS: "/api/v1/webhooks",
  SCHEDULES: "/api/v1/schedules",
  TEAMS: "/api/v1/teams",
  TEAMS_MEMBERS: "/api/v1/teams/members",
  TEAMS_ACCEPT_INVITE: "/api/v1/teams/accept-invite",
  CONTACT: "/api/v1/contact",
  LANDING_CONTACT: "/api/v1/landing-contact",
  ADMIN: "/api/v1/admin",
  STAFF: "/api/v1/staff",
  VERSION: "/api/version",
  BADGE_SCANS: "/api/v1/badge/scans",
  DATA_REQUEST: "/api/v1/data-request",
  ACCOUNT_DELETE: "/api/v1/account/delete",
  ACCOUNT_NOTIFICATIONS: "/api/v1/account/notifications",
  FINDING_TYPES: "/api/v1/finding-types",
} as const

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
} as const

// ============================================================================
// FEATURE FLAGS (from config.yaml)
// ============================================================================

export const FEATURES = {
  DEMO_MODE: config.features.demo_mode,
  TEAMS: config.features.teams,
  API_KEYS: config.features.api_keys,
  WEBHOOKS: config.features.webhooks,
  SCHEDULED_SCANS: config.features.scheduled_scans,
  BULK_SCANS: config.features.bulk_scans,
  PDF_REPORTS: config.features.pdf_reports,
  EMAIL_NOTIFICATIONS: config.features.email_notifications,
} as const

// ============================================================================
// RE-EXPORT CONFIG FOR CONVENIENCE
// ============================================================================

export { getConfig, CONFIG } from "./config"
