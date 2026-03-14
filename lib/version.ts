// Server-side version fetcher - no React hooks
// Reads from config.yaml directly on server at module load time

interface Version {
  current: string
  engine: string
  latest: string | null
  status: "up-to-date" | "behind" | "ahead" | "unknown"
  message: string
}

// Server-side: Read directly from config.yaml
function readVersionFromConfig(): Version {
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
      
      if (versionMatch?.[1] && engineMatch?.[1]) {
        return {
          current: versionMatch[1],
          engine: engineMatch[1],
          latest: null,
          status: "unknown",
          message: "Loaded from config.yaml"
        }
      }
    }
  } catch {
    // Fall through to default
  }
  
  return {
    current: "unknown",
    engine: "unknown", 
    latest: null,
    status: "unknown",
    message: "Could not read config.yaml"
  }
}

// Initialize cache IMMEDIATELY at module load time on server
// This ensures versions are always available before any code runs
const versionCache: Version = typeof window === "undefined" 
  ? readVersionFromConfig()
  : { current: "2.0.1", engine: "2.0.1", latest: null, status: "unknown", message: "Client fallback" }

export function getVersionSync(): Version {
  return versionCache
}

export function getScanNote(): string {
  return `VulnRadar v${versionCache.current} (Detection Engine v${versionCache.engine})`
}
