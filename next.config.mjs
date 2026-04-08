import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'

// ============================================================================
// BUILD-TIME CONFIG LOADING
// ============================================================================
// Read config.yaml at build time and inject ALL values as environment variables.
// This ensures config values are available in ALL runtimes (Edge, browser, server).
// Self-hosters: Edit config.yaml and restart the dev server (or rebuild for prod).
// ============================================================================

function loadConfigYaml() {
  try {
    const configPath = path.join(process.cwd(), 'config.yaml')
    if (!fs.existsSync(configPath)) {
      console.warn('[next.config.mjs] config.yaml not found at:', configPath)
      return null
    }
    
    const content = fs.readFileSync(configPath, 'utf-8')
    const parsed = yaml.load(content)
    
    if (!parsed || typeof parsed !== 'object') {
      console.warn('[next.config.mjs] config.yaml is empty or invalid')
      return null
    }
    
    console.log('[next.config.mjs] Successfully loaded config.yaml')
    return parsed
  } catch (error) {
    console.error('[next.config.mjs] Error loading config.yaml:', error.message)
    return null
  }
}

const yamlConfig = loadConfigYaml()

// Helper to safely get nested value
const get = (obj, path, defaultValue = '') => {
  if (!obj) return defaultValue
  const keys = path.split('.')
  let result = obj
  for (const key of keys) {
    if (result === null || result === undefined || typeof result !== 'object') {
      return defaultValue
    }
    result = result[key]
  }
  return result !== null && result !== undefined ? String(result) : defaultValue
}

// Inject ALL config values as environment variables at build time
// These will be available in ALL runtimes including Edge and browser
const configEnv = {
  // App metadata
  NEXT_PUBLIC_CONFIG_APP_NAME: get(yamlConfig, 'app.name'),
  NEXT_PUBLIC_CONFIG_APP_SLUG: get(yamlConfig, 'app.slug'),
  NEXT_PUBLIC_CONFIG_APP_VERSION: get(yamlConfig, 'app.version'),
  NEXT_PUBLIC_CONFIG_ENGINE_VERSION: get(yamlConfig, 'app.engine_version'),
  NEXT_PUBLIC_CONFIG_API_VERSION: get(yamlConfig, 'app.api_version'),
  NEXT_PUBLIC_CONFIG_APP_DESCRIPTION: get(yamlConfig, 'app.description'),
  NEXT_PUBLIC_CONFIG_TOTAL_CHECKS_LABEL: get(yamlConfig, 'app.total_checks_label'),
  NEXT_PUBLIC_CONFIG_APP_URL: get(yamlConfig, 'app.url'),
  NEXT_PUBLIC_CONFIG_APP_REPO: get(yamlConfig, 'app.repo'),
  NEXT_PUBLIC_CONFIG_DISCORD_INVITE_URL: get(yamlConfig, 'app.discord_invite_url'),
  NEXT_PUBLIC_CONFIG_TERMS_UPDATED_AT: get(yamlConfig, 'app.terms_updated_at'),
  // Emails
  NEXT_PUBLIC_CONFIG_SUPPORT_EMAIL: get(yamlConfig, 'app.support_email'),
  NEXT_PUBLIC_CONFIG_LEGAL_EMAIL: get(yamlConfig, 'app.legal_email'),
  NEXT_PUBLIC_CONFIG_SECURITY_EMAIL: get(yamlConfig, 'app.security_email'),
  NEXT_PUBLIC_CONFIG_ENTERPRISE_EMAIL: get(yamlConfig, 'app.enterprise_email'),
  NEXT_PUBLIC_CONFIG_NOREPLY_EMAIL: get(yamlConfig, 'app.noreply_email'),
  // Branding
  NEXT_PUBLIC_CONFIG_LOGO_URL: get(yamlConfig, 'branding.logo_url'),
  NEXT_PUBLIC_CONFIG_PRIMARY_COLOR: get(yamlConfig, 'branding.primary_color'),
  NEXT_PUBLIC_CONFIG_FOOTER_TEXT: get(yamlConfig, 'branding.footer_text'),
  // Cookies
  NEXT_PUBLIC_CONFIG_COOKIE_SESSION_NAME: get(yamlConfig, 'cookies.session.name'),
  NEXT_PUBLIC_CONFIG_COOKIE_SESSION_MAX_AGE_DAYS: get(yamlConfig, 'cookies.session.max_age_days'),
  NEXT_PUBLIC_CONFIG_COOKIE_VERSION_NAME: get(yamlConfig, 'cookies.version.name'),
  NEXT_PUBLIC_CONFIG_COOKIE_VERSION_MAX_AGE_DAYS: get(yamlConfig, 'cookies.version.max_age_days'),
  NEXT_PUBLIC_CONFIG_COOKIE_DEVICE_TRUST_NAME: get(yamlConfig, 'cookies.device_trust.name'),
  NEXT_PUBLIC_CONFIG_COOKIE_DEVICE_TRUST_MAX_AGE_DAYS: get(yamlConfig, 'cookies.device_trust.max_age_days'),
  NEXT_PUBLIC_CONFIG_COOKIE_2FA_PENDING_NAME: get(yamlConfig, 'cookies.two_fa_pending.name'),
  NEXT_PUBLIC_CONFIG_COOKIE_2FA_PENDING_MAX_AGE_SECONDS: get(yamlConfig, 'cookies.two_fa_pending.max_age_seconds'),
  // Auth
  NEXT_PUBLIC_CONFIG_AUTH_SESSION_TIMEOUT_DAYS: get(yamlConfig, 'auth.session_timeout_days'),
  NEXT_PUBLIC_CONFIG_AUTH_PASSWORD_RESET_HOURS: get(yamlConfig, 'auth.password_reset_hours'),
  NEXT_PUBLIC_CONFIG_AUTH_EMAIL_VERIFICATION_HOURS: get(yamlConfig, 'auth.email_verification_hours'),
  NEXT_PUBLIC_CONFIG_AUTH_DEVICE_TRUST_DAYS: get(yamlConfig, 'auth.device_trust_days'),
  NEXT_PUBLIC_CONFIG_AUTH_TOTP_VALIDITY_SECONDS: get(yamlConfig, 'auth.totp_validity_seconds'),
  NEXT_PUBLIC_CONFIG_AUTH_CLEANUP_INTERVAL_MS: get(yamlConfig, 'auth.cleanup_interval_ms'),
  // Rate limits
  NEXT_PUBLIC_CONFIG_RATE_LIMIT_LOGIN_MAX: get(yamlConfig, 'rate_limits.login.max_attempts'),
  NEXT_PUBLIC_CONFIG_RATE_LIMIT_LOGIN_WINDOW: get(yamlConfig, 'rate_limits.login.window_minutes'),
  NEXT_PUBLIC_CONFIG_RATE_LIMIT_SIGNUP_MAX: get(yamlConfig, 'rate_limits.signup.max_attempts'),
  NEXT_PUBLIC_CONFIG_RATE_LIMIT_SIGNUP_WINDOW: get(yamlConfig, 'rate_limits.signup.window_minutes'),
  NEXT_PUBLIC_CONFIG_RATE_LIMIT_FORGOT_PASSWORD_MAX: get(yamlConfig, 'rate_limits.forgot_password.max_attempts'),
  NEXT_PUBLIC_CONFIG_RATE_LIMIT_FORGOT_PASSWORD_WINDOW: get(yamlConfig, 'rate_limits.forgot_password.window_minutes'),
  NEXT_PUBLIC_CONFIG_RATE_LIMIT_API_MAX: get(yamlConfig, 'rate_limits.api.max_requests'),
  NEXT_PUBLIC_CONFIG_RATE_LIMIT_API_WINDOW: get(yamlConfig, 'rate_limits.api.window_minutes'),
  NEXT_PUBLIC_CONFIG_RATE_LIMIT_SCAN_MAX: get(yamlConfig, 'rate_limits.scan.max_requests'),
  NEXT_PUBLIC_CONFIG_RATE_LIMIT_SCAN_WINDOW: get(yamlConfig, 'rate_limits.scan.window_minutes'),
  NEXT_PUBLIC_CONFIG_RATE_LIMIT_BULK_SCAN_MAX: get(yamlConfig, 'rate_limits.bulk_scan.max_requests'),
  NEXT_PUBLIC_CONFIG_RATE_LIMIT_BULK_SCAN_WINDOW: get(yamlConfig, 'rate_limits.bulk_scan.window_minutes'),
  // Scanning
  NEXT_PUBLIC_CONFIG_SCAN_MAX_URL_LENGTH: get(yamlConfig, 'scanning.max_url_length'),
  NEXT_PUBLIC_CONFIG_SCAN_MAX_URLS_BULK: get(yamlConfig, 'scanning.max_urls_bulk'),
  NEXT_PUBLIC_CONFIG_SCAN_TIMEOUT_SECONDS: get(yamlConfig, 'scanning.timeout_seconds'),
  NEXT_PUBLIC_CONFIG_SCAN_BULK_TIMEOUT_SECONDS: get(yamlConfig, 'scanning.bulk_timeout_seconds'),
  NEXT_PUBLIC_CONFIG_SCAN_DEFAULT_SEVERITY_THRESHOLD: get(yamlConfig, 'scanning.default_severity_threshold'),
  // API
  NEXT_PUBLIC_CONFIG_API_KEY_PREFIX: get(yamlConfig, 'api.key_prefix'),
  NEXT_PUBLIC_CONFIG_API_DEFAULT_DAILY_LIMIT: get(yamlConfig, 'api.default_daily_limit'),
  NEXT_PUBLIC_CONFIG_API_CURRENT_VERSION: get(yamlConfig, 'api.current_version'),
  // Demo
  NEXT_PUBLIC_CONFIG_DEMO_SCAN_LIMIT: get(yamlConfig, 'demo.scan_limit'),
  NEXT_PUBLIC_CONFIG_DEMO_WINDOW_HOURS: get(yamlConfig, 'demo.window_hours'),
  // Database constraints
  NEXT_PUBLIC_CONFIG_DB_MAX_EMAIL_LENGTH: get(yamlConfig, 'database.max_email_length'),
  NEXT_PUBLIC_CONFIG_DB_MAX_NAME_LENGTH: get(yamlConfig, 'database.max_name_length'),
  NEXT_PUBLIC_CONFIG_DB_MAX_DESCRIPTION_LENGTH: get(yamlConfig, 'database.max_description_length'),
  NEXT_PUBLIC_CONFIG_DB_MAX_TEAM_NAME_LENGTH: get(yamlConfig, 'database.max_team_name_length'),
  NEXT_PUBLIC_CONFIG_DB_MAX_TAGS_PER_SCAN: get(yamlConfig, 'database.max_tags_per_scan'),
  // Pagination
  NEXT_PUBLIC_CONFIG_PAGINATION_DEFAULT_SIZE: get(yamlConfig, 'pagination.default_page_size'),
  NEXT_PUBLIC_CONFIG_PAGINATION_MAX_SIZE: get(yamlConfig, 'pagination.max_page_size'),
  NEXT_PUBLIC_CONFIG_PAGINATION_DEFAULT_PAGE: get(yamlConfig, 'pagination.default_page'),
  // Beta
  NEXT_PUBLIC_CONFIG_BETA_ENABLED: get(yamlConfig, 'beta.enabled'),
  NEXT_PUBLIC_CONFIG_BETA_BANNER_MESSAGE: get(yamlConfig, 'beta.banner_message'),
  // Features
  NEXT_PUBLIC_CONFIG_FEATURE_DEMO_MODE: get(yamlConfig, 'features.demo_mode'),
  NEXT_PUBLIC_CONFIG_FEATURE_TEAMS: get(yamlConfig, 'features.teams'),
  NEXT_PUBLIC_CONFIG_FEATURE_API_KEYS: get(yamlConfig, 'features.api_keys'),
  NEXT_PUBLIC_CONFIG_FEATURE_WEBHOOKS: get(yamlConfig, 'features.webhooks'),
  NEXT_PUBLIC_CONFIG_FEATURE_SCHEDULED_SCANS: get(yamlConfig, 'features.scheduled_scans'),
  NEXT_PUBLIC_CONFIG_FEATURE_BULK_SCANS: get(yamlConfig, 'features.bulk_scans'),
  NEXT_PUBLIC_CONFIG_FEATURE_PDF_REPORTS: get(yamlConfig, 'features.pdf_reports'),
  NEXT_PUBLIC_CONFIG_FEATURE_EMAIL_NOTIFICATIONS: get(yamlConfig, 'features.email_notifications'),
  // Billing
  NEXT_PUBLIC_CONFIG_BILLING_ENABLED: get(yamlConfig, 'billing.enabled'),
  NEXT_PUBLIC_CONFIG_BILLING_FREE_LIMIT: get(yamlConfig, 'billing.plan_limits.free'),
  NEXT_PUBLIC_CONFIG_BILLING_CORE_LIMIT: get(yamlConfig, 'billing.plan_limits.core_supporter'),
  NEXT_PUBLIC_CONFIG_BILLING_PRO_LIMIT: get(yamlConfig, 'billing.plan_limits.pro_supporter'),
  NEXT_PUBLIC_CONFIG_BILLING_ELITE_LIMIT: get(yamlConfig, 'billing.plan_limits.elite_supporter'),
  NEXT_PUBLIC_CONFIG_BILLING_FREE_HISTORY: get(yamlConfig, 'billing.history_retention.free'),
  NEXT_PUBLIC_CONFIG_BILLING_CORE_HISTORY: get(yamlConfig, 'billing.history_retention.core_supporter'),
  NEXT_PUBLIC_CONFIG_BILLING_PRO_HISTORY: get(yamlConfig, 'billing.history_retention.pro_supporter'),
  NEXT_PUBLIC_CONFIG_BILLING_ELITE_HISTORY: get(yamlConfig, 'billing.history_retention.elite_supporter'),
  NEXT_PUBLIC_CONFIG_BILLING_UNLIMITED_LIMIT: get(yamlConfig, 'billing.unlimited_mode_limit'),
}

// Log a few key values to verify loading worked
if (yamlConfig) {
  console.log('[next.config.mjs] Config values loaded:')
  console.log('  - app.name:', configEnv.NEXT_PUBLIC_CONFIG_APP_NAME)
  console.log('  - app.url:', configEnv.NEXT_PUBLIC_CONFIG_APP_URL)
  console.log('  - branding.logo_url:', configEnv.NEXT_PUBLIC_CONFIG_LOGO_URL)
}

/** @type {import('next').NextConfig} */

const nextConfig = {
  env: configEnv,
  output: "standalone",
  serverExternalPackages: ["fs", "path"],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  poweredByHeader: false,
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      }
    }
    return config
  },
  async rewrites() {
    return [
      {
        source: "/.well-known/security.txt",
        destination: "/api/security-txt",
      },
      {
        source: "/security.txt",
        destination: "/api/security-txt",
      },
    ]
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
                "default-src 'self'; " +
                "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://static.cloudflareinsights.com https://embed.tawk.to https://*.tawk.to; " +
                "script-src-elem 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com https://embed.tawk.to https://*.tawk.to; " +
                "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://embed.tawk.to https://*.tawk.to; " +
                "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com https://embed.tawk.to https://*.tawk.to; " +
                "font-src 'self' https://fonts.gstatic.com https://static.cloudflareinsights.com; " +
                "img-src 'self' data: blob: https:; " +
                "connect-src 'self' https://challenges.cloudflare.com https://embed.tawk.to https://*.tawk.to https://va.tawk.to wss://*.tawk.to https://static.cloudflareinsights.com https: wss:; " +
                "frame-src https://challenges.cloudflare.com https://embed.tawk.to https://*.tawk.to; " +
                "frame-ancestors 'none'; " +
                "base-uri 'self'; " +
                "form-action 'self'; " +
                "object-src 'none'; " +
                "upgrade-insecure-requests",
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Cross-Origin-Embedder-Policy", value: "unsafe-none" },
          { key: "Origin-Agent-Cluster", value: "?1" },
          { key: "Document-Policy", value: "force-load-at-top" },
        ],
      },
    ]
  },
}

export default nextConfig
