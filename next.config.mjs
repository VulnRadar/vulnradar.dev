/** @type {import('next').NextConfig} */

const nextConfig = {
  // No `output: "standalone"` so `next start` works for non-Docker
  // deployments (Vercel, bare Node, local prod-like). For Docker
  // deployments, the Dockerfile copies .next + node_modules instead of
  // relying on a standalone bundle: the image is larger but `npm start`
  // works the same everywhere.
  serverExternalPackages: ["fs", "path"],
  // Development-only routes. A file named `page.dev.tsx` is a page outside
  // production and nothing at all inside it, so app/dev/modals (the modal
  // workbench, which renders every dialog in the product on demand including
  // the admin ones) is absent from the production route list rather than
  // present and 404ing. Its component chunk is never emitted either.
  //
  // The workbench's own `process.env.NODE_ENV === "production"` guard stays as
  // the second layer: this list is the kind of thing a future edit reorders
  // without noticing. tests/app/dev-modals-gate.test.ts asserts both, plus that
  // "/dev" is not in PUBLIC_PATHS and is in DISALLOWED_PATHS.
  pageExtensions: [
    "tsx",
    "ts",
    "jsx",
    "js",
    ...(process.env.NODE_ENV === "production" ? [] : ["dev.tsx"]),
  ],
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
    if (
      process.env.DISABLE_CSP === "1" &&
      process.env.NODE_ENV === "production"
    ) {
      throw new Error(
        "DISABLE_CSP=1 is not allowed in production. Remove it from your environment before deploying.",
      );
    }
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
          // NOTE: Content-Security-Policy and Permissions-Policy are NOT set
          // here. middleware.ts is the single source of truth for the
          // per-request nonce CSP (and the fuller Permissions-Policy).
          // Declaring them here too shipped a SECOND, drifted copy: this
          // headers() block applies to every response, Next.js does not
          // de-duplicate (see the Cross-Origin-Embedder-Policy note below,
          // where a doubled header was confirmed in a real prod scan), and
          // the old static CSP still carried 'unsafe-inline'/'unsafe-eval'
          // and had drifted out of sync with the real allowlist (missing
          // js.stripe.com, the OAuth avatar hosts, the IPv4-echo origin), so
          // where both applied their intersection could silently break Stripe
          // and avatars, and where only the static one survived it undid the
          // nonce hardening. This block now carries only the headers that must
          // also cover the static assets middleware's matcher skips
          // (_next/static, images), each identical to middleware's value.
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
          // Permissions-Policy is set per-request in middleware.ts (the fuller
          // policy, which also disables interest-cohort/browsing-topics), so it
          // is not duplicated here. X-XSS-Protection is gone entirely: the
          // browser XSS auditor it controlled was removed from Chrome/Edge and
          // never existed in Firefox, so it is a dead header our own scanner
          // flags as deprecated -- CSP is the real XSS mitigation.
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            key: "X-DNS-Prefetch-Control",
            value: "off",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // Cross-Origin-Embedder-Policy intentionally NOT set here.
          // middleware.ts's applySecurityHeaders already sets it
          // ("unsafe-none" -- see that file's own comment: credentialless
          // was already tried and reverted after it broke the BrowserBase
          // live-view iframe in real Firefox testing) on every request via
          // response.headers.set(). A prior version of this file also
          // declared it here on the assumption that middleware's value
          // "always wins" over this config-level one -- a real production
          // scan proved that wrong: Next.js applies both, and the client
          // received the header TWICE ("unsafe-none, unsafe-none"), not
          // once. Removing the duplicate declaration here, not middleware's
          // (middleware re-evaluates on every request in production; this
          // config only applies at build time -- see the DISABLE_CSP guard
          // above for the same reasoning).
          // Expect-CT is set in middleware.ts, not here -- same
          // single-source-of-truth reasoning as Cross-Origin-Embedder-Policy
          // above (this config only applies at build time, middleware
          // re-evaluates every request). It IS sent despite most modern
          // browsers ignoring it (Chrome dropped support in 107); see
          // middleware.ts's comment for why it's still worth sending.
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
