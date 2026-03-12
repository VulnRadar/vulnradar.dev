// ============================================================================
// Configuration Loader (Works in both Server and Client)
// ============================================================================
// Loads config from config.yaml with validation and fallback to defaults.
// On the server, reads from filesystem. In the browser, uses defaults only.
// ============================================================================

// Helper to check if we're in browser or edge runtime
function isClientOrEdge(): boolean {
  if (typeof window !== "undefined") return true
  if (typeof globalThis !== "undefined" && "EdgeRuntime" in globalThis) return true
  return false
}

// Dynamically load fs functions only on Node.js server
// This avoids webpack/next static analysis issues
function getNodeFs(): {
  readFileSync: (path: string, encoding: string) => string
  existsSync: (path: string) => boolean
  join: (...paths: string[]) => string
  cwd: () => string
} | null {
  if (isClientOrEdge()) return null
  
  try {
    // Dynamic import using Function constructor to completely bypass static analysis
    const requireFn = new Function("moduleName", "return require(moduleName)")
    const fs = requireFn("fs")
    const path = requireFn("path")
    const cwd = () => requireFn("process").cwd()
    
    return {
      readFileSync: fs.readFileSync,
      existsSync: fs.existsSync,
      join: path.join,
      cwd,
    }
  } catch {
    return null
  }
}

import { VulnRadarConfig, DEFAULT_CONFIG } from "./types/config"

// YAML parser - simple implementation for our config structure
function parseYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = content.split("\n")
  const stack: { obj: Record<string, unknown>; indent: number }[] = [{ obj: result, indent: -1 }]
  
  for (const line of lines) {
    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith("#")) continue
    
    // Calculate indentation
    const indent = line.search(/\S/)
    const trimmed = line.trim()
    
    // Skip lines that are just dashes (array items we'll handle differently)
    if (trimmed === "-") continue
    
    // Handle array items
    if (trimmed.startsWith("- ")) {
      const value = trimmed.slice(2).trim().replace(/^["']|["']$/g, "")
      const parent = stack[stack.length - 1]
      const keys = Object.keys(parent.obj)
      const lastKey = keys[keys.length - 1]
      if (lastKey && Array.isArray(parent.obj[lastKey])) {
        (parent.obj[lastKey] as unknown[]).push(value)
      }
      continue
    }
    
    // Parse key: value
    const colonIndex = trimmed.indexOf(":")
    if (colonIndex === -1) continue
    
    const key = trimmed.slice(0, colonIndex).trim()
    const rawValue = trimmed.slice(colonIndex + 1).trim()
    
    // Pop stack to correct level
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop()
    }
    
    const current = stack[stack.length - 1].obj
    
    if (rawValue === "" || rawValue === "|") {
      // Nested object or empty - check next line for array
      const nextLineIndex = lines.indexOf(line) + 1
      if (nextLineIndex < lines.length) {
        const nextLine = lines[nextLineIndex].trim()
        if (nextLine.startsWith("- ")) {
          current[key] = []
        } else {
          current[key] = {}
        }
      } else {
        current[key] = {}
      }
      stack.push({ obj: current[key] as Record<string, unknown>, indent })
    } else {
      // Parse value
      let value: unknown = rawValue
      
      // Remove quotes
      if ((rawValue.startsWith('"') && rawValue.endsWith('"')) || 
          (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
        value = rawValue.slice(1, -1)
      }
      // Parse booleans
      else if (rawValue === "true") value = true
      else if (rawValue === "false") value = false
      // Parse numbers
      else if (/^-?\d+$/.test(rawValue)) value = parseInt(rawValue, 10)
      else if (/^-?\d+\.\d+$/.test(rawValue)) value = parseFloat(rawValue)
      
      current[key] = value
    }
  }
  
  return result
}

// Deep merge two objects
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target }
  
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceVal = source[key]
      const targetVal = target[key]
      
      if (
        sourceVal !== null &&
        typeof sourceVal === "object" &&
        !Array.isArray(sourceVal) &&
        targetVal !== null &&
        typeof targetVal === "object" &&
        !Array.isArray(targetVal)
      ) {
        result[key] = deepMerge(
          targetVal as Record<string, unknown>,
          sourceVal as Record<string, unknown>
        ) as T[Extract<keyof T, string>]
      } else if (sourceVal !== undefined) {
        result[key] = sourceVal as T[Extract<keyof T, string>]
      }
    }
  }
  
  return result
}

// Validate config structure
function validateConfig(config: unknown): config is Partial<VulnRadarConfig> {
  if (typeof config !== "object" || config === null) {
    return false
  }
  return true
}

// Config loading state
let _config: VulnRadarConfig | null = null
let _configLoadError: string | null = null

/**
 * Load configuration from config.yaml
 * Falls back to defaults if file is missing or invalid
 */
export function loadConfig(): VulnRadarConfig {
  if (_config) return _config
  
  // Get Node.js fs functions (returns null in browser/edge)
  const nodeFs = getNodeFs()
  
  // If running in browser or Edge Runtime (no fs access), use defaults immediately
  if (!nodeFs) {
    _config = DEFAULT_CONFIG
    return _config
  }
  
  try {
    // Try multiple possible paths for config.yaml
    const currentDir = nodeFs.cwd()
    const possiblePaths = [
      nodeFs.join(currentDir, "config.yaml"),
      nodeFs.join(currentDir, "config.yml"),
    ]
    
    let configPath: string | null = null
    for (const p of possiblePaths) {
      if (nodeFs.existsSync(p)) {
        configPath = p
        break
      }
    }
    
    if (!configPath) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[Config] No config.yaml found, using defaults")
      }
      _config = DEFAULT_CONFIG
      return _config
    }
    
    const content = nodeFs.readFileSync(configPath, "utf-8")
    const parsed = parseYaml(content)
    
    if (!validateConfig(parsed)) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[Config] Invalid config.yaml structure, using defaults")
      }
      _config = DEFAULT_CONFIG
      return _config
    }
    
    // Merge with defaults to ensure all required fields exist
    _config = deepMerge(DEFAULT_CONFIG, parsed as Partial<VulnRadarConfig>)
    
    // Only log in development to reduce console spam during build
    if (process.env.NODE_ENV === "development") {
      console.log(`[Config] Loaded from ${configPath}`)
    }
    return _config
    
  } catch (error) {
    _configLoadError = error instanceof Error ? error.message : "Unknown error"
    if (process.env.NODE_ENV === "development") {
      console.error(`[Config] Error loading config: ${_configLoadError}`)
      console.warn("[Config] Falling back to defaults")
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
export type { VulnRadarConfig } from "./types/config"
