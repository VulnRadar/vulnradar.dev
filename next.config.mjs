/** @type {import('next').NextConfig} */
// cache-bust: force rebuild after dependency fix

const nextConfig = {
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
