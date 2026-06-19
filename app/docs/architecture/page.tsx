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
          a modular, multi-tenant-ready structure. The runtime stack is
          deliberately small: a single Next.js process + PostgreSQL. No Redis,
          no message broker, no separate API server. Everything you need to
          understand lives in this repository.
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
├── app/                    # Next.js App Router
│   ├── (auth)/             # Public auth pages
│   ├── admin/              # Admin dashboard (role-gated)
│   ├── api/v2/             # REST API v2
│   ├── dashboard/          # User dashboard
│   ├── docs/               # This documentation site
│   ├── history/            # Scan history
│   ├── legal/              # Terms, privacy, etc.
│   ├── pricing/            # Pricing + checkout
│   ├── profile/            # User profile
│   └── teams/              # Team management
│
├── components/             # React components (mostly client-side)
│   ├── admin/              # Admin-specific UI
│   ├── auth/               # Auth forms
│   ├── badge/              # Public badge widgets
│   ├── billing/            # Stripe checkout
│   ├── docs/               # Documentation site components
│   ├── scanner/            # Scan UI (results, dashboard)
│   └── ui/                 # shadcn/ui primitives
│
├── hooks/                  # Custom React hooks
│
├── lib/                    # Server-side libraries (no React)
│   ├── api/                # API helpers, request utils
│   ├── auth/               # Sessions, 2FA, permissions
│   ├── billing/            # Stripe integration
│   ├── config/             # ★ Configuration (see CONFIG.md)
│   ├── database/           # PostgreSQL pool + query helpers
│   ├── email/              # Transactional email
│   ├── notifications/      # In-app + email notifications
│   ├── rate-limiting/      # Login/signup/scan rate limits
│   ├── reports/            # PDF report generation
│   ├── scanner/            # ★ 310+ security checks
│   └── types/              # Shared TypeScript types
│
├── instrumentation.ts      # Next.js startup hooks (DB init)
├── middleware.ts           # Auth + public-path middleware
│
├── public/                 # Static assets
├── scripts/                # _lib.mjs, migrate.mjs, db:create
│
├── .github/                # Workflows, CODEOWNERS, PR template
├── next.config.mjs         # Next.js config
├── tsconfig.json
├── tailwind.config.ts
├── eslint.config.mjs       # ESLint 9 flat config
├── Dockerfile
├── docker-compose.yml
└── package.json`}
        />
      </DocsSection>

      <DocsSection id="subsystems" title="Key Subsystems">
        <DocsSubSection title="1. Configuration">
          <p>
            See the <a href="/docs/config">Configuration</a> page for full
            details. Single source of truth:{" "}
            <code>lib/config/config-values.ts</code> →{" "}
            <code>lib/types/config.ts</code> (typed <code>DEFAULT_CONFIG</code>)
            → <code>lib/config/constants.ts</code> (re-exports + route maps) →
            application code.
          </p>
        </DocsSubSection>

        <DocsSubSection title="2. Database">
          <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
            <li>
              <strong>Driver:</strong> <code>@neondatabase/serverless</code>{" "}
              (works against vanilla Postgres too)
            </li>
            <li>
              <strong>Pool:</strong> single instance in{" "}
              <code>lib/database/db.ts</code>
            </li>
            <li>
              <strong>Schema:</strong> created by{" "}
              <code>scripts/create-fresh-db.mjs</code> (idempotent CREATE TABLE
              IF NOT EXISTS)
            </li>
            <li>
              <strong>Migrations:</strong> <code>scripts/migrate.mjs</code> for
              ad-hoc migrations
            </li>
            <li>
              <strong>Type-safety:</strong> hand-written query result types (no
              ORM) — simpler for this codebase
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="3. Authentication">
          <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
            <li>
              <strong>Sessions:</strong> iron-session, HttpOnly cookies, 7-day
              TTL
            </li>
            <li>
              <strong>Password hashing:</strong> bcrypt (12 rounds)
            </li>
            <li>
              <strong>2FA:</strong> TOTP via <code>otplib</code> + email
              fallback codes
            </li>
            <li>
              <strong>Device trust:</strong> 30-day cookies for &quot;remember
              this device&quot;
            </li>
            <li>
              <strong>API auth:</strong> Bearer tokens (<code>vr_live_...</code>
              ), encrypted at rest with AES-256
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="4. Scanner Engine">
          <p>The 310+ security checks live in:</p>
          <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
            <li>
              <code>lib/scanner/checks.ts</code> — sync checks (headers,
              cookies, TLS, etc.)
            </li>
            <li>
              <code>lib/scanner/async-checks.ts</code> — async checks (crawling,
              content analysis)
            </li>
            <li>
              <code>lib/scanner/protocols/</code> — protocol-specific scanners
              (HTTPS, WebSocket, FTP)
            </li>
            <li>
              <code>lib/scanner/safe-fetch.ts</code> — wrapped fetch with SSRF
              protections
            </li>
            <li>
              <code>lib/scanner/access-rules.ts</code> — robots.txt, scope
              whitelist
            </li>
            <li>
              <code>lib/scanner/safety-rating.ts</code> — score calculation
            </li>
          </ul>
          <p>
            Each check returns a <code>Finding</code> with severity (
            <code>info</code> / <code>low</code> / <code>medium</code> /{" "}
            <code>high</code> / <code>critical</code>).
          </p>
        </DocsSubSection>

        <DocsSubSection title="5. API Layer">
          <p>REST v1 + v2 are both supported. Each route:</p>
          <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
            <li>
              Uses <code>withErrorHandling</code> wrapper (
              <code>lib/api/api-utils.ts</code>)
            </li>
            <li>
              Validates input with Zod (<code>Validate</code> helper)
            </li>
            <li>
              Returns standardized <code>ApiResponse.success</code> /{" "}
              <code>.error</code> / <code>.serverError</code>
            </li>
            <li>
              Rate-limited via <code>lib/rate-limiting/</code>
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="6. Billing">
          <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
            <li>Stripe Checkout for plan purchases</li>
            <li>
              Webhook handling in{" "}
              <code>app/api/v2/webhooks/stripe/route.ts</code>
            </li>
            <li>
              Plan limits + retention controlled by{" "}
              <code>CONFIG_BILLING_*</code> constants
            </li>
            <li>
              Disable entirely with <code>CONFIG_BILLING_ENABLED = false</code>
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="7. Permissions">
          <p>
            Role hierarchy (defined in <code>lib/auth/permissions.ts</code>):
          </p>
          <CodeBlock
            language="text"
            code={`user (0) → beta_tester (0) → support (1) → moderator (2) → admin (3)`}
          />
          <p>
            <code>hasStaffPermission</code> / <code>canAccessAdmin</code> /{" "}
            <code>canAccessStaffPage</code> helpers enforce RBAC at the API + UI
            layer.
          </p>
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="lifecycle" title="Request Lifecycle">
        <CodeBlock
          language="text"
          code={`Browser → Next.js Request
            │
            ▼
  middleware.ts
    - Parse session cookie → load session.userId
    - Check PUBLIC_PATHS allowlist
    - Redirect unauthenticated users to /login
            │
            ▼
  Route handler (e.g. app/api/v2/scan/route.ts)
    1. withErrorHandling wrapper
    2. Auth check (getSession or API key)
    3. Rate limit check (lib/rate-limiting)
    4. Input validation (Zod via Validate)
    5. Business logic
    6. Database query (lib/database)
    7. ApiResponse.success or .error
            │
            ▼
  instrumentation.ts (startup hooks)
    - Initialize database schema on first boot
    - Version check via /api/version`}
        />
      </DocsSection>

      <DocsSection id="cicd" title="CI/CD Pipeline">
        <CodeBlock
          language="text"
          code={`On push to main / PR
  ├── Lint (ESLint 9)
  ├── Typecheck (tsc)
  ├── Build (Next.js)
  └── CodeQL (default setup)

On tag v*
  └── Docker publish (ghcr.io)

Weekly / on PR
  ├── Stale bot
  ├── Label (PR)
  └── Dependabot → auto-merge (patch only)`}
        />
        <p className="text-muted-foreground">
          See <code>.github/workflows/</code> for the exact definitions.
        </p>
      </DocsSection>
    </div>
  );
}
