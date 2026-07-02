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
  { id: "checklist", label: "Self-Hosting Checklist" },
  { id: "validation", label: "Validation" },
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
        description="VulnRadar uses a two-layer config model: non-secret tunables live in TypeScript source, secrets live in your environment. Here's how it all fits together."
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
├── config.ts               ← Cached loader (loadConfig, getConfigValue)
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
          Edit <code>lib/config/config-values.ts</code> when self-hosting. These
          values are baked into the build at compile time. No runtime reload —
          restart the process to pick up changes.
        </p>

        <DocsSubSection title="App metadata">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>CONFIG_APP_NAME</code> — Display name (default:{" "}
              <code>VulnRadar</code>)
            </li>
            <li>
              <code>CONFIG_APP_SLUG</code> — URL-safe slug
            </li>
            <li>
              <code>CONFIG_APP_VERSION</code> — Public version string
            </li>
            <li>
              <code>CONFIG_MIN_SCHEMA_VERSION</code> — Minimum schema version
              this app accepts (default: <code>2.0.0</code>). Must match the
              value in <code>vulnradar_schema_meta</code>.
            </li>
            <li>
              <code>CONFIG_ENGINE_VERSION</code> — Detection engine version
            </li>
            <li>
              <code>CONFIG_TOTAL_CHECKS_LABEL</code> — Marketing badge (default:{" "}
              <code>700+</code>)
            </li>
            <li>
              <code>CONFIG_APP_URL</code> — Public URL
            </li>
            <li>
              <code>CONFIG_APP_REPO</code> — GitHub <code>owner/repo</code>
            </li>
            <li>
              <code>CONFIG_APP_DESCRIPTION</code>
            </li>
            <li>
              <code>CONFIG_DISCORD_INVITE_URL</code> — Optional
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
              <code>CONFIG_SECURITY_EMAIL</code> — used in{" "}
              <code>security.txt</code>
            </li>
            <li>
              <code>CONFIG_ENTERPRISE_EMAIL</code>
            </li>
            <li>
              <code>CONFIG_NOREPLY_EMAIL</code> — sender for transactional email
            </li>
            <li>
              <code>CONFIG_TERMS_UPDATED_AT</code> — ISO date; bumped when terms
              change. API-key creation refuses keys from users who have not
              accepted this date.
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Branding">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>CONFIG_LOGO_URL</code> — Path under <code>/public</code>
            </li>
            <li>
              <code>CONFIG_PRIMARY_COLOR</code> — Hex color (informational; the
              actual brand color is set via the <code>--primary</code> CSS
              variable in <code>app/globals.css</code>)
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
              <code>CONFIG_SESSION_TIMEOUT_DAYS</code> (default: <code>7</code>)
            </li>
            <li>
              <code>CONFIG_PASSWORD_RESET_HOURS</code> (default: <code>1</code>)
            </li>
            <li>
              <code>CONFIG_EMAIL_VERIFICATION_HOURS</code> (default:{" "}
              <code>24</code>)
            </li>
            <li>
              <code>CONFIG_DEVICE_TRUST_DAYS</code> (default: <code>30</code>)
            </li>
            <li>
              <code>CONFIG_TOTP_VALIDITY_SECONDS</code> (default:{" "}
              <code>30</code>)
            </li>
            <li>
              <code>CONFIG_CLEANUP_INTERVAL_MS</code> (default:{" "}
              <code>86400000</code> = 24h)
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Rate limits">
          <p className="text-sm text-muted-foreground">
            All values are per-IP unless noted. The window is in minutes.
            Internally <code>lib/config/constants.ts</code> multiplies by 60 for
            the per-second window.
          </p>
          <DocsTable
            columns={[
              { key: "constant", header: "Constant" },
              { key: "attempts", header: "Attempts" },
              { key: "window", header: "Window (min)" },
            ]}
            data={[
              {
                constant: "CONFIG_RATE_LIMIT_LOGIN_ATTEMPTS",
                attempts: "5",
                window: "15",
              },
              {
                constant: "CONFIG_RATE_LIMIT_SIGNUP_ATTEMPTS",
                attempts: "3",
                window: "60",
              },
              {
                constant: "CONFIG_RATE_LIMIT_FORGOT_PASSWORD_ATTEMPTS",
                attempts: "3",
                window: "10",
              },
              {
                constant: "CONFIG_RATE_LIMIT_API_REQUESTS",
                attempts: "100",
                window: "60",
              },
              {
                constant: "CONFIG_RATE_LIMIT_SCAN_REQUESTS",
                attempts: "100",
                window: "60",
              },
              {
                constant: "CONFIG_RATE_LIMIT_BULK_SCAN_REQUESTS",
                attempts: "10",
                window: "60",
              },
            ]}
          />
        </DocsSubSection>

        <DocsSubSection title="Scanning">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>CONFIG_MAX_URL_LENGTH</code> (default: <code>2048</code>)
            </li>
            <li>
              <code>CONFIG_MAX_URLS_BULK</code> (default: <code>100</code>)
            </li>
            <li>
              <code>CONFIG_SCAN_TIMEOUT_SECONDS</code> (default:{" "}
              <code>300</code>)
            </li>
            <li>
              <code>CONFIG_BULK_SCAN_TIMEOUT_SECONDS</code> (default:{" "}
              <code>1800</code>)
            </li>
            <li>
              <code>CONFIG_DEFAULT_SEVERITY_THRESHOLD</code> (default:{" "}
              <code>low</code>)
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="API">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>CONFIG_API_KEY_PREFIX</code> (default: <code>vr_live_</code>
              )
            </li>
            <li>
              <code>CONFIG_DEFAULT_API_KEY_DAILY_LIMIT</code> (default:{" "}
              <code>50</code>) — applied when creating a new key; per-key limit
              overrides take precedence
            </li>
            <li>
              <code>CONFIG_API_CURRENT_VERSION</code> (default: <code>v3</code>)
            </li>
            <li>
              <code>CONFIG_API_SUPPORTED_VERSIONS</code> (default:{" "}
              <code>["v3"]</code>). v1 and v2 are deprecated and no longer
              served. All new integrations must target <code>v3</code>.
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Demo mode">
          <p className="text-sm text-muted-foreground">
            The <code>/demo</code> page lets unauthenticated visitors run scans.
            Rate-limited per IP.
          </p>
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>CONFIG_DEMO_SCAN_LIMIT</code> (default: <code>5</code>)
            </li>
            <li>
              <code>CONFIG_DEMO_WINDOW_HOURS</code> (default: <code>12</code>)
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Disable demo mode entirely with{" "}
            <code>CONFIG_FEATURE_DEMO_MODE = false</code>.
          </p>
        </DocsSubSection>

        <DocsSubSection title="DB constraints">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>CONFIG_MAX_EMAIL_LENGTH</code> (default: <code>255</code>)
            </li>
            <li>
              <code>CONFIG_MAX_NAME_LENGTH</code> (default: <code>255</code>)
            </li>
            <li>
              <code>CONFIG_MAX_DESCRIPTION_LENGTH</code> (default:{" "}
              <code>1000</code>)
            </li>
            <li>
              <code>CONFIG_MAX_TEAM_NAME_LENGTH</code> (default:{" "}
              <code>255</code>)
            </li>
            <li>
              <code>CONFIG_MAX_TAGS_PER_SCAN</code> (default: <code>10</code>)
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Pagination">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>CONFIG_PAGINATION_DEFAULT_PAGE_SIZE</code> (default:{" "}
              <code>20</code>)
            </li>
            <li>
              <code>CONFIG_PAGINATION_MAX_PAGE_SIZE</code> (default:{" "}
              <code>100</code>)
            </li>
            <li>
              <code>CONFIG_PAGINATION_DEFAULT_PAGE</code> (default:{" "}
              <code>1</code>)
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Beta mode">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>CONFIG_BETA_ENABLED</code> (default: <code>false</code>)
            </li>
            <li>
              <code>CONFIG_BETA_BANNER_MESSAGE</code>
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Feature flags">
          <DocsTable
            columns={[
              { key: "constant", header: "Constant" },
              { key: "default", header: "Default" },
              { key: "what", header: "Toggles" },
            ]}
            data={[
              {
                constant: "CONFIG_FEATURE_DEMO_MODE",
                default: "true",
                what: "/demo page and /api/v3/demo-scan",
              },
              {
                constant: "CONFIG_FEATURE_TEAMS",
                default: "true",
                what: "Team creation + membership",
              },
              {
                constant: "CONFIG_FEATURE_API_KEYS",
                default: "true",
                what: "Bearer-key generation",
              },
              {
                constant: "CONFIG_FEATURE_WEBHOOKS",
                default: "true",
                what: "Scan-complete webhooks",
              },
              {
                constant: "CONFIG_FEATURE_SCHEDULED_SCANS",
                default: "true",
                what: "Scheduled /api/v3/schedules",
              },
              {
                constant: "CONFIG_FEATURE_BULK_SCANS",
                default: "true",
                what: "POST /api/v3/scan/bulk",
              },
              {
                constant: "CONFIG_FEATURE_PDF_REPORTS",
                default: "true",
                what: "PDF export of findings",
              },
              {
                constant: "CONFIG_FEATURE_EMAIL_NOTIFICATIONS",
                default: "true",
                what: "Email delivery for scan-complete + notifications",
              },
            ]}
          />
        </DocsSubSection>

        <DocsSubSection title="Billing">
          <p className="text-sm text-muted-foreground">
            Plan catalogs (limits per plan) live in{" "}
            <code>lib/billing/catalog.ts</code>. The values below only configure
            the upper bounds and the retention window.
          </p>
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>CONFIG_BILLING_ENABLED</code> (default: <code>true</code>).
              Set to <code>false</code> to give every user unlimited scans (or{" "}
              <code>CONFIG_BILLING_UNLIMITED_MODE_LIMIT</code> if set).
            </li>
            <li>
              <code>CONFIG_BILLING_FREE_LIMIT</code> (default: <code>25</code>)
            </li>
            <li>
              <code>CONFIG_BILLING_CORE_SUPPORTER_LIMIT</code> (default:{" "}
              <code>100</code>)
            </li>
            <li>
              <code>CONFIG_BILLING_PRO_SUPPORTER_LIMIT</code> (default:{" "}
              <code>150</code>)
            </li>
            <li>
              <code>CONFIG_BILLING_ELITE_SUPPORTER_LIMIT</code> (default:{" "}
              <code>500</code>)
            </li>
            <li>
              <code>CONFIG_BILLING_FREE_RETENTION</code> (default:{" "}
              <code>30</code> days)
            </li>
            <li>
              <code>CONFIG_BILLING_CORE_SUPPORTER_RETENTION</code> (default:{" "}
              <code>90</code> days)
            </li>
            <li>
              <code>CONFIG_BILLING_PRO_SUPPORTER_RETENTION</code> (default:{" "}
              <code>-1</code> = forever)
            </li>
            <li>
              <code>CONFIG_BILLING_ELITE_SUPPORTER_RETENTION</code> (default:{" "}
              <code>-1</code> = forever)
            </li>
            <li>
              <code>CONFIG_BILLING_UNLIMITED_MODE_LIMIT</code> (default:{" "}
              <code>-1</code>). Used only when{" "}
              <code>CONFIG_BILLING_ENABLED = false</code>.
            </li>
          </ul>
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="layer-2" title="Layer 2: Runtime Secrets">
        <p>
          All secrets live in <code>.env</code> (or in{" "}
          <code>docker-compose.yml</code> as the <code>environment</code>{" "}
          block). Runtime validation is performed by{" "}
          <code>lib/config/env.ts</code> using Zod and called from{" "}
          <code>instrumentation.ts</code> at server startup. A missing or
          malformed required variable crashes the process before it accepts any
          requests.
        </p>

        <DocsSubSection title="Required">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>DATABASE_URL</code> — PostgreSQL connection string
            </li>
            <li>
              <code>API_KEY_ENCRYPTION_KEY</code> — exactly 64 hex chars (32
              bytes). Used to encrypt stored API keys with AES-256-GCM.
            </li>
            <li>
              <code>NEXT_PUBLIC_APP_URL</code> — public URL of the deployment
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Auth">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>AUTH_SECRET</code> — used to HMAC-sign the Discord OAuth
              state. Falls back to <code>API_KEY_ENCRYPTION_KEY</code> if unset.
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Database">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>DATABASE_SSL</code> — <code>true</code> to require SSL
            </li>
            <li>
              <code>DATABASE_SSL_CA</code> — CA cert contents (when SSL is on
              and the CA is not in the system trust store)
            </li>
            <li>
              <code>TRUSTED_PROXY_CIDR</code> — comma-separated CIDRs used when
              reading <code>X-Forwarded-For</code> for client-IP. Example:{" "}
              <code>10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.0/8</code>
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Email (SMTP)">
          <p className="text-sm text-muted-foreground">
            Required for password reset, email verification, billing verify, and
            webhook lifecycle emails. Without SMTP configured, those flows fail
            silently.
          </p>
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>SMTP_HOST</code>, <code>SMTP_PORT</code> (default 587),{" "}
              <code>SMTP_USER</code>, <code>SMTP_PASS</code>,{" "}
              <code>SMTP_FROM</code>
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Stripe (billing)">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>STRIPE_SECRET_KEY</code>
            </li>
            <li>
              <code>STRIPE_PUBLISHABLE_KEY</code>
            </li>
            <li>
              <code>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code>
            </li>
            <li>
              <code>STRIPE_WEBHOOK_SECRET</code> — set after running{" "}
              <code>GET /api/v3/stripe/setup-webhook</code>
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            If Stripe keys are unset, billing endpoints return 503.
          </p>
        </DocsSubSection>

        <DocsSubSection title="Discord OAuth">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>DISCORD_CLIENT_ID</code>, <code>DISCORD_CLIENT_SECRET</code>{" "}
              — required for <code>/api/v3/auth/discord</code>
            </li>
            <li>
              <code>DISCORD_BOT_TOKEN</code>, <code>DISCORD_GUILD_ID</code> —
              optional; if both are set, the bot auto-adds connecting users to
              the guild
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Cloudflare Turnstile">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>TURNSTILE_SECRET_KEY</code>
            </li>
            <li>
              <code>NEXT_PUBLIC_TURNSTILE_SITE_KEY</code>
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Turnstile is auto-enabled when the site key is present. It protects
            signup, password reset, contact form, and landing-contact.
          </p>
        </DocsSubSection>

        <DocsSubSection title="BrowserBase (live browser sessions)">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>BROWSERBASE_API_KEY</code>
            </li>
            <li>
              <code>BROWSERBASE_PROJECT_ID</code>
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Optional. When both are set, the &ldquo;View Page&rdquo; button on
            scan results opens a 5-minute remote BrowserBase session in a popup.
            The TTL is hard-clamped to 300 seconds. The popup auto-ends the
            session when it closes, so no history is retained server-side. See{" "}
            <a
              href="/docs/api#post-browser-sessions"
              className="text-primary hover:underline"
            >
              POST /browser/sessions
            </a>
            .
          </p>
        </DocsSubSection>

        <DocsSubSection title="Debug: DISABLE_CSP=1">
          <p className="text-sm text-muted-foreground">
            Set <code>DISABLE_CSP=1</code> in <code>.env.local</code> to ship
            the app <strong>without</strong> any CSP, COOP, CORP,
            X-Frame-Options, or Permissions-Policy headers. Use this when
            debugging a third-party embed (BrowserBase, Turnstile, embedded
            videos, etc.) and you want to confirm whether CSP is the blocker.{" "}
            <strong>Never set this in production.</strong>
          </p>
        </DocsSubSection>

        <DocsSubSection title="Contact / support overrides">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>CONTACT_EMAIL</code>, <code>SUPPORT_EMAIL</code> — override
              the addresses used by contact/support emails (defaults come from{" "}
              <code>CONFIG_*</code>).
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Docker-only">
          <p className="text-sm text-muted-foreground">
            Read by <code>docker-compose.yml</code>; not used by the app itself.
          </p>
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>POSTGRES_USER</code>, <code>POSTGRES_PASSWORD</code>,{" "}
              <code>POSTGRES_DB</code>
            </li>
            <li>
              <code>APP_PORT</code> (default 3000), <code>DB_PORT</code>{" "}
              (default 5432)
            </li>
          </ul>
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="checklist" title="Self-Hosting Checklist">
        <ol className="list-decimal pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            Edit <code>lib/config/config-values.ts</code>: app name, URL,
            emails, branding.
          </li>
          <li>
            Generate an encryption key:{" "}
            <code>
              node -e
              "console.log(require('crypto').randomBytes(32).toString('hex'))"
            </code>
          </li>
          <li>
            Create <code>.env</code> from <code>cp .env.example .env</code> and
            fill in DATABASE_URL, API_KEY_ENCRYPTION_KEY, NEXT_PUBLIC_APP_URL.
          </li>
          <li>
            Provision Postgres (via <code>docker compose up -d postgres</code>{" "}
            or external) and ensure DATABASE_URL points to it.
          </li>
          <li>
            Start the app (<code>npm run dev</code> or{" "}
            <code>docker compose up app</code>). Schema auto-creates on first
            boot; meta row is written on first scan via <code>db:migrate</code>.
          </li>
          <li>
            Sign up the first user via <code>/signup</code>, then promote via
            SQL:
            <br />
            <code>
              docker compose exec postgres psql -U vulnradar -d vulnradar -c
              "UPDATE users SET role = &apos;admin&apos; WHERE email =
              &apos;you@example.com&apos;"
            </code>
          </li>
          <li>
            (Optional) Configure SMTP, Stripe, Discord, Turnstile in{" "}
            <code>.env</code> and restart.
          </li>
        </ol>
      </DocsSection>

      <DocsSection id="validation" title="Validation">
        <p>
          The config system has three validation gates, each catching a
          different class of mistake:
        </p>
        <ol className="list-decimal pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            <strong>Build time:</strong> <code>npm run typecheck</code>{" "}
            exercises every <code>CONFIG_*</code> through the typed{" "}
            <code>DEFAULT_CONFIG</code> in <code>lib/types/config.ts</code>.
            Renaming or removing a constant fails typecheck.
          </li>
          <li>
            <strong>Server startup:</strong> <code>lib/config/env.ts</code>{" "}
            validates every required environment variable with Zod. A missing or
            malformed value throws before any request is served.
          </li>
          <li>
            <strong>First scan:</strong> <code>instrumentation.ts</code> reads{" "}
            <code>vulnradar_schema_meta</code> and refuses to start if{" "}
            <code>schema_version</code> is below{" "}
            <code>CONFIG_MIN_SCHEMA_VERSION</code>.
          </li>
        </ol>
      </DocsSection>
    </div>
  );
}
