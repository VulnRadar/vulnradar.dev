/** @type {import('next').NextConfig} */

const nextConfig = {
  // No `output: "standalone"` so `next start` works for non-Docker
  // deployments (Vercel, bare Node, local prod-like). For Docker
  // deployments, the Dockerfile copies .next + node_modules instead of
  // relying on a standalone bundle — image is larger but `npm start`
  // works the same everywhere.
  serverExternalPackages: ["fs", "path"],
  typescript: {
    // removed `ignoreBuildErrors: true`. Typecheck errors
    // must block the build. CI runs `tsc --noEmit` separately as a hard
    // gate; allowing the build to swallow type errors would silently ship
    // broken code.
  },
  eslint: {
    // Skip Next.js's internal linter during `next build`. We run ESLint
    // separately via `npm run lint` (and the pre-existing `lint` CI step
    // runs the same). Next.js's bundled linter can't reliably detect the
    // Next.js plugin when using @eslint/eslintrc's FlatCompat shim
    // (a known false positive until Next.js 16 ships native flat config),
    // which makes the "Next.js plugin was not detected" warning noisy.
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true,
  },
  // infra: explicitly disable browser source maps in prod. Default is
  // already false for App Router, but making it explicit prevents
  // accidental re-enablement via future config additions.
  productionBrowserSourceMaps: false,
  poweredByHeader: false,
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    return config;
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
    ];
  },
  async headers() {
    // Set DISABLE_CSP=1 in .env.local to ship the app without any
    // security headers. Useful when debugging a third-party embed
    // (BrowserBase, Turnstile, etc.) and you want to confirm whether
    // CSP/CORP/COOP is the blocker. Self-hosters: leave it unset.
    if (process.env.DISABLE_CSP === "1") {
      // Next.js requires at least one header in the array, so we ship
      // a harmless debug marker that confirms the flag is active.
      return [
        {
          source: "/(.*)",
          headers: [{ key: "X-Debug-Csp-Disabled", value: "1" }],
        },
      ];
    }
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; " +
              // Removed trailing 'https:' wildcard — now explicit domains only
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://static.cloudflareinsights.com https://embed.tawk.to https://*.tawk.to https://www.browserbase.com; " +
              "script-src-elem 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com https://embed.tawk.to https://*.tawk.to https://www.browserbase.com; " +
              // Removed trailing 'https:' wildcard from style-src
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://embed.tawk.to https://*.tawk.to https://www.browserbase.com 'unsafe-inline'; " +
              "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com https://embed.tawk.to https://*.tawk.to https://www.browserbase.com; " +
              "font-src 'self' https://fonts.gstatic.com https://static.cloudflareinsights.com https://www.browserbase.com; " +
              "img-src 'self' data: blob: https: https://www.browserbase.com; " +
              // BrowserBase: the live-view iframe connects to
              // wss://connect.{region}.browserbase.com/. We also need
              // connect-src https://api.browserbase.com for the popup
              // to call /api/v3/browser/sessions. Must be a separate
              // origin from app, but we list it explicitly.
              // headers: the trailing `https: wss:` scheme wildcards
              // were the previous default. They let XHR/fetch go to
              // ANY HTTPS origin on the internet — fine for development
              // but defeats the XSS-exfiltration isolation CSP provides.
              // Allowlist the specific API hosts the app actually calls
              // (Stripe Checkout API + dashboard, Turnstile verify,
              // Tawk.to, BrowserBase). Self-hosters using more
              // integrations should add them here.
              "connect-src 'self' https://challenges.cloudflare.com https://embed.tawk.to https://*.tawk.to https://va.tawk.to https://static.cloudflareinsights.com https://api.browserbase.com wss://*.browserbase.com https://api.stripe.com; " +
              "frame-src https://challenges.cloudflare.com https://embed.tawk.to https://*.tawk.to https://www.browserbase.com; " +
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
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
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
    ];
  },
};

export default nextConfig;
