// Server-side version fetcher - no React hooks
// Reads from config.yaml directly on server
// cache-bust: rebuild

interface Version {
  current: string
  engine: string
  latest: string | null
  status: "up-to-date" | "behind" | "ahead" | "unknown"
  message: string
}

let versionCache: Version | null = null

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

export function getVersionSync(): Version {
  if (versionCache) {
    return versionCache
  }
  
  // On server, read from config.yaml directly
  if (typeof window === "undefined") {
    versionCache = readVersionFromConfig()
    return versionCache
  }
  
  // On client, return placeholder (should use useVersion hook instead)
  return {
    current: "loading",
    engine: "loading",
    latest: null,
    status: "unknown",
    message: "Use useVersion hook on client"
  }
}

export function getScanNote(): string {
  const v = getVersionSync()
  return `VulnRadar v${v.current} (Detection Engine v${v.engine})`
}
