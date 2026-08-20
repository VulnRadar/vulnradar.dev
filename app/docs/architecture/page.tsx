"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { APP_NAME } from "@/lib/config/constants";
import { useDocsContext, type TocItem } from "@/components/docs/docs-shell";
import {
  DocsHero,
  DocsSection,
  DocsSubSection,
  DocsCallout,
  CodeBlock,
  InlineCode,
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
        description={`A tour of the ${APP_NAME} codebase: how the pieces fit together, where config lives, and how a request flows from browser to database.`}
      />

      <DocsSection id="overview" title="Overview">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          {APP_NAME} is a{" "}
          <strong className="text-foreground">Next.js 15 App Router</strong>{" "}
          application with a single-process deployment. The runtime stack is
          deliberately small: one Next.js process + one PostgreSQL database. No
          Redis, no message broker, no separate API server. Everything you need
          to understand lives in this repository.
        </p>
        <DocsCallout variant="info" title="Single source of truth">
          Almost every tunable lives in{" "}
          <InlineCode>lib/config/config-values.ts</InlineCode>. The rest of the
          config system is built from those constants. Edit there, not in random
          files.
        </DocsCallout>
      </DocsSection>

      <DocsSection id="layout" title="Project Layout">
        <CodeBlock
          language="text"
          code={`vulnradar.dev/
├── app/                          # Next.js App Router
│   ├── (root pages)              # /, /landing, /pricing, /demo, /contact, /donate
│   ├── admin/                    # Admin dashboard (staff-gated)
│   ├── api/v3/                   # REST API v3 (and /api/security-txt, /api/version)
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
        <DocsSubSection id="config" title="1. Configuration">
          <p className="text-sm text-muted-foreground">
            See the{" "}
            <Link
              href="/docs/config"
              className="text-primary underline-offset-2 hover:underline"
            >
              Configuration
            </Link>{" "}
            page for full details. Flow:
          </p>
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <InlineCode>lib/config/config-values.ts</InlineCode>: raw{" "}
              <InlineCode>CONFIG_*</InlineCode> constants.{" "}
              <strong className="text-foreground">Edit this file.</strong>
            </li>
            <li>
              <InlineCode>lib/types/config.ts</InlineCode>: typed interfaces +{" "}
              <InlineCode>DEFAULT_CONFIG</InlineCode> assembled from the
              constants above
            </li>
            <li>
              <InlineCode>lib/config/config.ts</InlineCode>: cached loader (
              <InlineCode>loadConfig</InlineCode>,{" "}
              <InlineCode>getConfigValue</InlineCode>)
            </li>
            <li>
              <InlineCode>lib/config/constants.ts</InlineCode>: re-exports +
              derived maps (<InlineCode>RATE_LIMITS</InlineCode>,{" "}
              <InlineCode>BILLING_PLAN_LIMITS</InlineCode>,{" "}
              <InlineCode>ROUTES</InlineCode>, <InlineCode>API</InlineCode>)
            </li>
            <li>
              <InlineCode>lib/config/client-constants.ts</InlineCode>:
              client-safe subset (no server-only secrets)
            </li>
            <li>
              <InlineCode>lib/config/registry.ts</InlineCode>: classifies every
              configurable <InlineCode>CONFIG_*</InlineCode> value into a
              settings registry (type, bounds, admin-facing tab, and whether an
              edit takes effect immediately or only on the next build) that
              drives the admin settings UI at <InlineCode>/admin</InlineCode>{" "}
              and the runtime resolver below
            </li>
            <li>
              <InlineCode>lib/config/runtime-config.ts</InlineCode>: resolves a
              registry key database-override, then env, then shipped default,
              with a short in-process cache invalidated on write
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection id="database" title="2. Database">
          <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">Driver:</strong>{" "}
              <InlineCode>pg</InlineCode> (the{" "}
              <InlineCode>@neondatabase/serverless</InlineCode> dependency is
              installed but the app uses node-postgres via{" "}
              <InlineCode>lib/database/db.ts</InlineCode>)
            </li>
            <li>
              <strong className="text-foreground">Pool:</strong> single instance
              in <InlineCode>lib/database/db.ts</InlineCode> (max 10, 5s connect
              timeout, <InlineCode>DATABASE_SSL</InlineCode>/
              <InlineCode>DATABASE_SSL_CA</InlineCode> respected)
            </li>
            <li>
              <strong className="text-foreground">Schema:</strong> 40 tables
              created by <InlineCode>instrumentation.ts</InlineCode> at app
              startup using <InlineCode>CREATE TABLE IF NOT EXISTS</InlineCode>
            </li>
            <li>
              <strong className="text-foreground">Schema version gate:</strong>{" "}
              <InlineCode>instrumentation.ts</InlineCode> reads the{" "}
              <InlineCode>vulnradar_schema_meta</InlineCode> row and refuses to
              start if <InlineCode>schema_version</InlineCode> &lt;{" "}
              <InlineCode>CONFIG_MIN_SCHEMA_VERSION</InlineCode>
            </li>
            <li>
              <strong className="text-foreground">Migration:</strong>{" "}
              <InlineCode>npm run db:migrate</InlineCode> runs{" "}
              <InlineCode>scripts/migrate/migrate.mjs</InlineCode> (interactive,
              with <InlineCode>--dry-run</InlineCode>)
            </li>
            <li>
              <strong className="text-foreground">Side-by-side clone:</strong>{" "}
              <InlineCode>npm run db:create</InlineCode> runs{" "}
              <InlineCode>
                scripts/create-fresh-db/create-fresh-db.mjs
              </InlineCode>
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection id="auth" title="3. Authentication">
          <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">Sessions:</strong> DB-backed
              (table <InlineCode>sessions</InlineCode>
              ), cookie value is a 64-hex random id, httpOnly + sameSite=lax +
              7-day TTL. See <InlineCode>lib/auth/auth.ts</InlineCode>.
            </li>
            <li>
              <strong className="text-foreground">Password hashing:</strong>{" "}
              <InlineCode>node:crypto</InlineCode> scrypt (N=131072, r=8, p=1,
              16-byte salt, 64-byte derived key). Format:{" "}
              <InlineCode>N:r:p:saltHex:hashHex</InlineCode>.
            </li>
            <li>
              <strong className="text-foreground">2FA:</strong> hand-rolled TOTP
              (RFC 6238, SHA-1, 6 digits, 30s step, ±1 window) in{" "}
              <InlineCode>lib/auth/totp.ts</InlineCode>. Backup codes (8 per
              user, hashed via scrypt). Email 2FA alternative in{" "}
              <InlineCode>lib/email/email.ts</InlineCode>.
            </li>
            <li>
              <strong className="text-foreground">
                Password reset / email verify:
              </strong>{" "}
              32-byte hex tokens stored as{" "}
              <InlineCode>sha256(token)</InlineCode> in their respective tables;
              lifetimes are{" "}
              <InlineCode>CONFIG_PASSWORD_RESET_HOURS=1</InlineCode> and{" "}
              <InlineCode>CONFIG_EMAIL_VERIFICATION_HOURS=24</InlineCode>.
            </li>
            <li>
              <strong className="text-foreground">Device trust:</strong>{" "}
              per-device 256-bit random token in{" "}
              <InlineCode>device_trust</InlineCode>; 30-day cookie. See{" "}
              <InlineCode>lib/auth/device-trust.ts</InlineCode>.
            </li>
            <li>
              <strong className="text-foreground">Discord OAuth:</strong>{" "}
              HMAC-signed state with{" "}
              <InlineCode>AUTH_SECRET || API_KEY_ENCRYPTION_KEY</InlineCode>,
              5-minute TTL. Two actions:{" "}
              <InlineCode>?action=connect</InlineCode> (link existing) and{" "}
              <InlineCode>?action=login</InlineCode> (sign in via Discord).
            </li>
            <li>
              <strong className="text-foreground">API auth:</strong> Bearer API
              keys with prefix <InlineCode>vr_live_</InlineCode>; encrypted at
              rest with AES-256-GCM via{" "}
              <InlineCode>lib/auth/crypto.ts</InlineCode> using{" "}
              <InlineCode>API_KEY_ENCRYPTION_KEY</InlineCode> (64 hex chars).
            </li>
            <li>
              <strong className="text-foreground">IP binding:</strong> optional,
              off by default, admin-configurable. Sessions can be bound to the
              subnet they started on (default /24 IPv4, /48 IPv6); a mismatch
              deletes the session and asks for login again. API keys can be
              bound the same way with stricter default prefixes (/32 IPv4, /128
              IPv6, i.e. exact match). See{" "}
              <Link
                href="/docs/config"
                className="text-primary underline-offset-2 hover:underline"
              >
                Configuration
              </Link>
              .
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection id="scanner" title="4. Scanner Engine">
          <p className="text-sm text-muted-foreground">
            The detection engine is split across per-category files:
          </p>
          <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
            <li>
              <InlineCode>lib/scanner/checks/*.ts</InlineCode>: 13 synchronous
              per-category detector modules (headers, ssl, content, cookies,
              configuration, information-disclosure, code, api,
              secrets-extended, vibe-code, client-side, supply-chain,
              host-validation). Each exports{" "}
              <InlineCode>detectors: Record&lt;id, EvidenceFn&gt;</InlineCode>{" "}
              where <InlineCode>EvidenceFn</InlineCode> returns{" "}
              <InlineCode>string | null</InlineCode>. tls, dns, and email run
              separately as async modules (see below) because they need a live
              socket rather than a fixed response body.
            </li>
            <li>
              <InlineCode>lib/scanner/checks-data/*.json</InlineCode>:
              human-readable metadata (title, description, severity, category,
              fix steps, code examples) for every legacy detector. 652 entries
              across all 16 per-category files as of this writing; the live
              count is always <InlineCode>GET /api/v3/finding-types</InlineCode>
              .
            </li>
            <li>
              <InlineCode>lib/scanner/checks/page-checks/</InlineCode>: 43
              checks on a newer <InlineCode>PageCheck</InlineCode> architecture
              that run against a real parsed page instead of a flat-string
              regex. <InlineCode>lib/scanner/page-context.ts</InlineCode> builds
              a <InlineCode>PageContext</InlineCode> once per scan (parsed
              forms, scripts with resolved origins, CSP directives with
              fallback-to-default-src semantics, parsed cookies, deduped
              third-party origins), and{" "}
              <InlineCode>lib/scanner/engine.ts</InlineCode> (
              <InlineCode>runSyncChecks</InlineCode>) runs both the legacy
              detectors and every applicable page check against it in one pass.
              Findings from either source carry a 0-100{" "}
              <InlineCode>confidence</InlineCode> score keyed to the detection
              method and a verbatim <InlineCode>evidence</InlineCode> excerpt,
              and a dedupe pass folds duplicate findings from different checks
              into one survivor. These checks fold into the existing 16
              categories rather than adding a new one; combined with the legacy
              set, the engine now runs 695 checks.
            </li>
            <li>
              <InlineCode>lib/scanner/auth/</InlineCode>: ephemeral
              authenticated scanning for{" "}
              <InlineCode>POST /api/v3/scan/authenticated</InlineCode>.
              Credentials travel in that one request and are never persisted;
              form-based login opens a real, ephemeral BrowserBase browser
              session over CDP to render and submit the login page, and detects
              Cloudflare/CAPTCHA bot-protection walls instead of treating them
              as a failed login. This endpoint scans a single page synchronously
              (no crawl) using the legacy detector set; it does not yet run the
              page-checks above.
            </li>
            <li>
              <InlineCode>lib/scanner/scan-jobs.ts</InlineCode>: background scan
              jobs. <InlineCode>POST /api/v3/scan</InlineCode> and{" "}
              <InlineCode>POST /api/v3/scan/crawl</InlineCode> insert a{" "}
              <InlineCode>scan_history</InlineCode> row and return{" "}
              <InlineCode>{`{ scanId, status: "running" }`}</InlineCode>{" "}
              immediately; the scan itself runs detached from that request (safe
              because this is a single persistent Node process, not a serverless
              function), reporting real per-category progress to the row as it
              goes. <InlineCode>GET /api/v3/scan/status/[id]</InlineCode> is
              polled for status, progress, and the final result; a watchdog
              timer force-fails a job that runs past its time budget.
            </li>
            <li>
              <InlineCode>lib/scanner/async-checks.ts</InlineCode>:
              network-dependent checks run in parallel: DNS (SPF, DMARC, DKIM,
              DNSSEC via Google + Cloudflare DoH), TLS handshake (self-signed /
              expired / weak protocol), live-fetch (robots.txt sensitive paths,
              security.txt presence)
            </li>
            <li>
              <InlineCode>lib/scanner/protocols/</InlineCode>: protocol-specific
              warnings: <InlineCode>https.ts</InlineCode>,{" "}
              <InlineCode>websocket.ts</InlineCode> (8 check IDs),{" "}
              <InlineCode>ftp.ts</InlineCode> (4 check IDs),{" "}
              <InlineCode>banner.ts</InlineCode> (TCP banner-grab for service
              probes: ssh, smtp, imap, pop3, ftp, mongodb)
            </li>
            <li>
              <InlineCode>lib/scanner/safe-fetch.ts</InlineCode>: SSRF
              protection: blocks private IP ranges, localhost,
              .local/.internal/.lan hostnames; 15s default fetch timeout
            </li>
            <li>
              <InlineCode>lib/scanner/access-rules.ts</InlineCode>: IP/URL
              blacklist + whitelist from the{" "}
              <InlineCode>access_rules</InlineCode> table
            </li>
            <li>
              <InlineCode>lib/scanner/safety-rating.ts</InlineCode>: maps
              findings to <InlineCode>safe</InlineCode> /{" "}
              <InlineCode>caution</InlineCode> / <InlineCode>unsafe</InlineCode>{" "}
              for badges
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Categories (<InlineCode>lib/scanner/types.ts</InlineCode>, 16
            total): <InlineCode>headers</InlineCode>,{" "}
            <InlineCode>ssl</InlineCode>, <InlineCode>tls</InlineCode>,{" "}
            <InlineCode>content</InlineCode>, <InlineCode>cookies</InlineCode>,{" "}
            <InlineCode>configuration</InlineCode>,{" "}
            <InlineCode>information-disclosure</InlineCode>,{" "}
            <InlineCode>dns</InlineCode>, <InlineCode>email</InlineCode>,{" "}
            <InlineCode>api</InlineCode>, <InlineCode>code</InlineCode>,{" "}
            <InlineCode>secrets-extended</InlineCode>,{" "}
            <InlineCode>vibe-code</InlineCode>,{" "}
            <InlineCode>client-side</InlineCode>,{" "}
            <InlineCode>supply-chain</InlineCode>,{" "}
            <InlineCode>host-validation</InlineCode>. Severities:{" "}
            <InlineCode>info</InlineCode>, <InlineCode>low</InlineCode>,{" "}
            <InlineCode>medium</InlineCode>, <InlineCode>high</InlineCode>,{" "}
            <InlineCode>critical</InlineCode>.
          </p>
          <p className="text-sm text-muted-foreground">
            Service probes (
            <InlineCode>lib/scanner/protocols/banner.ts</InlineCode>) open a
            bounded TCP socket to the target hostname on a well-known or
            user-supplied port, read the greeting, and report version disclosure
            and reachability. The 6 supported probes are{" "}
            <InlineCode>ssh</InlineCode>, <InlineCode>smtp</InlineCode>,{" "}
            <InlineCode>imap</InlineCode>, <InlineCode>pop3</InlineCode>,{" "}
            <InlineCode>ftp</InlineCode>, and <InlineCode>mongodb</InlineCode>.
            Probes are independent of the URL scheme: opt into{" "}
            <InlineCode>{`"probes": ["ssh:2222"]`}</InlineCode> from the
            dashboard without constructing <InlineCode>ssh://host</InlineCode>.
          </p>
        </DocsSubSection>

        <DocsSubSection id="api" title="5. API Layer">
          <p className="text-sm text-muted-foreground">
            REST v3 is the only API this build serves. There is no{" "}
            <InlineCode>/api/v1</InlineCode> or <InlineCode>/api/v2</InlineCode>{" "}
            route tree. Each v3 route handler:
          </p>
          <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
            <li>
              Wraps the body in a try/catch via the{" "}
              <InlineCode>withErrorHandling</InlineCode> helper (
              <InlineCode>lib/api/api-utils.ts</InlineCode>)
            </li>
            <li>
              Authenticates via <InlineCode>getSession()</InlineCode> (cookie)
              or <InlineCode>validateApiKey()</InlineCode> (Bearer)
            </li>
            <li>
              Validates input with Zod schemas using the{" "}
              <InlineCode>Validate</InlineCode> helper
            </li>
            <li>
              Applies a rate limit via <InlineCode>checkRateLimit</InlineCode> (
              <InlineCode>lib/rate-limiting/rate-limit.ts</InlineCode>) and/or a
              daily quota via <InlineCode>checkAndRecordRequest</InlineCode> (
              <InlineCode>lib/rate-limiting/daily-limits.ts</InlineCode>)
            </li>
            <li>
              Returns <InlineCode>NextResponse.json</InlineCode> with a standard
              shape on both success and error
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection id="billing" title="6. Billing">
          <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
            <li>
              Plans are defined once in{" "}
              <InlineCode>lib/billing/catalog.ts</InlineCode>:{" "}
              <InlineCode>free</InlineCode>,{" "}
              <InlineCode>core_supporter</InlineCode>,{" "}
              <InlineCode>pro_supporter</InlineCode>,{" "}
              <InlineCode>elite_supporter</InlineCode>. Each paid plan
              auto-generates monthly + yearly variants (yearly is 20% off).
            </li>
            <li>
              Stripe products are auto-created on first call to{" "}
              <InlineCode>GET /api/v3/stripe/setup-products</InlineCode>;
              webhooks via{" "}
              <InlineCode>GET /api/v3/stripe/setup-webhook</InlineCode>
            </li>
            <li>
              Subscription state lives on the <InlineCode>users</InlineCode>{" "}
              row: <InlineCode>plan</InlineCode>,{" "}
              <InlineCode>stripe_customer_id</InlineCode>,{" "}
              <InlineCode>stripe_subscription_id</InlineCode>,{" "}
              <InlineCode>subscription_status</InlineCode>,{" "}
              <InlineCode>current_period_end</InlineCode>,{" "}
              <InlineCode>cancel_at_period_end</InlineCode>
            </li>
            <li>
              Webhook handler:{" "}
              <InlineCode>app/api/v3/webhooks/stripe/route.ts</InlineCode>{" "}
              processes <InlineCode>checkout.session.completed</InlineCode>,{" "}
              <InlineCode>
                customer.subscription.created/updated/deleted
              </InlineCode>
              , and <InlineCode>invoice.payment_succeeded/failed</InlineCode>
            </li>
            <li>
              Plan limits and retention windows are in{" "}
              <InlineCode>lib/config/config-values.ts</InlineCode> under{" "}
              <InlineCode>CONFIG_BILLING_*</InlineCode>. Disable billing
              entirely with{" "}
              <InlineCode>CONFIG_BILLING_ENABLED = false</InlineCode>.
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection id="permissions" title="7. Permissions">
          <p className="text-sm text-muted-foreground">
            Role hierarchy (defined in{" "}
            <InlineCode>lib/config/client-constants.ts</InlineCode>):
          </p>
          <CodeBlock
            language="text"
            code={`user (0) → support (1) → moderator (2) → admin (3)`}
          />
          <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground mt-3">
            <li>
              <InlineCode>lib/auth/permissions.ts</InlineCode>: server-safe role
              + permission maps (<InlineCode>ROLES</InlineCode>,{" "}
              <InlineCode>ROLE_PERMISSIONS</InlineCode>,{" "}
              <InlineCode>userHasPermission</InlineCode>,
              <InlineCode>canManageRole</InlineCode>)
            </li>
            <li>
              <InlineCode>lib/auth/permissions-client.ts</InlineCode>: mirror
              for client components
            </li>
            <li>
              <InlineCode>lib/auth/authorization.ts</InlineCode>: route-handler
              helpers: <InlineCode>requireStaff(role?)</InlineCode>,{" "}
              <InlineCode>requireAdmin()</InlineCode>,{" "}
              <InlineCode>verifyOwnership(resource, id)</InlineCode>,{" "}
              <InlineCode>verifyTeamMembership()</InlineCode>,{" "}
              <InlineCode>logAuditAction()</InlineCode>
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
        <p className="text-sm text-muted-foreground">
          All four checks (<InlineCode>lint</InlineCode>,{" "}
          <InlineCode>typecheck</InlineCode>, <InlineCode>test</InlineCode>,{" "}
          <InlineCode>build</InlineCode>) run on Node 22 LTS in CI. See{" "}
          <InlineCode>.github/workflows/</InlineCode>.
        </p>
      </DocsSection>
    </div>
  );
}
