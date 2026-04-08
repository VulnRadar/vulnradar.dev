// ============================================================================
// CONFIG VALUES - Build-time injected from config.yaml via next.config.mjs
// ============================================================================
// All config values are loaded from config.yaml at BUILD TIME in next.config.mjs
// and injected as NEXT_PUBLIC_CONFIG_* environment variables.
// This ensures values work in ALL runtimes: Node.js, Edge (middleware), and browser.
// 
// Self-hosters: Edit config.yaml and restart dev server (or rebuild for prod).
// Values are baked in at build time - this is a Next.js requirement for Edge Runtime.
// ============================================================================

// Helper to get env var with optional numeric parsing
const getEnv = (key: string): string => process.env[key] || ''
const getEnvNum = (key: string, defaultVal: number): number => {
  const val = process.env[key]
  if (!val) return defaultVal
  const num = Number(val)
  return isNaN(num) ? defaultVal : num
}
const getEnvBool = (key: string, defaultVal: boolean): boolean => {
  const val = process.env[key]
  if (!val) return defaultVal
  return val === 'true' || val === '1'
}

// ============================================================================
// APP METADATA
// ============================================================================
export const CONFIG_APP_NAME = getEnv('NEXT_PUBLIC_CONFIG_APP_NAME') || 'VulnRadar'
export const CONFIG_APP_SLUG = getEnv('NEXT_PUBLIC_CONFIG_APP_SLUG') || 'vulnradar'
export const CONFIG_APP_VERSION = getEnv('NEXT_PUBLIC_CONFIG_APP_VERSION') || '0.0.0'
export const CONFIG_ENGINE_VERSION = getEnv('NEXT_PUBLIC_CONFIG_ENGINE_VERSION') || '0.0.0'
export const CONFIG_API_VERSION = getEnv('NEXT_PUBLIC_CONFIG_API_VERSION') || 'v2'
export const CONFIG_APP_DESCRIPTION = getEnv('NEXT_PUBLIC_CONFIG_APP_DESCRIPTION')
export const CONFIG_TOTAL_CHECKS_LABEL = getEnv('NEXT_PUBLIC_CONFIG_TOTAL_CHECKS_LABEL') || '300+'
export const CONFIG_APP_URL = getEnv('NEXT_PUBLIC_CONFIG_APP_URL') || 'http://localhost:3000'
export const CONFIG_APP_REPO = getEnv('NEXT_PUBLIC_CONFIG_APP_REPO')
export const CONFIG_DISCORD_INVITE_URL = getEnv('NEXT_PUBLIC_CONFIG_DISCORD_INVITE_URL')
export const CONFIG_TERMS_UPDATED_AT = getEnv('NEXT_PUBLIC_CONFIG_TERMS_UPDATED_AT')

// ============================================================================
// EMAILS
// ============================================================================
export const CONFIG_SUPPORT_EMAIL = getEnv('NEXT_PUBLIC_CONFIG_SUPPORT_EMAIL')
export const CONFIG_LEGAL_EMAIL = getEnv('NEXT_PUBLIC_CONFIG_LEGAL_EMAIL')
export const CONFIG_SECURITY_EMAIL = getEnv('NEXT_PUBLIC_CONFIG_SECURITY_EMAIL')
export const CONFIG_ENTERPRISE_EMAIL = getEnv('NEXT_PUBLIC_CONFIG_ENTERPRISE_EMAIL')
export const CONFIG_NOREPLY_EMAIL = getEnv('NEXT_PUBLIC_CONFIG_NOREPLY_EMAIL')

// ============================================================================
// BRANDING
// ============================================================================
export const CONFIG_LOGO_URL = getEnv('NEXT_PUBLIC_CONFIG_LOGO_URL') || '/favicon-dark.svg'
export const CONFIG_PRIMARY_COLOR = getEnv('NEXT_PUBLIC_CONFIG_PRIMARY_COLOR') || '#6366f1'
export const CONFIG_FOOTER_TEXT = getEnv('NEXT_PUBLIC_CONFIG_FOOTER_TEXT') || 'VulnRadar'

// ============================================================================
// COOKIES
// ============================================================================
export const CONFIG_COOKIE_SESSION_NAME = getEnv('NEXT_PUBLIC_CONFIG_COOKIE_SESSION_NAME') || 'vulnradar_session'
export const CONFIG_COOKIE_SESSION_MAX_AGE_DAYS = getEnvNum('NEXT_PUBLIC_CONFIG_COOKIE_SESSION_MAX_AGE_DAYS', 7)
export const CONFIG_COOKIE_VERSION_NAME = getEnv('NEXT_PUBLIC_CONFIG_COOKIE_VERSION_NAME') || 'vulnradar_last_seen_version'
export const CONFIG_COOKIE_VERSION_MAX_AGE_DAYS = getEnvNum('NEXT_PUBLIC_CONFIG_COOKIE_VERSION_MAX_AGE_DAYS', 365)
export const CONFIG_COOKIE_DEVICE_TRUST_NAME = getEnv('NEXT_PUBLIC_CONFIG_COOKIE_DEVICE_TRUST_NAME') || 'vulnradar_device_trusted'
export const CONFIG_COOKIE_DEVICE_TRUST_MAX_AGE_DAYS = getEnvNum('NEXT_PUBLIC_CONFIG_COOKIE_DEVICE_TRUST_MAX_AGE_DAYS', 30)
export const CONFIG_COOKIE_2FA_PENDING_NAME = getEnv('NEXT_PUBLIC_CONFIG_COOKIE_2FA_PENDING_NAME') || 'vulnradar_2fa_pending'
export const CONFIG_COOKIE_2FA_PENDING_MAX_AGE_SECONDS = getEnvNum('NEXT_PUBLIC_CONFIG_COOKIE_2FA_PENDING_MAX_AGE_SECONDS', 300)

// ============================================================================
// AUTH
// ============================================================================
export const CONFIG_AUTH_SESSION_TIMEOUT_DAYS = getEnvNum('NEXT_PUBLIC_CONFIG_AUTH_SESSION_TIMEOUT_DAYS', 7)
export const CONFIG_AUTH_PASSWORD_RESET_HOURS = getEnvNum('NEXT_PUBLIC_CONFIG_AUTH_PASSWORD_RESET_HOURS', 1)
export const CONFIG_AUTH_EMAIL_VERIFICATION_HOURS = getEnvNum('NEXT_PUBLIC_CONFIG_AUTH_EMAIL_VERIFICATION_HOURS', 24)
export const CONFIG_AUTH_DEVICE_TRUST_DAYS = getEnvNum('NEXT_PUBLIC_CONFIG_AUTH_DEVICE_TRUST_DAYS', 30)
export const CONFIG_AUTH_TOTP_VALIDITY_SECONDS = getEnvNum('NEXT_PUBLIC_CONFIG_AUTH_TOTP_VALIDITY_SECONDS', 30)
export const CONFIG_AUTH_CLEANUP_INTERVAL_MS = getEnvNum('NEXT_PUBLIC_CONFIG_AUTH_CLEANUP_INTERVAL_MS', 86400000)

// ============================================================================
// RATE LIMITS
// ============================================================================
export const CONFIG_RATE_LIMIT_LOGIN_MAX = getEnvNum('NEXT_PUBLIC_CONFIG_RATE_LIMIT_LOGIN_MAX', 5)
export const CONFIG_RATE_LIMIT_LOGIN_WINDOW = getEnvNum('NEXT_PUBLIC_CONFIG_RATE_LIMIT_LOGIN_WINDOW', 15)
export const CONFIG_RATE_LIMIT_SIGNUP_MAX = getEnvNum('NEXT_PUBLIC_CONFIG_RATE_LIMIT_SIGNUP_MAX', 3)
export const CONFIG_RATE_LIMIT_SIGNUP_WINDOW = getEnvNum('NEXT_PUBLIC_CONFIG_RATE_LIMIT_SIGNUP_WINDOW', 60)
export const CONFIG_RATE_LIMIT_FORGOT_PASSWORD_MAX = getEnvNum('NEXT_PUBLIC_CONFIG_RATE_LIMIT_FORGOT_PASSWORD_MAX', 3)
export const CONFIG_RATE_LIMIT_FORGOT_PASSWORD_WINDOW = getEnvNum('NEXT_PUBLIC_CONFIG_RATE_LIMIT_FORGOT_PASSWORD_WINDOW', 10)
export const CONFIG_RATE_LIMIT_API_MAX = getEnvNum('NEXT_PUBLIC_CONFIG_RATE_LIMIT_API_MAX', 100)
export const CONFIG_RATE_LIMIT_API_WINDOW = getEnvNum('NEXT_PUBLIC_CONFIG_RATE_LIMIT_API_WINDOW', 60)
export const CONFIG_RATE_LIMIT_SCAN_MAX = getEnvNum('NEXT_PUBLIC_CONFIG_RATE_LIMIT_SCAN_MAX', 100)
export const CONFIG_RATE_LIMIT_SCAN_WINDOW = getEnvNum('NEXT_PUBLIC_CONFIG_RATE_LIMIT_SCAN_WINDOW', 60)
export const CONFIG_RATE_LIMIT_BULK_SCAN_MAX = getEnvNum('NEXT_PUBLIC_CONFIG_RATE_LIMIT_BULK_SCAN_MAX', 10)
export const CONFIG_RATE_LIMIT_BULK_SCAN_WINDOW = getEnvNum('NEXT_PUBLIC_CONFIG_RATE_LIMIT_BULK_SCAN_WINDOW', 60)

// ============================================================================
// SCANNING
// ============================================================================
export const CONFIG_SCAN_MAX_URL_LENGTH = getEnvNum('NEXT_PUBLIC_CONFIG_SCAN_MAX_URL_LENGTH', 2048)
export const CONFIG_SCAN_MAX_URLS_BULK = getEnvNum('NEXT_PUBLIC_CONFIG_SCAN_MAX_URLS_BULK', 100)
export const CONFIG_SCAN_TIMEOUT_SECONDS = getEnvNum('NEXT_PUBLIC_CONFIG_SCAN_TIMEOUT_SECONDS', 300)
export const CONFIG_SCAN_BULK_TIMEOUT_SECONDS = getEnvNum('NEXT_PUBLIC_CONFIG_SCAN_BULK_TIMEOUT_SECONDS', 1800)
export const CONFIG_SCAN_DEFAULT_SEVERITY_THRESHOLD = getEnv('NEXT_PUBLIC_CONFIG_SCAN_DEFAULT_SEVERITY_THRESHOLD') || 'low'

// ============================================================================
// API
// ============================================================================
export const CONFIG_API_KEY_PREFIX = getEnv('NEXT_PUBLIC_CONFIG_API_KEY_PREFIX') || 'vr_live_'
export const CONFIG_API_DEFAULT_DAILY_LIMIT = getEnvNum('NEXT_PUBLIC_CONFIG_API_DEFAULT_DAILY_LIMIT', 50)
export const CONFIG_API_CURRENT_VERSION = getEnv('NEXT_PUBLIC_CONFIG_API_CURRENT_VERSION') || 'v2'

// ============================================================================
// DEMO
// ============================================================================
export const CONFIG_DEMO_SCAN_LIMIT = getEnvNum('NEXT_PUBLIC_CONFIG_DEMO_SCAN_LIMIT', 5)
export const CONFIG_DEMO_WINDOW_HOURS = getEnvNum('NEXT_PUBLIC_CONFIG_DEMO_WINDOW_HOURS', 12)

// ============================================================================
// DATABASE CONSTRAINTS
// ============================================================================
export const CONFIG_DB_MAX_EMAIL_LENGTH = getEnvNum('NEXT_PUBLIC_CONFIG_DB_MAX_EMAIL_LENGTH', 255)
export const CONFIG_DB_MAX_NAME_LENGTH = getEnvNum('NEXT_PUBLIC_CONFIG_DB_MAX_NAME_LENGTH', 255)
export const CONFIG_DB_MAX_DESCRIPTION_LENGTH = getEnvNum('NEXT_PUBLIC_CONFIG_DB_MAX_DESCRIPTION_LENGTH', 1000)
export const CONFIG_DB_MAX_TEAM_NAME_LENGTH = getEnvNum('NEXT_PUBLIC_CONFIG_DB_MAX_TEAM_NAME_LENGTH', 255)
export const CONFIG_DB_MAX_TAGS_PER_SCAN = getEnvNum('NEXT_PUBLIC_CONFIG_DB_MAX_TAGS_PER_SCAN', 10)

// ============================================================================
// PAGINATION
// ============================================================================
export const CONFIG_PAGINATION_DEFAULT_SIZE = getEnvNum('NEXT_PUBLIC_CONFIG_PAGINATION_DEFAULT_SIZE', 20)
export const CONFIG_PAGINATION_MAX_SIZE = getEnvNum('NEXT_PUBLIC_CONFIG_PAGINATION_MAX_SIZE', 100)
export const CONFIG_PAGINATION_DEFAULT_PAGE = getEnvNum('NEXT_PUBLIC_CONFIG_PAGINATION_DEFAULT_PAGE', 1)

// ============================================================================
// BETA
// ============================================================================
export const CONFIG_BETA_ENABLED = getEnvBool('NEXT_PUBLIC_CONFIG_BETA_ENABLED', false)
export const CONFIG_BETA_BANNER_MESSAGE = getEnv('NEXT_PUBLIC_CONFIG_BETA_BANNER_MESSAGE')

// ============================================================================
// FEATURES
// ============================================================================
export const CONFIG_FEATURE_DEMO_MODE = getEnvBool('NEXT_PUBLIC_CONFIG_FEATURE_DEMO_MODE', true)
export const CONFIG_FEATURE_TEAMS = getEnvBool('NEXT_PUBLIC_CONFIG_FEATURE_TEAMS', true)
export const CONFIG_FEATURE_API_KEYS = getEnvBool('NEXT_PUBLIC_CONFIG_FEATURE_API_KEYS', true)
export const CONFIG_FEATURE_WEBHOOKS = getEnvBool('NEXT_PUBLIC_CONFIG_FEATURE_WEBHOOKS', true)
export const CONFIG_FEATURE_SCHEDULED_SCANS = getEnvBool('NEXT_PUBLIC_CONFIG_FEATURE_SCHEDULED_SCANS', true)
export const CONFIG_FEATURE_BULK_SCANS = getEnvBool('NEXT_PUBLIC_CONFIG_FEATURE_BULK_SCANS', true)
export const CONFIG_FEATURE_PDF_REPORTS = getEnvBool('NEXT_PUBLIC_CONFIG_FEATURE_PDF_REPORTS', true)
export const CONFIG_FEATURE_EMAIL_NOTIFICATIONS = getEnvBool('NEXT_PUBLIC_CONFIG_FEATURE_EMAIL_NOTIFICATIONS', true)

// ============================================================================
// BILLING
// ============================================================================
export const CONFIG_BILLING_ENABLED = getEnvBool('NEXT_PUBLIC_CONFIG_BILLING_ENABLED', false)
export const CONFIG_BILLING_FREE_LIMIT = getEnvNum('NEXT_PUBLIC_CONFIG_BILLING_FREE_LIMIT', 25)
export const CONFIG_BILLING_CORE_LIMIT = getEnvNum('NEXT_PUBLIC_CONFIG_BILLING_CORE_LIMIT', 100)
export const CONFIG_BILLING_PRO_LIMIT = getEnvNum('NEXT_PUBLIC_CONFIG_BILLING_PRO_LIMIT', 150)
export const CONFIG_BILLING_ELITE_LIMIT = getEnvNum('NEXT_PUBLIC_CONFIG_BILLING_ELITE_LIMIT', 500)
export const CONFIG_BILLING_FREE_HISTORY = getEnvNum('NEXT_PUBLIC_CONFIG_BILLING_FREE_HISTORY', 30)
export const CONFIG_BILLING_CORE_HISTORY = getEnvNum('NEXT_PUBLIC_CONFIG_BILLING_CORE_HISTORY', 90)
export const CONFIG_BILLING_PRO_HISTORY = getEnvNum('NEXT_PUBLIC_CONFIG_BILLING_PRO_HISTORY', -1)
export const CONFIG_BILLING_ELITE_HISTORY = getEnvNum('NEXT_PUBLIC_CONFIG_BILLING_ELITE_HISTORY', -1)
export const CONFIG_BILLING_UNLIMITED_LIMIT = getEnvNum('NEXT_PUBLIC_CONFIG_BILLING_UNLIMITED_LIMIT', -1)
