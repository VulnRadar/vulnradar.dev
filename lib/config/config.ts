// ============================================================================
// Configuration Loader (Works in both Server and Client)
// ============================================================================
// Loads configuration from hardcoded defaults in lib/config/config-values.ts
// All values can be customized by editing config-values.ts directly.
// ============================================================================

import { VulnRadarConfig, DEFAULT_CONFIG } from "../types/config"

// Config loading state
let _config: VulnRadarConfig | null = null
let _configLoadError: string | null = null

// Clear config cache (useful for development hot reloads)
export function clearConfigCache() {
  _config = null
  _configLoadError = null
}

/**
 * Load configuration from hardcoded defaults
 * All config is now from lib/config/config-values.ts
 */
export function loadConfig(): VulnRadarConfig {
  // In development, skip cache to pick up config changes without restart
  if (_config && process.env.NODE_ENV !== "development") return _config

  try {
    _config = DEFAULT_CONFIG
    return _config
  } catch (_error) {
    _configLoadError = error instanceof Error ? error.message : "Unknown error"
    if (process.env.NODE_ENV === "development") {
      console.error(`[Config] Error loading config: ${_configLoadError}`)
      console.warn("[Config] Using defaults")
    }
    _config = DEFAULT_CONFIG
    return _config
  }
}

/**
 * Get the current configuration
 * Loads config if not already loaded
 */
export function getConfig(): VulnRadarConfig {
  if (!_config) {
    return loadConfig()
  }
  return _config
}

/**
 * Get a specific config value with type safety
 */
export function getConfigValue<K extends keyof VulnRadarConfig>(key: K): VulnRadarConfig[K] {
  return getConfig()[key]
}

/**
 * Check if config loaded successfully
 */
export function getConfigError(): string | null {
  return _configLoadError
}

/**
 * Force reload config (useful for testing)
 */
export function reloadConfig(): VulnRadarConfig {
  _config = null
  _configLoadError = null
  return loadConfig()
}

// ============================================================================
// Convenience Exports
// ============================================================================

// Export the config object directly for easy access
export const CONFIG = getConfig()

// Re-export types
export type { VulnRadarConfig } from "../types/config"
