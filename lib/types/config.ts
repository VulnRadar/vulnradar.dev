// ============================================================================
// Configuration Type Definitions
// ============================================================================

export interface AppConfig {
  name: string
  slug: string
  version: string
  engine_version: string
  description: string
  total_checks_label: string
  url: string
  repo: string
  discord_invite_url: string
  support_email: string
}

export interface BrandingConfig {
  logo_url: string
  primary_color: string
  footer_text: string
}

export interface CookieConfig {
  session: {
    name: string
    max_age_days: number
  }
  version: {
    name: string
    max_age_days: number
  }
  device_trust: {
    name: string
    max_age_days: number
  }
  two_fa_pending: {
    name: string
    max_age_seconds: number
  }
}

export interface AuthConfig {
  session_timeout_days: number
  password_reset_hours: number
  email_verification_hours: number
  device_trust_days: number
  totp_validity_seconds: number
  cleanup_interval_ms: number
}

export interface RateLimitEntry {
  max_attempts?: number
  max_requests?: number
  window_minutes: number
}

export interface RateLimitsConfig {
  login: RateLimitEntry
  signup: RateLimitEntry
  forgot_password: RateLimitEntry
  api: RateLimitEntry
  scan: RateLimitEntry
  bulk_scan: RateLimitEntry
}

export interface ScanningConfig {
  max_url_length: number
  max_urls_bulk: number
  timeout_seconds: number
  bulk_timeout_seconds: number
  default_severity_threshold: string
}

export interface ApiConfig {
  key_prefix: string
  default_daily_limit: number
  current_version: string
  supported_versions: string[]
}

export interface DemoConfig {
  scan_limit: number
  window_hours: number
}

export interface DatabaseConfig {
  max_email_length: number
  max_name_length: number
  max_description_length: number
  max_team_name_length: number
  max_tags_per_scan: number
}

export interface PaginationConfig {
  default_page_size: number
  max_page_size: number
  default_page: number
}

export interface BetaConfig {
  enabled: boolean
  banner_message: string
}

export interface FeaturesConfig {
  demo_mode: boolean
  teams: boolean
  api_keys: boolean
  webhooks: boolean
  scheduled_scans: boolean
  bulk_scans: boolean
  pdf_reports: boolean
  email_notifications: boolean
}

export interface BillingConfig {
  // Master switch - when false, disables all billing/premium features
  // Self-hosters can set this to false to give everyone unlimited access
  enabled: boolean
  
  // Plan limits (daily scans) - only applies when billing is enabled
  plan_limits: {
    free: number
    core_supporter: number
    pro_supporter: number
    elite_supporter: number
  }
  
  // When billing is disabled, this is the limit for all users (-1 = unlimited)
  unlimited_mode_limit: number
}

export interface VulnRadarConfig {
  app: AppConfig
  branding: BrandingConfig
  cookies: CookieConfig
  auth: AuthConfig
  rate_limits: RateLimitsConfig
  scanning: ScanningConfig
  api: ApiConfig
  demo: DemoConfig
  database: DatabaseConfig
  pagination: PaginationConfig
  beta: BetaConfig
  features: FeaturesConfig
  billing: BillingConfig
}

// ============================================================================
// Dynamic Version Getter (reads from config.yaml or NEXT_PUBLIC_ env vars)
// ============================================================================

function getDefaultVersion(): { version: string; engineVersion: string } {
  // First try NEXT_PUBLIC_ env vars (available everywhere after build)
  if (process.env.NEXT_PUBLIC_APP_VERSION) {
    return {
      version: process.env.NEXT_PUBLIC_APP_VERSION,
      engineVersion: process.env.NEXT_PUBLIC_ENGINE_VERSION ?? "2.0.1",
    }
  }
  
  // On server, try reading config.yaml directly
  if (typeof window === "undefined") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("fs")
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require("path")
      const configPath = path.join(process.cwd(), "config.yaml")
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, "utf-8")
        const versionMatch = content.match(/version:\s*["']?([^"'\s]+)["']?/)
        const engineMatch = content.match(/engine_version:\s*["']?([^"'\s]+)["']?/)
        return {
          version: versionMatch?.[1] ?? "2.0.1",
          engineVersion: engineMatch?.[1] ?? "2.0.1",
        }
      }
    } catch {
      // Ignore errors, fall through to default
    }
  }
  
  // Final fallback
  return { version: "2.0.1", engineVersion: "2.0.1" }
}

const { version: defaultVersion, engineVersion: defaultEngineVersion } = getDefaultVersion()

// ============================================================================
// Default Configuration (fallback if config.yaml is missing/invalid)
// ============================================================================

export const DEFAULT_CONFIG: VulnRadarConfig = {
  app: {
    name: "VulnRadar",
    slug: "vulnradar",
    version: defaultVersion,
    engine_version: defaultEngineVersion,
    description: "Scan websites for security vulnerabilities. Get instant reports with severity ratings, actionable fix guidance, and team collaboration tools.",
    total_checks_label: "175+",
    url: "https://vulnradar.dev",
    repo: "VulnRadar/vulnradar.dev",
    discord_invite_url: "https://discord.gg/Y7R6hdGbNe",
    support_email: "support@vulnradar.dev",
  },
  branding: {
    logo_url: "/favicon.png",
    primary_color: "#6366f1",
    footer_text: "VulnRadar - Security Scanner",
  },
  cookies: {
    session: {
      name: "vulnradar_session",
      max_age_days: 7,
    },
    version: {
      name: "vulnradar_last_seen_version",
      max_age_days: 365,
    },
    device_trust: {
      name: "vulnradar_device_trusted",
      max_age_days: 30,
    },
    two_fa_pending: {
      name: "vulnradar_2fa_pending",
      max_age_seconds: 300,
    },
  },
  auth: {
    session_timeout_days: 7,
    password_reset_hours: 1,
    email_verification_hours: 24,
    device_trust_days: 30,
    totp_validity_seconds: 30,
    cleanup_interval_ms: 86400000,
  },
  rate_limits: {
    login: { max_attempts: 5, window_minutes: 15 },
    signup: { max_attempts: 3, window_minutes: 60 },
    forgot_password: { max_attempts: 3, window_minutes: 10 },
    api: { max_requests: 100, window_minutes: 60 },
    scan: { max_requests: 100, window_minutes: 60 },
    bulk_scan: { max_requests: 10, window_minutes: 60 },
  },
  scanning: {
    max_url_length: 2048,
    max_urls_bulk: 100,
    timeout_seconds: 300,
    bulk_timeout_seconds: 1800,
    default_severity_threshold: "low",
  },
  api: {
    key_prefix: "vr_live_",
    default_daily_limit: 50,
    current_version: "v2",
    supported_versions: ["v1", "v2"],
  },
  demo: {
    scan_limit: 5,
    window_hours: 12,
  },
  database: {
    max_email_length: 255,
    max_name_length: 255,
    max_description_length: 1000,
    max_team_name_length: 255,
    max_tags_per_scan: 10,
  },
  pagination: {
    default_page_size: 20,
    max_page_size: 100,
    default_page: 1,
  },
  beta: {
    enabled: true,
    banner_message: "You are using VulnRadar v2.0 BETA - Some features may be unstable. Please report issues.",
  },
  features: {
    demo_mode: true,
    teams: true,
    api_keys: true,
    webhooks: true,
    scheduled_scans: true,
    bulk_scans: true,
    pdf_reports: true,
    email_notifications: true,
  },
  billing: {
    enabled: true,
    plan_limits: {
      free: 50,
      core_supporter: 100,
      pro_supporter: 150,
      elite_supporter: 500,
    },
    unlimited_mode_limit: -1, // -1 = unlimited when billing is disabled
  },
}
