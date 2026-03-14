/** @type {import('next').NextConfig} */
// cache-bust: force rebuild after dependency fix

import { readFileSync, existsSync } from "fs"
import { join } from "path"

// Read version from config.yaml at build time so it's available on the client
function readVersionFromConfig() {
  const configPath = join(process.cwd(), "config.yaml")
  if (!existsSync(configPath)) {
    console.error("⚠️  config.yaml not found - cannot determine version")
    process.exit(1)
  }
  try {
    const content = readFileSync(configPath, "utf-8")
    const versionMatch = content.match(/version:\s*["']?([^"'\s]+)["']?/)
    const engineMatch = content.match(/engine_version:\s*["']?([^"'\s]+)["']?/)
    
    if (!versionMatch?.[1]) {
      console.error("⚠️  app version not found in config.yaml")
      process.exit(1)
    }
    if (!engineMatch?.[1]) {
      console.error("⚠️  engine_version not found in config.yaml")
      process.exit(1)
    }
    
    return {
      version: versionMatch[1],
      engineVersion: engineMatch[1],
    }
  } catch (err) {
    console.error(`⚠️  Failed to read version from config.yaml: ${err.message}`)
    process.exit(1)
  }
}

let { version, engineVersion } = { version: undefined, engineVersion: undefined }
try {
  const versionInfo = readVersionFromConfig()
  version = versionInfo.version
  engineVersion = versionInfo.engineVersion
} catch {
  // Versions will be handled by env var fallback if available
}

const nextConfig = {
  env: version && engineVersion ? {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_ENGINE_VERSION: engineVersion,
  } : {},
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
                // Removed trailing 'https:' wildcard — now explicit domains only
                "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://static.cloudflareinsights.com https://embed.tawk.to https://*.tawk.to; " +
                "script-src-elem 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com https://embed.tawk.to https://*.tawk.to; " +
                // Removed trailing 'https:' wildcard from style-src
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
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          {
            key: "X-XSS-Protection",
            value: "1; mode=block",
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
          {
            // Changed from "off" to "on" — scanner flagged "off" as a performance issue
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "unsafe-none",
          },
          // Removed Expect-CT — deprecated since 2022, ignored by modern browsers
          {
            // Added: requests per-origin process isolation
            key: "Origin-Agent-Cluster",
            value: "?1",
          },
          {
            // Added: missing Document-Policy header
            key: "Document-Policy",
            value: "force-load-at-top",
          },
        ],
      },
    ]
  },
}

export default nextConfig
