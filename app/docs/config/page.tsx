"use client";

import { useEffect, useRef } from "react";
import { useDocsContext, type TocItem } from "../layout";
import {
  DocsHero,
  DocsSection,
  DocsSubSection,
  DocsCallout,
  CodeBlock,
  DocsTable,
} from "@/components/docs";

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "quick-reference", label: "Quick Reference" },
  { id: "architecture", label: "Architecture" },
  { id: "layer-1", label: "Static App Config" },
  { id: "app-metadata", label: "App metadata", level: 2 },
  { id: "emails", label: "Emails", level: 2 },
  { id: "branding", label: "Branding", level: 2 },
  { id: "cookies", label: "Cookies", level: 2 },
  { id: "auth-timeouts", label: "Auth timeouts", level: 2 },
  { id: "rate-limits", label: "Rate limits", level: 2 },
  { id: "scanning", label: "Scanning", level: 2 },
  { id: "api", label: "API", level: 2 },
  { id: "demo-mode", label: "Demo mode", level: 2 },
  { id: "db-constraints", label: "DB constraints", level: 2 },
  { id: "pagination", label: "Pagination", level: 2 },
  { id: "beta", label: "Beta mode", level: 2 },
  { id: "feature-flags", label: "Feature flags", level: 2 },
  { id: "billing", label: "Billing", level: 2 },
  { id: "layer-2", label: "Runtime Secrets" },
  { id: "data-flow", label: "How the layers connect" },
  { id: "checklist", label: "Self-Hosting Checklist" },
  { id: "validation", label: "Validation" },
  { id: "migration", label: "Migrating from config.yaml" },
];

export default function ConfigPage() {
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
        badge="Self-Hosting"
        title="Configuration"
        description="VulnRadar uses a two-layer config model: static settings in source code, secrets in your environment. Here's how it all fits together."
      />

      <DocsSection id="overview" title="Overview">
        <p>
          VulnRadar has a two-layer configuration model designed to keep secrets
          out of source code while making non-secret deployment settings easy to
          customize for self-hosters.
        </p>
        <DocsCallout variant="info" title="TL;DR">
          Most things you want to change live in{" "}
          <code>lib/config/config-values.ts</code>. Secrets go in{" "}
          <code>.env</code>. Edit <code>config-values.ts</code> first.
        </DocsCallout>
      </DocsSection>

      <DocsSection id="quick-reference" title="Quick Reference">
        <DocsTable
          columns={[
            { key: "what", header: "What you want to change" },
            { key: "where", header: "Where" },
          ]}
          data={[
            {
              what: "App name, URL, emails, branding",
              where: "lib/config/config-values.ts",
            },
            {
              what: "Rate limits, feature flags, billing plans",
              where: "lib/config/config-values.ts",
            },
            {
              what: "Database URL, API encryption key, Stripe keys",
              where: ".env (or docker-compose.yml env)",
            },
            { what: "SMTP credentials, Discord OAuth", where: ".env" },
            {
              what: "Client-side public values (Turnstile site key, app URL)",
              where: ".env as NEXT_PUBLIC_*",
            },
          ]}
        />
      </DocsSection>

      <DocsSection id="architecture" title="Architecture">
        <CodeBlock
          language="text"
          code={`lib/config/
├── config-values.ts        ← SOURCE OF TRUTH (raw CONFIG_* constants)
├── constants.ts            ← Re-exports + derived route/error maps
├── client-constants.ts     ← Client-safe subset (no server-only values)
├── config.ts               ← Loader with cache; reads DEFAULT_CONFIG
└── public-paths.ts         ← Middleware public-path allowlist

lib/types/
└── config.ts                ← Type definitions + DEFAULT_CONFIG
                              (DERIVED from config-values.ts)`}
        />
        <p className="text-muted-foreground">
          <strong>Single source of truth:</strong>{" "}
          <code>lib/config/config-values.ts</code> exports raw{" "}
          <code>CONFIG_*</code> constants. Everything else (types, derived
          objects, route maps) is built from those constants. Edit{" "}
          <code>config-values.ts</code> to customize your deployment.
        </p>
      </DocsSection>

      <DocsSection id="layer-1" title="Layer 1: Static App Config">
        <p>
          Edit <code>lib/config/config-values.ts</code> when self-hosting.
        </p>

        <DocsSubSection title="App metadata">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>CONFIG_APP_NAME</code> — Display name
            </li>
            <li>
              <code>CONFIG_APP_SLUG</code> — URL-safe slug
            </li>
            <li>
              <code>CONFIG_APP_VERSION</code> — Public version string
            </li>
            <li>
              <code>CONFIG_APP_URL</code> — Public URL
            </li>
            <li>
              <code>CONFIG_APP_REPO</code> — GitHub <code>owner/repo</code>
            </li>
            <li>
              <code>CONFIG_DISCORD_INVITE_URL</code> — Discord invite (optional)
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Emails">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>CONFIG_SUPPORT_EMAIL</code>
            </li>
            <li>
              <code>CONFIG_LEGAL_EMAIL</code>
            </li>
            <li>
              <code>CONFIG_SECURITY_EMAIL</code>
            </li>
            <li>
              <code>CONFIG_ENTERPRISE_EMAIL</code>
            </li>
            <li>
              <code>CONFIG_NOREPLY_EMAIL</code>
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Branding">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>CONFIG_LOGO_URL</code> — Path to logo (default:{" "}
              <code>/favicon-dark.svg</code>)
            </li>
            <li>
              <code>CONFIG_PRIMARY_COLOR</code> — Hex color (default:{" "}
              <code>#6366f1</code>)
            </li>
            <li>
              <code>CONFIG_FOOTER_TEXT</code>
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Cookies">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>CONFIG_SESSION_COOKIE_NAME</code>,{" "}
              <code>CONFIG_SESSION_MAX_AGE_DAYS</code>
            </li>
            <li>
              <code>CONFIG_VERSION_COOKIE_NAME</code>,{" "}
              <code>CONFIG_VERSION_COOKIE_MAX_AGE_DAYS</code>
            </li>
            <li>
              <code>CONFIG_DEVICE_TRUST_COOKIE_NAME</code>,{" "}
              <code>CONFIG_DEVICE_TRUST_MAX_AGE_DAYS</code>
            </li>
            <li>
              <code>CONFIG_2FA_PENDING_COOKIE_NAME</code>,{" "}
              <code>CONFIG_2FA_PENDING_MAX_AGE_SECONDS</code>
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Authentication timeouts">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>CONFIG_SESSION_TIMEOUT_DAYS</code> (7)
            </li>
            <li>
              <code>CONFIG_PASSWORD_RESET_HOURS</code> (1)
            </li>
            <li>
              <code>CONFIG_EMAIL_VERIFICATION_HOURS</code> (24)
            </li>
            <li>
              <code>CONFIG_DEVICE_TRUST_DAYS</code> (30)
            </li>
            <li>
              <code>CONFIG_TOTP_VALIDITY_SECONDS</code> (30)
            </li>
            <li>
              <code>CONFIG_CLEANUP_INTERVAL_MS</code> (24h)
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Rate limits">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>CONFIG_RATE_LIMIT_LOGIN_ATTEMPTS</code> /{" "}
              <code>_WINDOW_MINUTES</code>
            </li>
            <li>
              <code>CONFIG_RATE_LIMIT_SIGNUP_ATTEMPTS</code> /{" "}
              <code>_WINDOW_MINUTES</code>
            </li>
            <li>
              <code>CONFIG_RATE_LIMIT_FORGOT_PASSWORD_ATTEMPTS</code> /{" "}
              <code>_WINDOW_MINUTES</code>
            </li>
            <li>
              <code>CONFIG_RATE_LIMIT_API_REQUESTS</code> /{" "}
              <code>_WINDOW_MINUTES</code>
            </li>
            <li>
              <code>CONFIG_RATE_LIMIT_SCAN_REQUESTS</code> /{" "}
              <code>_WINDOW_MINUTES</code>
            </li>
            <li>
              <code>CONFIG_RATE_LIMIT_BULK_SCAN_REQUESTS</code> /{" "}
              <code>_WINDOW_MINUTES</code>
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Scanning">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>CONFIG_MAX_URL_LENGTH</code> (2048)
            </li>
            <li>
              <code>CONFIG_MAX_URLS_BULK</code> (100)
            </li>
            <li>
              <code>CONFIG_SCAN_TIMEOUT_SECONDS</code> (300)
            </li>
            <li>
              <code>CONFIG_BULK_SCAN_TIMEOUT_SECONDS</code> (1800)
            </li>
            <li>
              <code>CONFIG_DEFAULT_SEVERITY_THRESHOLD</code> (
              <code>&quot;low&quot;</code>)
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="API">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>CONFIG_API_KEY_PREFIX</code> (
              <code>&quot;vr_live_&quot;</code>)
            </li>
            <li>
              <code>CONFIG_DEFAULT_API_KEY_DAILY_LIMIT</code> (50)
            </li>
            <li>
              <code>CONFIG_API_CURRENT_VERSION</code> (
              <code>&quot;v2&quot;</code>)
            </li>
            <li>
              <code>CONFIG_API_SUPPORTED_VERSIONS</code> ([
              <code>&quot;v1&quot;</code>, <code>&quot;v2&quot;</code>])
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Demo mode">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>CONFIG_DEMO_SCAN_LIMIT</code> (5)
            </li>
            <li>
              <code>CONFIG_DEMO_WINDOW_HOURS</code> (12)
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Database constraints">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>CONFIG_MAX_EMAIL_LENGTH</code> (255)
            </li>
            <li>
              <code>CONFIG_MAX_NAME_LENGTH</code> (255)
            </li>
            <li>
              <code>CONFIG_MAX_DESCRIPTION_LENGTH</code> (1000)
            </li>
            <li>
              <code>CONFIG_MAX_TEAM_NAME_LENGTH</code> (255)
            </li>
            <li>
              <code>CONFIG_MAX_TAGS_PER_SCAN</code> (10)
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Pagination">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>CONFIG_PAGINATION_DEFAULT_PAGE_SIZE</code> (20)
            </li>
            <li>
              <code>CONFIG_PAGINATION_MAX_PAGE_SIZE</code> (100)
            </li>
            <li>
              <code>CONFIG_PAGINATION_DEFAULT_PAGE</code> (1)
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Beta mode">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>CONFIG_BETA_ENABLED</code> (false)
            </li>
            <li>
              <code>CONFIG_BETA_BANNER_MESSAGE</code>
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Feature flags">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>CONFIG_FEATURE_DEMO_MODE</code> (true)
            </li>
            <li>
              <code>CONFIG_FEATURE_TEAMS</code> (true)
            </li>
            <li>
              <code>CONFIG_FEATURE_API_KEYS</code> (true)
            </li>
            <li>
              <code>CONFIG_FEATURE_WEBHOOKS</code> (true)
            </li>
            <li>
              <code>CONFIG_FEATURE_SCHEDULED_SCANS</code> (true)
            </li>
            <li>
              <code>CONFIG_FEATURE_BULK_SCANS</code> (true)
            </li>
            <li>
              <code>CONFIG_FEATURE_PDF_REPORTS</code> (true)
            </li>
            <li>
              <code>CONFIG_FEATURE_EMAIL_NOTIFICATIONS</code> (true)
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Billing / premium">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>CONFIG_BILLING_ENABLED</code> (true) — set to{" "}
              <code>false</code> to disable all billing features and give all
              users unlimited access
            </li>
            <li>
              <code>CONFIG_BILLING_FREE_LIMIT</code> (25) — daily scans on the
              free plan
            </li>
            <li>
              <code>CONFIG_BILLING_CORE_SUPPORTER_LIMIT</code> (100)
            </li>
            <li>
              <code>CONFIG_BILLING_PRO_SUPPORTER_LIMIT</code> (150)
            </li>
            <li>
              <code>CONFIG_BILLING_ELITE_SUPPORTER_LIMIT</code> (500)
            </li>
            <li>
              <code>CONFIG_BILLING_*_RETENTION</code> — history retention in
              days; <code>-1</code> = unlimited
            </li>
            <li>
              <code>CONFIG_BILLING_UNLIMITED_MODE_LIMIT</code> (-1) — used when{" "}
              <code>CONFIG_BILLING_ENABLED</code> is <code>false</code>
            </li>
          </ul>
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="layer-2" title="Layer 2: Runtime Secrets">
        <p>
          These MUST NOT be committed. Use <code>.env</code> (local dev) or{" "}
          <code>docker-compose.yml</code> <code>environment:</code>{" "}
          (production).
        </p>
        <DocsTable
          columns={[
            { key: "var", header: "Variable" },
            { key: "req", header: "Required" },
            { key: "desc", header: "Description" },
          ]}
          data={[
            {
              var: "DATABASE_URL",
              req: "Yes",
              desc: "postgresql://user:pass@host:5432/db",
            },
            {
              var: "DATABASE_SSL",
              req: "No",
              desc: "true / false (default false)",
            },
            {
              var: "API_KEY_ENCRYPTION_KEY",
              req: "Yes",
              desc: "64-char hex (32 bytes). Generate with crypto.randomBytes(32).toString('hex')",
            },
            {
              var: "NEXT_PUBLIC_APP_URL",
              req: "Yes",
              desc: "Public URL (used in emails, OAuth redirects)",
            },
            {
              var: "STRIPE_SECRET_KEY",
              req: "If billing",
              desc: "sk_test_... or sk_live_...",
            },
            {
              var: "STRIPE_PUBLISHABLE_KEY",
              req: "If billing",
              desc: "pk_test_... or pk_live_...",
            },
            {
              var: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
              req: "If billing",
              desc: "Same as STRIPE_PUBLISHABLE_KEY",
            },
            {
              var: "STRIPE_WEBHOOK_SECRET",
              req: "If billing",
              desc: "Get via /api/v2/stripe/setup-webhook or Stripe dashboard",
            },
            {
              var: "SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM",
              req: "If email",
              desc: "For transactional email",
            },
            {
              var: "CONTACT_EMAIL",
              req: "If contact form",
              desc: "Where to send contact submissions",
            },
            {
              var: "DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET",
              req: "If Discord OAuth",
              desc: "From Discord Developer Portal",
            },
            {
              var: "DISCORD_BOT_TOKEN, DISCORD_GUILD_ID",
              req: "If auto-join",
              desc: "For auto-joining users to your server",
            },
            {
              var: "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
              req: "If captcha",
              desc: "Cloudflare Turnstile public key",
            },
            {
              var: "TURNSTILE_SECRET_KEY",
              req: "If captcha",
              desc: "Cloudflare Turnstile secret",
            },
          ]}
        />
        <DocsCallout variant="info" title="Build-time placeholders">
          The <code>Dockerfile</code> provides dummy placeholders for all of the
          above at build time so <code>npm run build</code> succeeds without
          real secrets. Real values are injected at runtime via{" "}
          <code>docker-compose.yml</code> or <code>docker run -e</code>.
        </DocsCallout>
      </DocsSection>

      <DocsSection id="data-flow" title="How the layers connect">
        <CodeBlock
          language="text"
          code={`┌─────────────────────────────────┐     ┌──────────────────────────┐
│ config-values.ts                │     │ .env (docker secrets)    │
│   CONFIG_BILLING_ENABLED = true │     │   STRIPE_SECRET_KEY=...  │
│   CONFIG_APP_NAME = "AcmeScan"  │     │   DATABASE_URL=...        │
│   ...                           │     │                          │
└──────────┬──────────────────────┘     └──────────┬───────────────┘
           │                                       │
           ▼                                       ▼
   ┌───────────────┐                       ┌───────────────┐
   │  types/config │                       │  process.env  │
   │  DEFAULT_CONFIG (typed)              │  (Next.js)    │
   └───────┬───────┘                       └───────┬───────┘
           │                                       │
           └──────────────────┬────────────────────┘
                              ▼
                     ┌──────────────────┐
                     │  constants.ts     │
                     │  APP_NAME, ROUTES │
                     │  API, ERROR_MSGS  │
                     └────────┬─────────┘
                              ▼
                  application code`}
        />
      </DocsSection>

      <DocsSection id="checklist" title="Self-Hosting Checklist">
        <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
          <li>Clone the repo</li>
          <li>
            Copy <code>.env.example</code> to <code>.env</code> and fill in real
            secrets
          </li>
          <li>
            Edit <code>lib/config/config-values.ts</code>:
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>
                Set <code>CONFIG_APP_NAME</code>, <code>CONFIG_APP_URL</code>,{" "}
                <code>CONFIG_APP_REPO</code> to your deployment
              </li>
              <li>
                Set all <code>*_EMAIL</code> constants
              </li>
              <li>
                Set <code>CONFIG_BILLING_ENABLED = false</code> (unless
                you&apos;re running the full Stripe flow)
              </li>
              <li>Adjust rate limits to suit your load</li>
            </ul>
          </li>
          <li>
            <code>docker compose up -d</code>
          </li>
          <li>
            <code>docker compose exec app npm run db:create</code> to initialize
            the schema
          </li>
          <li>
            (Optional) Create the first admin user, then promote via SQL:
            <CodeBlock
              language="sql"
              code={`UPDATE users SET role = 'admin' WHERE email = 'you@example.com';`}
            />
          </li>
        </ol>
      </DocsSection>

      <DocsSection id="validation" title="Validation">
        <p>
          The <code>DEFAULT_CONFIG</code> is constructed at module load time. If
          a required constant is missing or has the wrong type, the build will
          fail with a TypeScript error pointing to{" "}
          <code>lib/types/config.ts</code>. There is{" "}
          <strong>no runtime fallback</strong> — misconfiguration is caught at
          build time, not in production.
        </p>
      </DocsSection>

      <DocsSection id="migration" title="Migrating from config.yaml">
        <p>
          Earlier versions read a YAML file at runtime. This was replaced with
          the build-time TypeScript module to:
        </p>
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
          <li>Eliminate YAML parsing fragility</li>
          <li>Provide full TypeScript type-safety</li>
          <li>Allow tree-shaking of unused config</li>
          <li>Make config values visible to the type checker</li>
        </ul>
        <p>
          If you were self-hosting with a <code>config.yaml</code>, migrate by
          copying those values into <code>lib/config/config-values.ts</code>.
        </p>
      </DocsSection>
    </div>
  );
}
