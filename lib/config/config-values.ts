// ============================================================================
// CONFIG VALUES - Direct config.yaml reader with NO dependencies
// ============================================================================
// This file reads config.yaml directly without importing from other modules.
// It's the foundation that constants.ts and DEFAULT_CONFIG can safely import.
// 
// IMPORTANT: Edge Runtime (middleware) and browser cannot read config.yaml.
// For these environments, we use environment variables with hardcoded fallbacks.
// ============================================================================

// Hardcoded defaults for Edge Runtime / browser where fs is not available
// These MUST match the values in config.yaml
const EDGE_DEFAULTS = {
  name: "VulnRadar",
  slug: "vulnradar",
  version: "2.2.3",
  engine_version: "2.1.0",
  api_version: "v2",
  description: "Scan websites for security vulnerabilities. Get instant reports with severity ratings, actionable fix guidance, and team collaboration tools.",
  total_checks_label: "310+",
  url: "https://vulnradar.dev",
  repo: "VulnRadar/vulnradar.dev",
  discord_invite_url: "https://discord.gg/Y7R6hdGbNe",
  support_email: "support@vulnradar.dev",
  legal_email: "legal@vulnradar.dev",
  security_email: "security@vulnradar.dev",
  enterprise_email: "enterprise@vulnradar.dev",
  noreply_email: "noreply@vulnradar.dev",
  terms_updated_at: "2026-03-16",
}

// Check if we're in an environment where fs is NOT available
function isEdgeOrBrowser(): boolean {
  if (typeof window !== "undefined") return true
  if (typeof globalThis !== "undefined" && "EdgeRuntime" in globalThis) return true
  return false
}

// Simple YAML parser for our specific config structure
// Only runs on server where fs is available
function parseConfigYaml(): Record<string, unknown> | null {
  if (isEdgeOrBrowser()) return null

  try {
    // Dynamic require to avoid bundling issues
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs")
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path")

    const configPath = path.join(process.cwd(), "config.yaml")
    if (!fs.existsSync(configPath)) return null

    const content = fs.readFileSync(configPath, "utf-8")

    // Parse specific values we need using regex
    const getValue = (key: string): string | null => {
      const regex = new RegExp(`^\\s*${key}:\\s*["']?([^"'\\n#]+)["']?`, "m")
      const match = content.match(regex)
      return match ? match[1].trim() : null
    }

    return {
      app: {
        name: getValue("name"),
        slug: getValue("slug"),
        version: getValue("version"),
        engine_version: getValue("engine_version"),
        api_version: getValue("api_version"),
        description: getValue("description"),
        total_checks_label: getValue("total_checks_label"),
        url: getValue("url"),
        repo: getValue("repo"),
        discord_invite_url: getValue("discord_invite_url"),
        support_email: getValue("support_email"),
        legal_email: getValue("legal_email"),
        security_email: getValue("security_email"),
        enterprise_email: getValue("enterprise_email"),
        noreply_email: getValue("noreply_email"),
        terms_updated_at: getValue("terms_updated_at"),
      },
    }
  } catch {
    return null
  }
}

// Cache the parsed config
let _configValues: Record<string, unknown> | null = null
let _configLoaded = false

function getConfigValues(): Record<string, unknown> {
  if (!_configLoaded) {
    _configValues = parseConfigYaml()
    _configLoaded = true
  }
  return _configValues || {}
}

// ============================================================================
// EXPORTED VALUES - These are the actual config values
// ============================================================================

const config = getConfigValues()
const app = (config.app as Record<string, string | null>) || {}

// Helper to get value with Edge Runtime fallback
function getVal(key: keyof typeof EDGE_DEFAULTS): string {
  // First check environment variables (allows runtime override)
  const envKey = `VULNRADAR_${key.toUpperCase()}`
  if (typeof process !== "undefined" && process.env && process.env[envKey]) {
    return process.env[envKey] as string
  }
  // Then try config.yaml value
  if (app[key] && app[key] !== null) {
    return app[key] as string
  }
  // Finally use hardcoded default (for Edge Runtime)
  return EDGE_DEFAULTS[key]
}

// App metadata
export const CONFIG_APP_NAME = getVal("name")
export const CONFIG_APP_SLUG = getVal("slug")
export const CONFIG_APP_VERSION = getVal("version")
export const CONFIG_ENGINE_VERSION = getVal("engine_version")
export const CONFIG_API_VERSION = getVal("api_version")
export const CONFIG_APP_DESCRIPTION = getVal("description")
export const CONFIG_TOTAL_CHECKS_LABEL = getVal("total_checks_label")
export const CONFIG_APP_URL = getVal("url")
export const CONFIG_APP_REPO = getVal("repo")
export const CONFIG_DISCORD_INVITE_URL = getVal("discord_invite_url")

// Emails
export const CONFIG_SUPPORT_EMAIL = getVal("support_email")
export const CONFIG_LEGAL_EMAIL = getVal("legal_email")
export const CONFIG_SECURITY_EMAIL = getVal("security_email")
export const CONFIG_ENTERPRISE_EMAIL = getVal("enterprise_email")
export const CONFIG_NOREPLY_EMAIL = getVal("noreply_email")
export const CONFIG_TERMS_UPDATED_AT = getVal("terms_updated_at")
