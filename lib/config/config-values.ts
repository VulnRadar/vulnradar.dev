// CONFIG VALUES - Hardcoded Configuration Values

// These values are the source of truth for application configuration.
// Self-hosters: Modify these values to customize your deployment.

// App metadata - UPDATE THESE FOR YOUR DEPLOYMENT
export const CONFIG_APP_NAME = "VulnRadar";
export const CONFIG_APP_SLUG = "vulnradar";
export const CONFIG_APP_VERSION = "2.3.1";
// The minimum database schema version this app requires. App 2.3.1 uses
// the v2 schema (v2.3.x = v2 in the migration framework — the only
// difference is api_keys.key_locator, which instrumentation.ts auto-adds).
// When you bump CONFIG_APP_VERSION to a release with a real schema change,
// also bump this to the new schema version and add the migration in
// scripts/migrate/versions/. See scripts/README.md for the full flow.
export const CONFIG_MIN_SCHEMA_VERSION = "2.0.0";
export const CONFIG_ENGINE_VERSION = "2.1.0";
export const CONFIG_APP_DESCRIPTION =
  "Scan websites for security vulnerabilities. Get instant reports with severity ratings, actionable fix guidance, and team collaboration tools.";
export const CONFIG_TOTAL_CHECKS_LABEL = "310+";
export const CONFIG_APP_URL = "https://vulnradar.dev";
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

export const CONFIG_LOGO_URL = "/favicon-dark.svg";
export const CONFIG_PRIMARY_COLOR = "#6366f1";
export const CONFIG_FOOTER_TEXT = "VulnRadar - Security Scanner";

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
export const CONFIG_API_CURRENT_VERSION = "v2";
export const CONFIG_API_SUPPORTED_VERSIONS = ["v1", "v2"];

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
export const CONFIG_BETA_BANNER_MESSAGE =
  "You are using VulnRadar v2.0 BETA - Some features may be unstable. Please report issues.";

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
