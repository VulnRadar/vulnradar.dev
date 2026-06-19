// ============================================================================
// Configuration Type Definitions
// ============================================================================
// Source of truth: lib/config/config-values.ts (raw `CONFIG_*` constants).
// `DEFAULT_CONFIG` is derived from those constants to eliminate duplication
// and prevent drift between hardcoded values and the type definition.
// ============================================================================

export interface AppConfig {
  name: string;
  slug: string;
  version: string;
  engine_version: string;
  description: string;
  total_checks_label: string;
  url: string;
  repo: string;
  discord_invite_url: string;
  support_email: string;
  legal_email: string;
  security_email: string;
  enterprise_email: string;
  noreply_email: string;
  terms_updated_at: string;
}

export interface BrandingConfig {
  logo_url: string;
  primary_color: string;
  footer_text: string;
}

export interface CookieConfig {
  session: {
    name: string;
    max_age_days: number;
  };
  version: {
    name: string;
    max_age_days: number;
  };
  device_trust: {
    name: string;
    max_age_days: number;
  };
  two_fa_pending: {
    name: string;
    max_age_seconds: number;
  };
}

export interface AuthConfig {
  session_timeout_days: number;
  password_reset_hours: number;
  email_verification_hours: number;
  device_trust_days: number;
  totp_validity_seconds: number;
  cleanup_interval_ms: number;
}

export interface RateLimitEntry {
  max_attempts?: number;
  max_requests?: number;
  window_minutes: number;
}

export interface RateLimitsConfig {
  login: RateLimitEntry;
  signup: RateLimitEntry;
  forgot_password: RateLimitEntry;
  api: RateLimitEntry;
  scan: RateLimitEntry;
  bulk_scan: RateLimitEntry;
}

export interface ScanningConfig {
  max_url_length: number;
  max_urls_bulk: number;
  timeout_seconds: number;
  bulk_timeout_seconds: number;
  default_severity_threshold: string;
}

export interface ApiConfig {
  key_prefix: string;
  default_daily_limit: number;
  current_version: string;
  supported_versions: string[];
}

export interface DemoConfig {
  scan_limit: number;
  window_hours: number;
}

export interface DatabaseConfig {
  max_email_length: number;
  max_name_length: number;
  max_description_length: number;
  max_team_name_length: number;
  max_tags_per_scan: number;
}

export interface PaginationConfig {
  default_page_size: number;
  max_page_size: number;
  default_page: number;
}

export interface BetaConfig {
  enabled: boolean;
  banner_message: string;
}

export interface FeaturesConfig {
  demo_mode: boolean;
  teams: boolean;
  api_keys: boolean;
  webhooks: boolean;
  scheduled_scans: boolean;
  bulk_scans: boolean;
  pdf_reports: boolean;
  email_notifications: boolean;
}

export interface BillingConfig {
  // Master switch - when false, disables all billing/premium features
  // Self-hosters can set this to false to give everyone unlimited access
  enabled: boolean;

  // Plan limits (daily scans) - only applies when billing is enabled
  plan_limits: {
    free: number;
    core_supporter: number;
    pro_supporter: number;
    elite_supporter: number;
  };

  // History retention in days (-1 = unlimited)
  history_retention: {
    free: number;
    core_supporter: number;
    pro_supporter: number;
    elite_supporter: number;
  };

  // When billing is disabled, this is the limit for all users (-1 = unlimited)
  unlimited_mode_limit: number;
}

export interface VulnRadarConfig {
  app: AppConfig;
  branding: BrandingConfig;
  cookies: CookieConfig;
  auth: AuthConfig;
  rate_limits: RateLimitsConfig;
  scanning: ScanningConfig;
  api: ApiConfig;
  demo: DemoConfig;
  database: DatabaseConfig;
  pagination: PaginationConfig;
  beta: BetaConfig;
  features: FeaturesConfig;
  billing: BillingConfig;
}

// ============================================================================
// Default Configuration (derived from lib/config/config-values.ts)
// ============================================================================
// DO NOT duplicate values here. Edit lib/config/config-values.ts instead.
import {
  CONFIG_APP_NAME,
  CONFIG_APP_SLUG,
  CONFIG_APP_VERSION,
  CONFIG_ENGINE_VERSION,
  CONFIG_APP_DESCRIPTION,
  CONFIG_TOTAL_CHECKS_LABEL,
  CONFIG_APP_URL,
  CONFIG_APP_REPO,
  CONFIG_DISCORD_INVITE_URL,
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
  CONFIG_API_SUPPORTED_VERSIONS,
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
} from "../config/config-values";

export const DEFAULT_CONFIG: VulnRadarConfig = {
  app: {
    name: CONFIG_APP_NAME,
    slug: CONFIG_APP_SLUG,
    version: CONFIG_APP_VERSION,
    engine_version: CONFIG_ENGINE_VERSION,
    description: CONFIG_APP_DESCRIPTION,
    total_checks_label: CONFIG_TOTAL_CHECKS_LABEL,
    url: CONFIG_APP_URL,
    repo: CONFIG_APP_REPO,
    discord_invite_url: CONFIG_DISCORD_INVITE_URL,
    support_email: CONFIG_SUPPORT_EMAIL,
    legal_email: CONFIG_LEGAL_EMAIL,
    security_email: CONFIG_SECURITY_EMAIL,
    enterprise_email: CONFIG_ENTERPRISE_EMAIL,
    noreply_email: CONFIG_NOREPLY_EMAIL,
    terms_updated_at: CONFIG_TERMS_UPDATED_AT,
  },
  branding: {
    logo_url: CONFIG_LOGO_URL,
    primary_color: CONFIG_PRIMARY_COLOR,
    footer_text: CONFIG_FOOTER_TEXT,
  },
  cookies: {
    session: {
      name: CONFIG_SESSION_COOKIE_NAME,
      max_age_days: CONFIG_SESSION_MAX_AGE_DAYS,
    },
    version: {
      name: CONFIG_VERSION_COOKIE_NAME,
      max_age_days: CONFIG_VERSION_COOKIE_MAX_AGE_DAYS,
    },
    device_trust: {
      name: CONFIG_DEVICE_TRUST_COOKIE_NAME,
      max_age_days: CONFIG_DEVICE_TRUST_MAX_AGE_DAYS,
    },
    two_fa_pending: {
      name: CONFIG_2FA_PENDING_COOKIE_NAME,
      max_age_seconds: CONFIG_2FA_PENDING_MAX_AGE_SECONDS,
    },
  },
  auth: {
    session_timeout_days: CONFIG_SESSION_TIMEOUT_DAYS,
    password_reset_hours: CONFIG_PASSWORD_RESET_HOURS,
    email_verification_hours: CONFIG_EMAIL_VERIFICATION_HOURS,
    device_trust_days: CONFIG_DEVICE_TRUST_DAYS,
    totp_validity_seconds: CONFIG_TOTP_VALIDITY_SECONDS,
    cleanup_interval_ms: CONFIG_CLEANUP_INTERVAL_MS,
  },
  rate_limits: {
    login: {
      max_attempts: CONFIG_RATE_LIMIT_LOGIN_ATTEMPTS,
      window_minutes: CONFIG_RATE_LIMIT_LOGIN_WINDOW_MINUTES,
    },
    signup: {
      max_attempts: CONFIG_RATE_LIMIT_SIGNUP_ATTEMPTS,
      window_minutes: CONFIG_RATE_LIMIT_SIGNUP_WINDOW_MINUTES,
    },
    forgot_password: {
      max_attempts: CONFIG_RATE_LIMIT_FORGOT_PASSWORD_ATTEMPTS,
      window_minutes: CONFIG_RATE_LIMIT_FORGOT_PASSWORD_WINDOW_MINUTES,
    },
    api: {
      max_requests: CONFIG_RATE_LIMIT_API_REQUESTS,
      window_minutes: CONFIG_RATE_LIMIT_API_WINDOW_MINUTES,
    },
    scan: {
      max_requests: CONFIG_RATE_LIMIT_SCAN_REQUESTS,
      window_minutes: CONFIG_RATE_LIMIT_SCAN_WINDOW_MINUTES,
    },
    bulk_scan: {
      max_requests: CONFIG_RATE_LIMIT_BULK_SCAN_REQUESTS,
      window_minutes: CONFIG_RATE_LIMIT_BULK_SCAN_WINDOW_MINUTES,
    },
  },
  scanning: {
    max_url_length: CONFIG_MAX_URL_LENGTH,
    max_urls_bulk: CONFIG_MAX_URLS_BULK,
    timeout_seconds: CONFIG_SCAN_TIMEOUT_SECONDS,
    bulk_timeout_seconds: CONFIG_BULK_SCAN_TIMEOUT_SECONDS,
    default_severity_threshold: CONFIG_DEFAULT_SEVERITY_THRESHOLD,
  },
  api: {
    key_prefix: CONFIG_API_KEY_PREFIX,
    default_daily_limit: CONFIG_DEFAULT_API_KEY_DAILY_LIMIT,
    current_version: CONFIG_API_CURRENT_VERSION,
    supported_versions: CONFIG_API_SUPPORTED_VERSIONS,
  },
  demo: {
    scan_limit: CONFIG_DEMO_SCAN_LIMIT,
    window_hours: CONFIG_DEMO_WINDOW_HOURS,
  },
  database: {
    max_email_length: CONFIG_MAX_EMAIL_LENGTH,
    max_name_length: CONFIG_MAX_NAME_LENGTH,
    max_description_length: CONFIG_MAX_DESCRIPTION_LENGTH,
    max_team_name_length: CONFIG_MAX_TEAM_NAME_LENGTH,
    max_tags_per_scan: CONFIG_MAX_TAGS_PER_SCAN,
  },
  pagination: {
    default_page_size: CONFIG_PAGINATION_DEFAULT_PAGE_SIZE,
    max_page_size: CONFIG_PAGINATION_MAX_PAGE_SIZE,
    default_page: CONFIG_PAGINATION_DEFAULT_PAGE,
  },
  beta: {
    enabled: CONFIG_BETA_ENABLED,
    banner_message: CONFIG_BETA_BANNER_MESSAGE,
  },
  features: {
    demo_mode: CONFIG_FEATURE_DEMO_MODE,
    teams: CONFIG_FEATURE_TEAMS,
    api_keys: CONFIG_FEATURE_API_KEYS,
    webhooks: CONFIG_FEATURE_WEBHOOKS,
    scheduled_scans: CONFIG_FEATURE_SCHEDULED_SCANS,
    bulk_scans: CONFIG_FEATURE_BULK_SCANS,
    pdf_reports: CONFIG_FEATURE_PDF_REPORTS,
    email_notifications: CONFIG_FEATURE_EMAIL_NOTIFICATIONS,
  },
  billing: {
    enabled: CONFIG_BILLING_ENABLED,
    plan_limits: {
      free: CONFIG_BILLING_FREE_LIMIT,
      core_supporter: CONFIG_BILLING_CORE_SUPPORTER_LIMIT,
      pro_supporter: CONFIG_BILLING_PRO_SUPPORTER_LIMIT,
      elite_supporter: CONFIG_BILLING_ELITE_SUPPORTER_LIMIT,
    },
    history_retention: {
      free: CONFIG_BILLING_FREE_RETENTION,
      core_supporter: CONFIG_BILLING_CORE_SUPPORTER_RETENTION,
      pro_supporter: CONFIG_BILLING_PRO_SUPPORTER_RETENTION,
      elite_supporter: CONFIG_BILLING_ELITE_SUPPORTER_RETENTION,
    },
    unlimited_mode_limit: CONFIG_BILLING_UNLIMITED_MODE_LIMIT,
  },
};
