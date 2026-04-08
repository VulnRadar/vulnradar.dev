import fs from 'fs'
import path from 'path'

// ============================================================================
// BUILD-TIME CONFIG LOADING
// ============================================================================
// Read config.yaml at build time and inject values as environment variables.
// This ensures config values are available in ALL runtimes (Edge, browser, server).
// Self-hosters: Edit config.yaml and rebuild - no hardcoding needed.
// ============================================================================

function loadConfigYaml() {
  try {
    const configPath = path.join(process.cwd(), 'config.yaml')
    if (!fs.existsSync(configPath)) {
      console.warn('[next.config.mjs] config.yaml not found, using empty config')
      return {}
    }
    
    const content = fs.readFileSync(configPath, 'utf-8')
    
    // Simple YAML parser for key: "value" pairs
    const getValue = (key) => {
      const regex = new RegExp(`^\\s*${key}:\\s*["']?([^"'\\n#]+)["']?`, 'm')
      const match = content.match(regex)
      return match ? match[1].trim() : null
    }
    
    return {
      name: getValue('name'),
      slug: getValue('slug'),
      version: getValue('version'),
      engine_version: getValue('engine_version'),
      api_version: getValue('api_version'),
      description: getValue('description'),
      total_checks_label: getValue('total_checks_label'),
      url: getValue('url'),
      repo: getValue('repo'),
      discord_invite_url: getValue('discord_invite_url'),
      support_email: getValue('support_email'),
      legal_email: getValue('legal_email'),
      security_email: getValue('security_email'),
      enterprise_email: getValue('enterprise_email'),
      noreply_email: getValue('noreply_email'),
      terms_updated_at: getValue('terms_updated_at'),
      logo_url: getValue('logo_url'),
      primary_color: getValue('primary_color'),
      footer_text: getValue('footer_text'),
    }
  } catch (error) {
    console.error('[next.config.mjs] Error loading config.yaml:', error.message)
    return {}
  }
}

const yamlConfig = loadConfigYaml()

// Inject config values as environment variables at build time
// These will be available in ALL runtimes including Edge and browser
const configEnv = {
  NEXT_PUBLIC_CONFIG_APP_NAME: yamlConfig.name || '',
  NEXT_PUBLIC_CONFIG_APP_SLUG: yamlConfig.slug || '',
  NEXT_PUBLIC_CONFIG_APP_VERSION: yamlConfig.version || '',
  NEXT_PUBLIC_CONFIG_ENGINE_VERSION: yamlConfig.engine_version || '',
  NEXT_PUBLIC_CONFIG_API_VERSION: yamlConfig.api_version || '',
  NEXT_PUBLIC_CONFIG_APP_DESCRIPTION: yamlConfig.description || '',
  NEXT_PUBLIC_CONFIG_TOTAL_CHECKS_LABEL: yamlConfig.total_checks_label || '',
  NEXT_PUBLIC_CONFIG_APP_URL: yamlConfig.url || '',
  NEXT_PUBLIC_CONFIG_APP_REPO: yamlConfig.repo || '',
  NEXT_PUBLIC_CONFIG_DISCORD_INVITE_URL: yamlConfig.discord_invite_url || '',
  NEXT_PUBLIC_CONFIG_SUPPORT_EMAIL: yamlConfig.support_email || '',
  NEXT_PUBLIC_CONFIG_LEGAL_EMAIL: yamlConfig.legal_email || '',
  NEXT_PUBLIC_CONFIG_SECURITY_EMAIL: yamlConfig.security_email || '',
  NEXT_PUBLIC_CONFIG_ENTERPRISE_EMAIL: yamlConfig.enterprise_email || '',
  NEXT_PUBLIC_CONFIG_NOREPLY_EMAIL: yamlConfig.noreply_email || '',
  NEXT_PUBLIC_CONFIG_TERMS_UPDATED_AT: yamlConfig.terms_updated_at || '',
  NEXT_PUBLIC_CONFIG_LOGO_URL: yamlConfig.logo_url || '',
  NEXT_PUBLIC_CONFIG_PRIMARY_COLOR: yamlConfig.primary_color || '',
  NEXT_PUBLIC_CONFIG_FOOTER_TEXT: yamlConfig.footer_text || '',
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
