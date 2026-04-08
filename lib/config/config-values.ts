// ============================================================================
// CONFIG VALUES - Direct config.yaml reader with NO dependencies
// ============================================================================
// This file reads config.yaml directly without importing from other modules.
// It's the foundation that constants.ts and DEFAULT_CONFIG can safely import.
// ============================================================================

// Simple YAML parser for our specific config structure
// Only runs on server where fs is available
function parseConfigYaml(): Record<string, unknown> | null {
  // Check if we're in a server environment with fs access
  if (typeof window !== "undefined") return null
  if (typeof globalThis !== "undefined" && "EdgeRuntime" in globalThis) return null

  try {
    // Dynamic require to avoid bundling issues
    const fs = require("fs")
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

// App metadata - N/A indicates config.yaml read failure
export const CONFIG_APP_NAME = app.name || "N/A"
export const CONFIG_APP_SLUG = app.slug || "N/A"
export const CONFIG_APP_VERSION = app.version || "N/A"
export const CONFIG_ENGINE_VERSION = app.engine_version || "N/A"
export const CONFIG_APP_DESCRIPTION = app.description || "N/A"
export const CONFIG_TOTAL_CHECKS_LABEL = app.total_checks_label || "N/A"
export const CONFIG_APP_URL = app.url || "N/A"
export const CONFIG_APP_REPO = app.repo || "N/A"
export const CONFIG_DISCORD_INVITE_URL = app.discord_invite_url || "N/A"

// Emails - N/A indicates config.yaml read failure
export const CONFIG_SUPPORT_EMAIL = app.support_email || "N/A"
export const CONFIG_LEGAL_EMAIL = app.legal_email || "N/A"
export const CONFIG_SECURITY_EMAIL = app.security_email || "N/A"
export const CONFIG_ENTERPRISE_EMAIL = app.enterprise_email || "N/A"
export const CONFIG_NOREPLY_EMAIL = app.noreply_email || "N/A"
export const CONFIG_TERMS_UPDATED_AT = app.terms_updated_at || "N/A"
