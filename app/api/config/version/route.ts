import { NextResponse } from "next/server"
import fs from "fs"
import path from "path"

// In-memory cache (lost on restart, which is fine)
let cachedVersion: { app: string; engine: string } | null = null

export async function GET() {
  // Return cached version if available
  if (cachedVersion) {
    return NextResponse.json(cachedVersion)
  }

  try {
    const configPath = path.join(process.cwd(), "config.yaml")
    const content = fs.readFileSync(configPath, "utf-8")
    
    const versionMatch = content.match(/version:\s*["']?([^"'\s]+)["']?/)
    const engineMatch = content.match(/engine_version:\s*["']?([^"'\s]+)["']?/)
    
    const version = versionMatch?.[1] || "unknown"
    const engineVersion = engineMatch?.[1] || "unknown"
    
    // Cache it
    cachedVersion = { app: version, engine: engineVersion }
    
    return NextResponse.json(cachedVersion)
  } catch (err) {
    console.error("[v0] Failed to read version:", err)
    return NextResponse.json(
      { app: "unknown", engine: "unknown" },
      { status: 500 }
    )
  }
}
