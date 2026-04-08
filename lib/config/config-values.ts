// ============================================================================
// CONFIG VALUES - Build-time injected from config.yaml via next.config.mjs
// ============================================================================
// Config values are loaded from config.yaml at BUILD TIME in next.config.mjs
// and injected as NEXT_PUBLIC_CONFIG_* environment variables.
// This ensures values work in ALL runtimes: Node.js, Edge (middleware), and browser.
// 
// Self-hosters: Edit config.yaml and rebuild - values are read at build time.
// No hardcoding, no runtime file access needed.
// ============================================================================

// Helper to safely get env var value
function getEnv(key: string): string {
  if (typeof process !== "undefined" && process.env) {
    return process.env[key] || ""
  }
  return ""
}

// ============================================================================
// EXPORTED VALUES - Read from build-time injected environment variables
// ============================================================================

// App metadata - These come from config.yaml via next.config.mjs build-time injection
export const CONFIG_APP_NAME = getEnv("NEXT_PUBLIC_CONFIG_APP_NAME")
export const CONFIG_APP_SLUG = getEnv("NEXT_PUBLIC_CONFIG_APP_SLUG")
export const CONFIG_APP_VERSION = getEnv("NEXT_PUBLIC_CONFIG_APP_VERSION")
export const CONFIG_ENGINE_VERSION = getEnv("NEXT_PUBLIC_CONFIG_ENGINE_VERSION")
export const CONFIG_API_VERSION = getEnv("NEXT_PUBLIC_CONFIG_API_VERSION")
export const CONFIG_APP_DESCRIPTION = getEnv("NEXT_PUBLIC_CONFIG_APP_DESCRIPTION")
export const CONFIG_TOTAL_CHECKS_LABEL = getEnv("NEXT_PUBLIC_CONFIG_TOTAL_CHECKS_LABEL")
export const CONFIG_APP_URL = getEnv("NEXT_PUBLIC_CONFIG_APP_URL")
export const CONFIG_APP_REPO = getEnv("NEXT_PUBLIC_CONFIG_APP_REPO")
export const CONFIG_DISCORD_INVITE_URL = getEnv("NEXT_PUBLIC_CONFIG_DISCORD_INVITE_URL")

// Emails
export const CONFIG_SUPPORT_EMAIL = getEnv("NEXT_PUBLIC_CONFIG_SUPPORT_EMAIL")
export const CONFIG_LEGAL_EMAIL = getEnv("NEXT_PUBLIC_CONFIG_LEGAL_EMAIL")
export const CONFIG_SECURITY_EMAIL = getEnv("NEXT_PUBLIC_CONFIG_SECURITY_EMAIL")
export const CONFIG_ENTERPRISE_EMAIL = getEnv("NEXT_PUBLIC_CONFIG_ENTERPRISE_EMAIL")
export const CONFIG_NOREPLY_EMAIL = getEnv("NEXT_PUBLIC_CONFIG_NOREPLY_EMAIL")
export const CONFIG_TERMS_UPDATED_AT = getEnv("NEXT_PUBLIC_CONFIG_TERMS_UPDATED_AT")
