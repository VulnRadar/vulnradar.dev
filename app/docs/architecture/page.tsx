"use client";

import { useEffect, useRef } from "react";
import { useDocsContext, type TocItem } from "../layout";
import {
  DocsHero,
  DocsSection,
  DocsSubSection,
  DocsCallout,
  CodeBlock,
} from "@/components/docs";

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "layout", label: "Project Layout" },
  { id: "subsystems", label: "Key Subsystems" },
  { id: "config", label: "Configuration", level: 2 },
  { id: "database", label: "Database", level: 2 },
  { id: "auth", label: "Authentication", level: 2 },
  { id: "scanner", label: "Scanner Engine", level: 2 },
  { id: "api", label: "API Layer", level: 2 },
  { id: "billing", label: "Billing", level: 2 },
  { id: "permissions", label: "Permissions", level: 2 },
  { id: "lifecycle", label: "Request Lifecycle" },
  { id: "cicd", label: "CI/CD" },
];

export default function ArchitecturePage() {
  const { setActiveSection, setTocItems } = useDocsContext();
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    setTocItems(tocItems);
    return () => setTocItems([]);
  }, [setTocItems]);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        });
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    );
    tocItems.forEach((item) => {
      const el = document.getElementById(item.id);
      if (el) observerRef.current?.observe(el);
    });
    return () => observerRef.current?.disconnect();
  }, [setActiveSection]);

  return (
    <div className="space-y-16">
      <DocsHero
        badge="Internals"
        title="Architecture"
        description="A tour of the VulnRadar codebase: how the pieces fit together, where config lives, and how a request flows from browser to database."
      />

      <DocsSection id="overview" title="Overview">
        <p>
          VulnRadar is a <strong>Next.js 15 App Router</strong> application with
          a single-process deployment. The runtime stack is deliberately small:
          one Next.js process + one PostgreSQL database. No Redis, no message
          broker, no separate API server. Everything you need to understand
          lives in this repository.
        </p>
        <DocsCallout variant="info" title="Single source of truth">
          Almost every tunable lives in <code>lib/config/config-values.ts</code>
          . The rest of the config system is built from those constants. Edit
          there, not in random files.
        </DocsCallout>
      </DocsSection>

      <DocsSection id="layout" title="Project Layout">
        <CodeBlock
          language="text"
          code={`vulnradar.dev/
├── app/                          # Next.js App Router
│   ├── (root pages)              # /, /landing, /pricing, /demo, /contact, /donate
│   ├── admin/                    # Admin dashboard (staff-gated)
│   ├── api/v2/                   # REST API v2 (and /api/security-txt, /api/version)
│   ├── dashboard/                # User dashboard (authenticated)
│   ├── docs/                     # This documentation site
│   ├── history/                  # Scan history (authenticated)
│   ├── legal/                    # Terms, privacy, etc.
│   ├── login, signup,            # Auth pages
│   ├── forgot-password,
│   │  reset-password,
│   │  verify-email
│   ├── pricing/                  # Pricing + Stripe checkout
│   ├── profile/                  # User profile
│   ├── shared/[token]/           # Public shared-scan viewer
│   ├── staff/                    # Public staff list
│   └── teams/                    # Team management
│
├── components/                   # React components (mostly client)
│   ├── admin/                    # Admin UI
│   ├── auth/                     # Auth forms
│   ├── badge/                    # Public badge widgets
│   ├── billing/                  # Stripe checkout UI
│   ├── docs/                     # Documentation site components
│   ├── landing/                  # Marketing landing
│   ├── scanner/                  # Scan UI (results, footer)
│   ├── shared/                   # Cross-cutting (notifications, logo)
│   └── ui/                       # shadcn/ui primitives
│
├── lib/                          # Server-side libraries (no React)
│   ├── api/                      # API helpers (Bearer validation, request utils)
│   ├── auth/                     # Sessions, 2FA, password hashing, device trust
│   ├── billing/                  # Stripe + plan catalog
│   ├── config/                   # Configuration system
│   ├── database/                 # PostgreSQL pool, query helpers, cleanup
│   ├── discord/                  # Discord OAuth helpers
│   ├── email/                    # Transactional email (SMTP)
│   ├── features/                 # Feature gating (beta, etc.)
│   ├── notifications/            # In-app + email notification preferences
│   ├── rate-limiting/            # Generic + plan-based rate limits
│   ├── reports/                  # PDF report generation
│   ├── scanner/                  # Detection engine
│   ├── types/                    # Shared TypeScript types
│   └── uploads/                  # Avatar validation
│
├── instrumentation.ts            # Next.js startup hooks (DB init, schema check)
├── middleware.ts                 # Auth + public-path middleware
│
├── public/                       # Static assets
├── scripts/                      # DB migration + audit scripts
│   ├── _lib/                     # Shared helpers
│   ├── create-fresh-db/          # Side-by-side DB clone
│   └── migrate/                  # Schema migrations
│
├── .github/                      # Workflows, dependabot, PR template
├── Dockerfile
├── docker-compose.yml
├── docker-compose.dev.yml
├── next.config.mjs
├── tsconfig.json
├── tailwind.config.ts
├── eslint.config.mjs
├── vitest.config.ts
└── package.json`}
        />
      </DocsSection>

      <DocsSection id="subsystems" title="Key Subsystems">
        <DocsSubSection title="1. Configuration">
          <p>
            See the <a href="/docs/config">Configuration</a> page for full
            details. Flow:
          </p>
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>lib/config/config-values.ts</code> — raw{" "}
              <code>CONFIG_*</code> constants. <strong>Edit this file.</strong>
            </li>
            <li>
              <code>lib/types/config.ts</code> — typed interfaces +{" "}
              <code>DEFAULT_CONFIG</code> assembled from the constants above
            </li>
            <li>
              <code>lib/config/config.ts</code> — cached loader (
              <code>loadConfig</code>, <code>getConfigValue</code>)
            </li>
            <li>
              <code>lib/config/constants.ts</code> — re-exports + derived maps (
              <code>RATE_LIMITS</code>, <code>BILLING_PLAN_LIMITS</code>,{" "}
              <code>ROUTES</code>, <code>API</code>)
            </li>
            <li>
              <code>lib/config/client-constants.ts</code> — client-safe subset
              (no server-only secrets)
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="2. Database">
          <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
            <li>
              <strong>Driver:</strong> <code>pg</code> (the{" "}
              <code>@neondatabase/serverless</code> dependency is installed but
              the app uses node-postgres via <code>lib/database/db.ts</code>)
            </li>
            <li>
              <strong>Pool:</strong> single instance in{" "}
              <code>lib/database/db.ts</code> (max 10, 5s connect timeout,{" "}
              <code>DATABASE_SSL</code>/<code>DATABASE_SSL_CA</code> respected)
            </li>
            <li>
              <strong>Schema:</strong> 34 tables created by{" "}
              <code>instrumentation.ts</code> at app startup using{" "}
              <code>CREATE TABLE IF NOT EXISTS</code>
            </li>
            <li>
              <strong>Schema version gate:</strong>{" "}
              <code>instrumentation.ts</code> reads the{" "}
              <code>vulnradar_schema_meta</code> row and refuses to start if{" "}
              <code>schema_version</code> &lt;{" "}
              <code>CONFIG_MIN_SCHEMA_VERSION</code>
            </li>
            <li>
              <strong>Migration:</strong> <code>npm run db:migrate</code> runs{" "}
              <code>scripts/migrate/migrate.mjs</code> (interactive, with{" "}
              <code>--dry-run</code>)
            </li>
            <li>
              <strong>Side-by-side clone:</strong>{" "}
              <code>npm run db:create</code> runs{" "}
              <code>scripts/create-fresh-db/create-fresh-db.mjs</code>
            </li>
            <li>
              <strong>Drift detector:</strong>{" "}
              <code>npm run audit:v2-tables</code> (in CI) compares{" "}
              <code>instrumentation.ts</code> against{" "}
              <code>scripts/migrate/versions/_snippets.mjs</code>
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="3. Authentication">
          <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
            <li>
              <strong>Sessions:</strong> DB-backed (table <code>sessions</code>
              ), cookie value is a 64-hex random id, httpOnly + sameSite=lax +
              7-day TTL. See <code>lib/auth/auth.ts</code>.
            </li>
            <li>
              <strong>Password hashing:</strong> <code>node:crypto</code> scrypt
              (N=131072, r=8, p=1, 16-byte salt, 64-byte derived key). Format:{" "}
              <code>N:r:p:saltHex:hashHex</code>.
            </li>
            <li>
              <strong>2FA:</strong> hand-rolled TOTP (RFC 6238, SHA-1, 6 digits,
              30s step, ±1 window) in <code>lib/auth/totp.ts</code>. Backup
              codes (8 per user, hashed via scrypt). Email 2FA alternative in{" "}
              <code>lib/email/email.ts</code>.
            </li>
            <li>
              <strong>Password reset / email verify:</strong> 32-byte hex tokens
              stored as <code>sha256(token)</code> in their respective tables;
              lifetimes are <code>CONFIG_PASSWORD_RESET_HOURS=1</code> and{" "}
              <code>CONFIG_EMAIL_VERIFICATION_HOURS=24</code>.
            </li>
            <li>
              <strong>Device trust:</strong> per-device 256-bit random token in{" "}
              <code>device_trust</code>; 30-day cookie. See{" "}
              <code>lib/auth/device-trust.ts</code>.
            </li>
            <li>
              <strong>Discord OAuth:</strong> HMAC-signed state with{" "}
              <code>AUTH_SECRET || API_KEY_ENCRYPTION_KEY</code>, 5-minute TTL.
              Two actions: <code>?action=connect</code> (link existing) and{" "}
              <code>?action=login</code> (sign in via Discord).
            </li>
            <li>
              <strong>API auth:</strong> Bearer API keys with prefix{" "}
              <code>vr_live_</code>; encrypted at rest with AES-256-GCM via{" "}
              <code>lib/auth/crypto.ts</code> using{" "}
              <code>API_KEY_ENCRYPTION_KEY</code> (64 hex chars).
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="4. Scanner Engine">
          <p>The detection engine is split across per-category files:</p>
          <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
            <li>
              <code>lib/scanner/checks/*.ts</code> — 9 per-category detector
              modules (headers, ssl, content, cookies, configuration,
              information-disclosure, code, api, secrets-extended). Each exports{" "}
              <code>detectors: Record&lt;id, EvidenceFn&gt;</code> where{" "}
              <code>EvidenceFn</code> returns <code>string | null</code>.
            </li>
            <li>
              <code>lib/scanner/checks-data/*.json</code> — human-readable
              metadata (title, description, severity, category, fix steps, code
              examples) for every detector. 700+ entries across 12 per-category
              files.
            </li>
            <li>
              <code>lib/scanner/async-checks.ts</code> — network-dependent
              checks run in parallel: DNS (SPF, DMARC, DKIM, DNSSEC via Google +
              Cloudflare DoH), TLS handshake (self-signed / expired / weak
              protocol), live-fetch (robots.txt sensitive paths, security.txt
              presence)
            </li>
            <li>
              <code>lib/scanner/protocols/</code> — protocol-specific warnings:{" "}
              <code>https.ts</code>, <code>websocket.ts</code> (8 check IDs),{" "}
              <code>ftp.ts</code> (4 check IDs),{" "}
              <code>banner.ts</code> (TCP banner-grab for service probes — ssh,
              smtp, imap, pop3, ftp, mongodb)
            </li>
            <li>
              <code>lib/scanner/safe-fetch.ts</code> — SSRF protection: blocks
              private IP ranges, localhost, .local/.internal/.lan hostnames; 15s
              default fetch timeout
            </li>
            <li>
              <code>lib/scanner/access-rules.ts</code> — IP/URL blacklist +
              whitelist from the <code>access_rules</code> table
            </li>
            <li>
              <code>lib/scanner/safety-rating.ts</code> — maps findings to{" "}
              <code>safe</code> / <code>caution</code> / <code>unsafe</code> for
              badges
            </li>
          </ul>
          <p>
            Categories (<code>lib/scanner/types.ts</code>, 12 total):{" "}
            <code>headers</code>, <code>ssl</code>, <code>tls</code>,{" "}
            <code>content</code>, <code>cookies</code>,{" "}
            <code>configuration</code>, <code>information-disclosure</code>,{" "}
            <code>dns</code>, <code>email</code>, <code>api</code>,{" "}
            <code>code</code>, <code>secrets-extended</code>. Severities:{" "}
            <code>info</code>, <code>low</code>, <code>medium</code>,{" "}
            <code>high</code>, <code>critical</code>.
          </p>
          <p>
            Service probes (<code>lib/scanner/protocols/banner.ts</code>) open a
            bounded TCP socket to the target hostname on a well-known or
            user-supplied port, read the greeting, and report version
            disclosure + reachability. The 6 supported probes are:{" "}
            <code>ssh</code>, <code>smtp</code>, <code>imap</code>,{" "}
            <code>pop3</code>, <code>ftp</code>, <code>mongodb</code>. Probes
            are independent of the URL scheme — opt into{" "}
            <code>"probes": ["ssh:2222"]</code> from the dashboard without
            constructing <code>ssh://host</code>.
          </p>
        </DocsSubSection>

        <DocsSubSection title="5. API Layer">
          <p>
            REST v2 is the current API. v1 is <strong>deprecated</strong> with
            sunset 2026-12-01 (see <code>lib/api/api-deprecation.ts</code>).
            Each route handler:
          </p>
          <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
            <li>
              Wraps the body in a try/catch via the{" "}
              <code>withErrorHandling</code> helper (
              <code>lib/api/api-utils.ts</code>)
            </li>
            <li>
              Authenticates via <code>getSession()</code> (cookie) or{" "}
              <code>validateApiKey()</code> (Bearer)
            </li>
            <li>
              Validates input with Zod schemas using the <code>Validate</code>{" "}
              helper
            </li>
            <li>
              Applies a rate limit via <code>checkRateLimit</code> (
              <code>lib/rate-limiting/rate-limit.ts</code>) and/or a daily quota
              via <code>checkAndRecordRequest</code> (
              <code>lib/rate-limiting/daily-limits.ts</code>)
            </li>
            <li>
              Returns <code>NextResponse.json</code> with a standard shape on
              both success and error
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="6. Billing">
          <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
            <li>
              Plans are defined once in <code>lib/billing/catalog.ts</code>:{" "}
              <code>free</code>, <code>core_supporter</code>,{" "}
              <code>pro_supporter</code>, <code>elite_supporter</code>. Each
              paid plan auto-generates monthly + yearly variants (yearly is 20%
              off).
            </li>
            <li>
              Stripe products are auto-created on first call to{" "}
              <code>GET /api/v3/stripe/setup-products</code>; webhooks via{" "}
              <code>GET /api/v3/stripe/setup-webhook</code>
            </li>
            <li>
              Subscription state lives on the <code>users</code> row:{" "}
              <code>plan</code>, <code>stripe_customer_id</code>,{" "}
              <code>stripe_subscription_id</code>,{" "}
              <code>subscription_status</code>, <code>current_period_end</code>,{" "}
              <code>cancel_at_period_end</code>
            </li>
            <li>
              Webhook handler: <code>app/api/v3/webhooks/stripe/route.ts</code>{" "}
              processes <code>checkout.session.completed</code>,{" "}
              <code>customer.subscription.created/updated/deleted</code>, and{" "}
              <code>invoice.payment_succeeded/failed</code>
            </li>
            <li>
              Plan limits and retention windows are in{" "}
              <code>lib/config/config-values.ts</code> under{" "}
              <code>CONFIG_BILLING_*</code>. Disable billing entirely with{" "}
              <code>CONFIG_BILLING_ENABLED = false</code>.
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="7. Permissions">
          <p>
            Role hierarchy (defined in{" "}
            <code>lib/config/client-constants.ts</code>):
          </p>
          <CodeBlock
            language="text"
            code={`user (0) → beta_tester (0) → support (1) → moderator (2) → admin (3)`}
          />
          <ul className="list-disc pl-6 space-y-2 text-muted-foreground mt-3">
            <li>
              <code>lib/auth/permissions.ts</code> — server-safe role +
              permission maps (<code>ROLES</code>, <code>ROLE_PERMISSIONS</code>
              , <code>userHasPermission</code>,<code>canManageRole</code>)
            </li>
            <li>
              <code>lib/auth/permissions-client.ts</code> — mirror for client
              components
            </li>
            <li>
              <code>lib/auth/authorization.ts</code> — route-handler helpers:{" "}
              <code>requireStaff(role?)</code>, <code>requireAdmin()</code>,{" "}
              <code>verifyOwnership(resource, id)</code>,{" "}
              <code>verifyTeamMembership/Admin/Owner</code>,{" "}
              <code>logAuditAction()</code>
            </li>
          </ul>
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="lifecycle" title="Request Lifecycle">
        <CodeBlock
          language="text"
          code={`Browser / client
  │
  ▼
middleware.ts
  - Allow public paths (lib/config/public-paths.ts)
  - For /api/v3/* with Authorization: Bearer … → pass through
    (the route handler performs API-key validation)
  - Otherwise: parse session cookie → look up session row
    - Disabled / expired session → destroy cookie, redirect to /login
  - Inject Cross-Origin-* security headers
  │
  ▼
Route handler (app/api/v3/<resource>/route.ts)
  1. withErrorHandling wrapper
  2. Auth check (getSession OR validateApiKey)
  3. Rate limit check (lib/rate-limiting/rate-limit.ts)
  4. Daily quota check (lib/rate-limiting/daily-limits.ts, API-key + session)
  5. Input validation (Zod via Validate)
  6. Authorization (requireStaff / requireAdmin / verifyOwnership)
  7. Business logic
  8. Database query (lib/database/db.ts)
  9. ApiResponse.json(...)
  │
  ▼
instrumentation.ts (server startup only)
  - Initialize/verify DB schema on first boot
  - Read vulnradar_schema_meta; refuse to start if version < required
  - Add api_keys.key_locator column if missing (v2.3.x delta)`}
        />
      </DocsSection>

      <DocsSection id="cicd" title="CI/CD Pipeline">
        <CodeBlock
          language="text"
          code={`On push to main / PR
  ├── Lint (ESLint 9, flat config in eslint.config.mjs)
  ├── Typecheck (tsc --noEmit, hard gate)
  ├── Test (vitest run)
  ├── Format check (prettier --check)
  └── Build (next build)

On tag v*
  └── Docker publish (ghcr.io/${`<owner>`}/${`<repo>`})

Weekly / on PR
  ├── Stale bot
  ├── Label (PR)
  └── Dependabot → auto-merge patch + minor only`}
        />
        <p className="text-muted-foreground">
          All four checks (<code>lint</code>, <code>typecheck</code>,{" "}
          <code>test</code>, <code>build</code>) run on Node 22 LTS in CI. See{" "}
          <code>.github/workflows/</code>.
        </p>
      </DocsSection>
    </div>
  );
}
