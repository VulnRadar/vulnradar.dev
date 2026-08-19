"use client";

import { useEffect, useRef } from "react";
import { useDocsContext, type TocItem } from "@/components/docs/docs-shell";
import {
  DocsHero,
  DocsSection,
  DocsSubSection,
  DocsCallout,
  CodeBlock,
  DocsTable,
  InlineCode,
} from "@/components/docs";
import { SETTINGS_REGISTRY } from "@/lib/config/registry";
import {
  SETTINGS_TABS,
  FIELDS_BY_GROUP,
} from "@/components/admin/features/settings-registry-utils";
import { AI_MODEL_CATALOG } from "@/lib/ai/model-catalog";
import { APP_NAME, TOTAL_CHECKS_LABEL } from "@/lib/config/constants";

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
  { id: "admin-settings", label: "Admin Settings Page" },
  { id: "layer-2", label: "Runtime Secrets" },
  { id: "ai-models", label: "AI Providers & Models" },
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
        description={`${APP_NAME} uses a two-layer config model: non-secret tunables live in TypeScript source, secrets live in your environment. Here's how it all fits together.`}
      />

      <DocsSection id="overview" title="Overview">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          {APP_NAME} has a two-layer configuration model designed to keep
          secrets out of source code while making non-secret deployment settings
          easy to customize for self-hosters.
        </p>
        <DocsCallout variant="info" title="TL;DR">
          Most things you want to change live in{" "}
          <InlineCode>lib/config/config-values.ts</InlineCode>. Secrets go in{" "}
          <InlineCode>.env</InlineCode>. Edit{" "}
          <InlineCode>config-values.ts</InlineCode> first.
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
              what: "Rate limits, feature flags, billing plans, retention",
              where:
                "Admin -> Settings (takes effect within ~30s, no restart). Falls back to lib/config/config-values.ts.",
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
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          <strong className="text-foreground">Single source of truth:</strong>{" "}
          <InlineCode>lib/config/config-values.ts</InlineCode> exports raw{" "}
          <InlineCode>CONFIG_*</InlineCode> constants. Everything else (types,
          derived objects, route maps) is built from those constants. Edit{" "}
          <InlineCode>config-values.ts</InlineCode> to customize your
          deployment.
        </p>
      </DocsSection>

      <DocsSection id="layer-1" title="Layer 1: Static App Config">
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          Edit <InlineCode>lib/config/config-values.ts</InlineCode> to change
          the shipped default for any of these. Whether that edit needs a
          restart depends on the setting&rsquo;s tier: General, Branding, and
          SEO values are baked into the build and need a rebuild either way, but
          most of the rest (rate limits, feature flags, billing, scan timeouts,
          auth windows, and more) can also be overridden at runtime, without
          touching source, from the{" "}
          <a
            href="#admin-settings"
            className="text-primary underline-offset-2 hover:underline"
          >
            Admin Settings Page
          </a>{" "}
          below.
        </p>

        <DocsSubSection id="app-metadata" title="App metadata">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <InlineCode>CONFIG_APP_NAME</InlineCode>: Display name (default:{" "}
              <InlineCode>VulnRadar</InlineCode>)
            </li>
            <li>
              <InlineCode>CONFIG_APP_SLUG</InlineCode>: URL-safe slug
            </li>
            <li>
              <InlineCode>CONFIG_APP_VERSION</InlineCode>: Public version string
            </li>
            <li>
              <InlineCode>CONFIG_MIN_SCHEMA_VERSION</InlineCode>: minimum schema
              version this app accepts (default: <InlineCode>3.0.0</InlineCode>
              ). The app refuses to start if{" "}
              <InlineCode>vulnradar_schema_meta.schema_version</InlineCode> is
              lower.
            </li>
            <li>
              <InlineCode>CONFIG_ENGINE_VERSION</InlineCode>: Detection engine
              version
            </li>
            <li>
              <InlineCode>CONFIG_TOTAL_CHECKS_LABEL</InlineCode>: Marketing
              badge (current: <InlineCode>{TOTAL_CHECKS_LABEL}</InlineCode>)
            </li>
            <li>
              <InlineCode>CONFIG_APP_URL</InlineCode>: Public URL
            </li>
            <li>
              <InlineCode>CONFIG_APP_REPO</InlineCode>: GitHub{" "}
              <InlineCode>owner/repo</InlineCode>
            </li>
            <li>
              <InlineCode>CONFIG_APP_DESCRIPTION</InlineCode>
            </li>
            <li>
              <InlineCode>CONFIG_DISCORD_INVITE_URL</InlineCode>: Optional
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection id="emails" title="Emails">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <InlineCode>CONFIG_SUPPORT_EMAIL</InlineCode>
            </li>
            <li>
              <InlineCode>CONFIG_LEGAL_EMAIL</InlineCode>
            </li>
            <li>
              <InlineCode>CONFIG_SECURITY_EMAIL</InlineCode>: used in{" "}
              <InlineCode>security.txt</InlineCode>
            </li>
            <li>
              <InlineCode>CONFIG_ENTERPRISE_EMAIL</InlineCode>
            </li>
            <li>
              <InlineCode>CONFIG_NOREPLY_EMAIL</InlineCode>: sender for
              transactional email
            </li>
            <li>
              <InlineCode>CONFIG_TERMS_UPDATED_AT</InlineCode>: ISO date; bumped
              when terms change. API-key creation refuses keys from users who
              have not accepted this date.
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection id="branding" title="Branding">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <InlineCode>CONFIG_LOGO_URL</InlineCode>: Path under{" "}
              <InlineCode>/public</InlineCode>
            </li>
            <li>
              <InlineCode>CONFIG_PRIMARY_COLOR</InlineCode>: Hex color
              (informational; the actual brand color is set via the{" "}
              <InlineCode>--primary</InlineCode> CSS variable in{" "}
              <InlineCode>app/globals.css</InlineCode>)
            </li>
            <li>
              <InlineCode>CONFIG_FOOTER_TEXT</InlineCode>
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection id="cookies" title="Cookies">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <InlineCode>CONFIG_SESSION_COOKIE_NAME</InlineCode>,{" "}
              <InlineCode>CONFIG_SESSION_MAX_AGE_DAYS</InlineCode>
            </li>
            <li>
              <InlineCode>CONFIG_VERSION_COOKIE_NAME</InlineCode>,{" "}
              <InlineCode>CONFIG_VERSION_COOKIE_MAX_AGE_DAYS</InlineCode>
            </li>
            <li>
              <InlineCode>CONFIG_DEVICE_TRUST_COOKIE_NAME</InlineCode>,{" "}
              <InlineCode>CONFIG_DEVICE_TRUST_MAX_AGE_DAYS</InlineCode>
            </li>
            <li>
              <InlineCode>CONFIG_2FA_PENDING_COOKIE_NAME</InlineCode>,{" "}
              <InlineCode>CONFIG_2FA_PENDING_MAX_AGE_SECONDS</InlineCode>
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection id="auth-timeouts" title="Authentication timeouts">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <InlineCode>CONFIG_SESSION_TIMEOUT_DAYS</InlineCode> (default:{" "}
              <InlineCode>7</InlineCode>)
            </li>
            <li>
              <InlineCode>CONFIG_PASSWORD_RESET_HOURS</InlineCode> (default:{" "}
              <InlineCode>1</InlineCode>)
            </li>
            <li>
              <InlineCode>CONFIG_EMAIL_VERIFICATION_HOURS</InlineCode> (default:{" "}
              <InlineCode>24</InlineCode>)
            </li>
            <li>
              <InlineCode>CONFIG_DEVICE_TRUST_DAYS</InlineCode> (default:{" "}
              <InlineCode>30</InlineCode>)
            </li>
            <li>
              <InlineCode>CONFIG_TOTP_VALIDITY_SECONDS</InlineCode> (default:{" "}
              <InlineCode>30</InlineCode>)
            </li>
            <li>
              <InlineCode>CONFIG_CLEANUP_INTERVAL_MS</InlineCode> (default:{" "}
              <InlineCode>86400000</InlineCode> = 24h)
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection id="rate-limits" title="Rate limits">
          <p className="text-sm text-muted-foreground">
            All values are per-IP unless noted. The window is in minutes.
            Internally <InlineCode>lib/config/constants.ts</InlineCode>{" "}
            multiplies by 60 for the per-second window.
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

        <DocsSubSection id="scanning" title="Scanning">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <InlineCode>CONFIG_MAX_URL_LENGTH</InlineCode> (default:{" "}
              <InlineCode>2048</InlineCode>)
            </li>
            <li>
              <InlineCode>CONFIG_MAX_URLS_BULK</InlineCode> (default:{" "}
              <InlineCode>100</InlineCode>)
            </li>
            <li>
              <InlineCode>CONFIG_SCAN_TIMEOUT_SECONDS</InlineCode> (default:{" "}
              <InlineCode>300</InlineCode>)
            </li>
            <li>
              <InlineCode>CONFIG_BULK_SCAN_TIMEOUT_SECONDS</InlineCode>{" "}
              (default: <InlineCode>1800</InlineCode>)
            </li>
            <li>
              <InlineCode>CONFIG_DEFAULT_SEVERITY_THRESHOLD</InlineCode>{" "}
              (default: <InlineCode>low</InlineCode>)
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection id="api" title="API">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <InlineCode>CONFIG_API_KEY_PREFIX</InlineCode> (default:{" "}
              <InlineCode>vr_live_</InlineCode>)
            </li>
            <li>
              <InlineCode>CONFIG_DEFAULT_API_KEY_DAILY_LIMIT</InlineCode>{" "}
              (default: <InlineCode>50</InlineCode>): applied when creating a
              new key. A per-key limit override takes precedence over it
            </li>
            <li>
              <InlineCode>CONFIG_API_CURRENT_VERSION</InlineCode> (default:{" "}
              <InlineCode>v3</InlineCode>)
            </li>
            <li>
              <InlineCode>CONFIG_API_SUPPORTED_VERSIONS</InlineCode> (default:{" "}
              <InlineCode>["v3"]</InlineCode>). This is the only version served:
              there is no <InlineCode>/api/v1</InlineCode> or{" "}
              <InlineCode>/api/v2</InlineCode> route tree in this build.
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection id="demo-mode" title="Demo mode">
          <p className="text-sm text-muted-foreground">
            The <InlineCode>/demo</InlineCode> page lets unauthenticated
            visitors run scans. Rate-limited per IP.
          </p>
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <InlineCode>CONFIG_DEMO_SCAN_LIMIT</InlineCode> (default:{" "}
              <InlineCode>5</InlineCode>)
            </li>
            <li>
              <InlineCode>CONFIG_DEMO_WINDOW_HOURS</InlineCode> (default:{" "}
              <InlineCode>12</InlineCode>)
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Disable demo mode entirely with{" "}
            <InlineCode>CONFIG_FEATURE_DEMO_MODE = false</InlineCode>.
          </p>
        </DocsSubSection>

        <DocsSubSection id="db-constraints" title="DB constraints">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <InlineCode>CONFIG_MAX_EMAIL_LENGTH</InlineCode> (default:{" "}
              <InlineCode>255</InlineCode>)
            </li>
            <li>
              <InlineCode>CONFIG_MAX_NAME_LENGTH</InlineCode> (default:{" "}
              <InlineCode>255</InlineCode>)
            </li>
            <li>
              <InlineCode>CONFIG_MAX_DESCRIPTION_LENGTH</InlineCode> (default:{" "}
              <InlineCode>1000</InlineCode>)
            </li>
            <li>
              <InlineCode>CONFIG_MAX_TEAM_NAME_LENGTH</InlineCode> (default:{" "}
              <InlineCode>255</InlineCode>)
            </li>
            <li>
              <InlineCode>CONFIG_MAX_TAGS_PER_SCAN</InlineCode> (default:{" "}
              <InlineCode>10</InlineCode>)
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection id="pagination" title="Pagination">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <InlineCode>CONFIG_PAGINATION_DEFAULT_PAGE_SIZE</InlineCode>{" "}
              (default: <InlineCode>20</InlineCode>)
            </li>
            <li>
              <InlineCode>CONFIG_PAGINATION_MAX_PAGE_SIZE</InlineCode> (default:{" "}
              <InlineCode>100</InlineCode>)
            </li>
            <li>
              <InlineCode>CONFIG_PAGINATION_DEFAULT_PAGE</InlineCode> (default:{" "}
              <InlineCode>1</InlineCode>)
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection id="beta" title="Beta mode">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <InlineCode>CONFIG_BETA_ENABLED</InlineCode> (default:{" "}
              <InlineCode>false</InlineCode>)
            </li>
            <li>
              <InlineCode>CONFIG_BETA_BANNER_MESSAGE</InlineCode>
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection id="feature-flags" title="Feature flags">
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

        <DocsSubSection id="billing" title="Billing">
          <p className="text-sm text-muted-foreground">
            Plan catalogs (limits per plan) live in{" "}
            <InlineCode>lib/billing/catalog.ts</InlineCode>. The values below
            only configure the upper bounds and the retention window.
          </p>
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <InlineCode>CONFIG_BILLING_ENABLED</InlineCode> (default:{" "}
              <InlineCode>true</InlineCode>). Set to{" "}
              <InlineCode>false</InlineCode> to give every user unlimited scans
              (or <InlineCode>CONFIG_BILLING_UNLIMITED_MODE_LIMIT</InlineCode>{" "}
              if set).
            </li>
            <li>
              <InlineCode>CONFIG_BILLING_FREE_LIMIT</InlineCode> (default:{" "}
              <InlineCode>25</InlineCode>)
            </li>
            <li>
              <InlineCode>CONFIG_BILLING_CORE_SUPPORTER_LIMIT</InlineCode>{" "}
              (default: <InlineCode>100</InlineCode>)
            </li>
            <li>
              <InlineCode>CONFIG_BILLING_PRO_SUPPORTER_LIMIT</InlineCode>{" "}
              (default: <InlineCode>150</InlineCode>)
            </li>
            <li>
              <InlineCode>CONFIG_BILLING_ELITE_SUPPORTER_LIMIT</InlineCode>{" "}
              (default: <InlineCode>500</InlineCode>)
            </li>
            <li>
              <InlineCode>CONFIG_BILLING_FREE_RETENTION</InlineCode> (default:{" "}
              <InlineCode>30</InlineCode> days)
            </li>
            <li>
              <InlineCode>CONFIG_BILLING_CORE_SUPPORTER_RETENTION</InlineCode>{" "}
              (default: <InlineCode>90</InlineCode> days)
            </li>
            <li>
              <InlineCode>CONFIG_BILLING_PRO_SUPPORTER_RETENTION</InlineCode>{" "}
              (default: <InlineCode>-1</InlineCode> = forever)
            </li>
            <li>
              <InlineCode>CONFIG_BILLING_ELITE_SUPPORTER_RETENTION</InlineCode>{" "}
              (default: <InlineCode>-1</InlineCode> = forever)
            </li>
            <li>
              <InlineCode>CONFIG_BILLING_UNLIMITED_MODE_LIMIT</InlineCode>{" "}
              (default: <InlineCode>-1</InlineCode>). Used only when{" "}
              <InlineCode>CONFIG_BILLING_ENABLED = false</InlineCode>.
            </li>
          </ul>
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="admin-settings" title="Admin Settings Page">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          {Object.keys(SETTINGS_REGISTRY).length} of the values above also have
          a row in the <InlineCode>system_settings</InlineCode> database table
          and a control on <InlineCode>/admin</InlineCode>
          &rsquo;s Settings tab, sign in as an admin to reach it. The tab list
          there ({SETTINGS_TABS.join(", ")}) and every field on it is generated
          from the same registry that generates the reference tables below, so
          the two cannot drift apart.
        </p>

        <DocsSubSection title="Runtime vs. build tier">
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            Every setting on the page is one of two tiers, shown as a badge per
            tab rather than repeated on every field:
          </p>
          <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">Runtime</strong>: read through{" "}
              <InlineCode>lib/config/runtime-config.ts</InlineCode> on every
              use. Rate limits, feature flags, billing limits, scan timeouts,
              auth windows, AI budgets, and the rest of the request-time values.
              Saving one applies to that server process immediately and to every
              other running instance within the cache TTL.
            </li>
            <li>
              <strong className="text-foreground">Build</strong>: General,
              Branding, and SEO fields (app name, logo, colours, tagline,
              keywords, and similar). These are baked into statically generated
              pages and client bundles at build time. Saving one updates the
              database right away, but the change is only visible after the next
              build and deploy, the Settings page shows a banner on these tabs
              saying so.
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Resolution order and propagation">
          <CodeBlock
            language="text"
            code={`resolve(key) = database value  ??  environment override  ??  shipped default`}
          />
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            The database wins because that is the layer the admin panel edits.
            An environment variable of the same name comes next, so a container
            can pin a value without a database write. The shipped{" "}
            <InlineCode>CONFIG_*</InlineCode> constant is the last resort, which
            is why a fresh install with an empty{" "}
            <InlineCode>system_settings</InlineCode> table behaves exactly as it
            does today.
          </p>
          <DocsCallout variant="info" title="~30 second propagation">
            The resolver caches the whole table for 30 seconds so a value read
            on every request (like a rate limit) does not hit Postgres every
            time. The admin who makes a change sees it immediately (the write
            clears that process&rsquo;s cache); every other running instance
            picks it up the next time its own 30 second cache expires.
          </DocsCallout>
        </DocsSubSection>

        <DocsSubSection title="Reset to default">
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            A field with a database override shows a{" "}
            <InlineCode>Customized</InlineCode> badge and a reset control next
            to it; an unmodified field shows <InlineCode>Default</InlineCode>.
            Reset <strong className="text-foreground">deletes</strong> the
            database row rather than writing today&rsquo;s default value back
            into it. If a later release ships a different default for that
            setting, an instance that reset to default picks up the new default
            automatically on upgrade; an instance that still has an explicit
            override does not, on purpose.
          </p>
        </DocsSubSection>

        <DocsSubSection title="Export">
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            The Export button downloads every setting that currently has a
            database override as JSON, useful for support requests (&ldquo;what
            has this instance customized&rdquo;) and for cloning a configuration
            into a second environment.
          </p>
        </DocsSubSection>

        {SETTINGS_TABS.map((group) => (
          <DocsSubSection key={group} title={group}>
            <DocsTable
              caption={`${group} settings`}
              columns={[
                { key: "setting", header: "Setting", className: "font-mono" },
                { key: "tier", header: "Tier" },
                { key: "type", header: "Type" },
                { key: "default", header: "Default" },
                { key: "description", header: "Description" },
              ]}
              data={FIELDS_BY_GROUP[group].map(([key, def]) => ({
                setting: key,
                tier: def.tier === "build" ? "Build" : "Runtime",
                type: def.type,
                default: String(def.default),
                description: def.help,
              }))}
            />
          </DocsSubSection>
        ))}
      </DocsSection>

      <DocsSection id="layer-2" title="Layer 2: Runtime Secrets">
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          All secrets live in <InlineCode>.env</InlineCode> (or in{" "}
          <InlineCode>docker-compose.yml</InlineCode> as the{" "}
          <InlineCode>environment</InlineCode> block). Runtime validation is
          performed by <InlineCode>lib/config/env.ts</InlineCode> using Zod and
          called from <InlineCode>instrumentation.ts</InlineCode> at server
          startup. A missing or malformed required variable crashes the process
          before it accepts any requests.
        </p>

        <DocsSubSection title="Required">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <InlineCode>DATABASE_URL</InlineCode>: PostgreSQL connection
              string
            </li>
            <li>
              <InlineCode>API_KEY_ENCRYPTION_KEY</InlineCode>: exactly 64 hex
              chars (32 bytes). Used to encrypt stored API keys with
              AES-256-GCM.
            </li>
            <li>
              <InlineCode>NEXT_PUBLIC_APP_URL</InlineCode>: public URL of the
              deployment
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Auth">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <InlineCode>AUTH_SECRET</InlineCode>: used to HMAC-sign the
              Discord OAuth state. Falls back to{" "}
              <InlineCode>API_KEY_ENCRYPTION_KEY</InlineCode> if unset.
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Database">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <InlineCode>DATABASE_SSL</InlineCode>:{" "}
              <InlineCode>true</InlineCode> to require SSL
            </li>
            <li>
              <InlineCode>DATABASE_SSL_CA</InlineCode>: CA cert contents (when
              SSL is on and the CA is not in the system trust store)
            </li>
            <li>
              <InlineCode>TRUSTED_PROXY_CIDR</InlineCode>: comma-separated CIDRs
              used when reading <InlineCode>X-Forwarded-For</InlineCode> for
              client-IP. Example:{" "}
              <InlineCode>
                10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.0/8
              </InlineCode>
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
              <InlineCode>SMTP_HOST</InlineCode>,{" "}
              <InlineCode>SMTP_PORT</InlineCode> (default 587),{" "}
              <InlineCode>SMTP_USER</InlineCode>,{" "}
              <InlineCode>SMTP_PASS</InlineCode>,{" "}
              <InlineCode>SMTP_FROM</InlineCode>
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Stripe (billing)">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <InlineCode>STRIPE_SECRET_KEY</InlineCode>
            </li>
            <li>
              <InlineCode>STRIPE_PUBLISHABLE_KEY</InlineCode>
            </li>
            <li>
              <InlineCode>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</InlineCode>
            </li>
            <li>
              <InlineCode>STRIPE_WEBHOOK_SECRET</InlineCode>: set after running{" "}
              <InlineCode>GET /api/v3/stripe/setup-webhook</InlineCode>
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            If Stripe keys are unset, billing endpoints return 503.
          </p>
        </DocsSubSection>

        <DocsSubSection title="Discord OAuth">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <InlineCode>DISCORD_CLIENT_ID</InlineCode>,{" "}
              <InlineCode>DISCORD_CLIENT_SECRET</InlineCode>: required for{" "}
              <InlineCode>/api/v3/auth/discord</InlineCode>
            </li>
            <li>
              <InlineCode>DISCORD_BOT_TOKEN</InlineCode>,{" "}
              <InlineCode>DISCORD_GUILD_ID</InlineCode>: optional. If both are
              set, the bot auto-adds connecting users to the guild
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Cloudflare Turnstile">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <InlineCode>TURNSTILE_SECRET_KEY</InlineCode>
            </li>
            <li>
              <InlineCode>NEXT_PUBLIC_TURNSTILE_SITE_KEY</InlineCode>
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Turnstile is auto-enabled when the site key is present. It protects
            signup, password reset, contact form, and landing-contact.
          </p>
        </DocsSubSection>

        <DocsSubSection title="Threat reputation & CVE intelligence">
          <p className="text-sm text-muted-foreground">
            The reputation check and the software-inventory CVE correlation are
            all optional. Each source is skipped when its key is unset, and never
            reports a clean result it could not actually verify (a missing key or
            error reads as unavailable, not clean).
          </p>
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <InlineCode>WEB_RISK_API_KEY</InlineCode>: Google Web Risk (malware,
              phishing, unwanted-software listings). Enable the Web Risk API in
              Google Cloud and create a key.
            </li>
            <li>
              <InlineCode>URLHAUS_AUTH_KEY</InlineCode>: URLhaus (abuse.ch) host
              lookup. abuse.ch now requires a free Auth-Key: register at{" "}
              <InlineCode>auth.abuse.ch</InlineCode>.
            </li>
            <li>
              <strong className="text-foreground">Quad9</strong>: a third
              reputation source that needs no key. Quad9 (9.9.9.9) is a security
              DNS resolver; the scan resolves the host through Quad9 and a
              neutral resolver and flags the host when Quad9 blocks it via its
              threat feed. Nothing to configure.
            </li>
            <li>
              <InlineCode>NVD_API_KEY</InlineCode>: optional. The software
              inventory correlates detected versions to CVEs via OSV.dev and the
              NVD REST API. NVD works keyless at a low rate limit; a free key from{" "}
              <InlineCode>nvd.nist.gov/developers</InlineCode> raises it.
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="BrowserBase (live browser sessions)">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <InlineCode>BROWSERBASE_API_KEY</InlineCode>
            </li>
            <li>
              <InlineCode>BROWSERBASE_PROJECT_ID</InlineCode>
            </li>
          </ul>
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            Optional. When both are set, the &ldquo;View Page&rdquo; button on
            scan results opens a remote BrowserBase session in a popup. Each
            session is hard-clamped to 360 seconds (6 minutes). The popup
            auto-ends the session when it closes, so no history is retained
            server-side. See{" "}
            <a
              href="/docs/api#post-browser-sessions"
              className="text-primary hover:underline"
            >
              POST /browser/sessions
            </a>
            .
          </p>
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            Two independent limits apply on top of the per-session cap: a
            monthly minute allowance per plan (30/60/150/400 minutes for
            free/core/pro/elite, purchasable top-ups available in Profile &gt;
            Billing once the free allowance runs out), and an account-wide
            concurrency cap on how many sessions can be open at once across
            every user combined, matching this deployment&rsquo;s actual
            BrowserBase plan. A request that arrives at the concurrency cap
            queues automatically (paid plans admitted ahead of free) instead of
            failing outright.
          </p>
        </DocsSubSection>

        <DocsSubSection title="AI Provider (optional)">
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            AI features (chat, finding verification, audit summaries) work
            against any OpenAI-compatible endpoint or Anthropic&rsquo;s native
            API, resolved in <InlineCode>lib/ai/provider.ts</InlineCode>.
            Without any of these set, AI features stay off.
          </p>
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <InlineCode>AI_BASE_URL</InlineCode>: full base URL of an
              OpenAI-compatible or Anthropic endpoint, e.g.{" "}
              <InlineCode>https://api.anthropic.com/v1</InlineCode> or a local{" "}
              <InlineCode>http://localhost:11434/v1</InlineCode> for Ollama.
              Takes precedence over <InlineCode>AI_PROVIDER</InlineCode>.
            </li>
            <li>
              <InlineCode>AI_PROVIDER</InlineCode>: shorthand for a known
              provider (<InlineCode>openai</InlineCode>,{" "}
              <InlineCode>anthropic</InlineCode>,{" "}
              <InlineCode>minimax</InlineCode>, <InlineCode>groq</InlineCode>,{" "}
              <InlineCode>mistral</InlineCode>,{" "}
              <InlineCode>openrouter</InlineCode>,{" "}
              <InlineCode>ollama</InlineCode>, <InlineCode>lmstudio</InlineCode>
              , <InlineCode>together</InlineCode>,{" "}
              <InlineCode>deepseek</InlineCode>) instead of a full URL. Ignored
              if <InlineCode>AI_BASE_URL</InlineCode> is set.
            </li>
            <li>
              <InlineCode>AI_MODEL</InlineCode>: model id to call. If unset,{" "}
              <InlineCode>resolveAiDefaultModel()</InlineCode> picks a
              reasonable default per provider (e.g.{" "}
              <InlineCode>llama3.2</InlineCode> for Ollama).
            </li>
            <li>
              <InlineCode>AI_API_KEY</InlineCode>: API key for the resolved
              endpoint. Not needed for a local endpoint that does not require
              one.
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Debug: DISABLE_CSP=1">
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            Set <InlineCode>DISABLE_CSP=1</InlineCode> in{" "}
            <InlineCode>.env.local</InlineCode> to ship the app{" "}
            <strong className="text-foreground">without</strong> any CSP, COOP,
            CORP, X-Frame-Options, or Permissions-Policy headers. Use this when
            debugging a third-party embed (BrowserBase, Turnstile, embedded
            videos, etc.) and you want to confirm whether CSP is the blocker.{" "}
            <strong className="text-foreground">
              Never set this in production.
            </strong>
          </p>
        </DocsSubSection>

        <DocsSubSection title="Contact / support overrides">
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <InlineCode>CONTACT_EMAIL</InlineCode>,{" "}
              <InlineCode>SUPPORT_EMAIL</InlineCode>: override the addresses
              used by contact/support emails (defaults come from{" "}
              <InlineCode>CONFIG_*</InlineCode>).
            </li>
          </ul>
        </DocsSubSection>

        <DocsSubSection title="Docker-only">
          <p className="text-sm text-muted-foreground">
            Read by <InlineCode>docker-compose.yml</InlineCode>; not used by the
            app itself.
          </p>
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <InlineCode>POSTGRES_USER</InlineCode>,{" "}
              <InlineCode>POSTGRES_PASSWORD</InlineCode>,{" "}
              <InlineCode>POSTGRES_DB</InlineCode>
            </li>
            <li>
              <InlineCode>APP_PORT</InlineCode> (default 3000),{" "}
              <InlineCode>DB_PORT</InlineCode> (default 5432)
            </li>
          </ul>
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="ai-models" title="AI Providers & Models">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Real context-window and max-output-token limits per model, for every
          provider currently in <InlineCode>lib/ai/model-catalog.ts</InlineCode>
          . Numbers come straight from each provider&rsquo;s own published
          specs; a model is left off entirely rather than guessed at, so an
          empty cell here means the number was not independently verified, not
          that the model has no limit.
        </p>

        <DocsTable
          caption="Context window and max output tokens per AI model, from lib/ai/model-catalog.ts"
          columns={[
            { key: "provider", header: "Provider" },
            { key: "model", header: "Model" },
            { key: "context", header: "Context window" },
            { key: "maxOutput", header: "Max output tokens" },
            { key: "notes", header: "Notes", className: "w-full" },
          ]}
          data={AI_MODEL_CATALOG.flatMap((provider) =>
            provider.models.map((model) => ({
              provider: provider.name,
              model: model.label,
              context: model.contextWindow
                ? model.contextWindow.toLocaleString()
                : "not verified",
              maxOutput: model.maxOutputTokens
                ? model.maxOutputTokens.toLocaleString()
                : "not verified",
              notes:
                [
                  model.supportsThinking ? "Supports extended thinking." : "",
                  model.note ?? "",
                ]
                  .filter(Boolean)
                  .join(" ") || "-",
            })),
          )}
        />

        <DocsCallout variant="warning" title="AI features need real context">
          <p>
            Verifying findings or summarizing a full scan means loading a lot of
            scan output into the prompt. As a floor, look for a model with
            around <strong className="text-foreground">300,000 tokens</strong>{" "}
            of context. A small local model such as Ollama&rsquo;s default{" "}
            <InlineCode>llama3.2</InlineCode> has nowhere near that: it will
            degrade or break outright as more context gets loaded. See{" "}
            <a
              href="/docs/self-hosting#ai"
              className="text-primary underline-offset-2 hover:underline"
            >
              Self-Hosting
            </a>{" "}
            before pointing AI features at a local model.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="checklist" title="Self-Hosting Checklist">
        <ol className="list-decimal pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            Edit <InlineCode>lib/config/config-values.ts</InlineCode>: app name,
            URL, emails, branding.
          </li>
          <li>
            Generate an encryption key:{" "}
            <InlineCode>
              node -e
              "console.log(require('crypto').randomBytes(32).toString('hex'))"
            </InlineCode>
          </li>
          <li>
            Create <InlineCode>.env</InlineCode> from{" "}
            <InlineCode>cp .env.example .env</InlineCode> and fill in
            DATABASE_URL, API_KEY_ENCRYPTION_KEY, NEXT_PUBLIC_APP_URL.
          </li>
          <li>
            Provision Postgres (via{" "}
            <InlineCode>docker compose up -d postgres</InlineCode> or external)
            and ensure DATABASE_URL points to it.
          </li>
          <li>
            Start the app (<InlineCode>npm run dev</InlineCode> or{" "}
            <InlineCode>docker compose up app</InlineCode>). Schema auto-creates
            on first boot; meta row is written on first scan via{" "}
            <InlineCode>db:migrate</InlineCode>.
          </li>
          <li>
            Sign up the first user via <InlineCode>/signup</InlineCode>, then
            promote via SQL:
            <br />
            <InlineCode>
              docker compose exec postgres psql -U vulnradar -d vulnradar -c
              "UPDATE users SET role = &apos;admin&apos; WHERE email =
              &apos;you@example.com&apos;"
            </InlineCode>
          </li>
          <li>
            (Optional) Configure SMTP, Stripe, Discord, Turnstile in{" "}
            <InlineCode>.env</InlineCode> and restart.
          </li>
        </ol>
      </DocsSection>

      <DocsSection id="validation" title="Validation">
        <p className="text-sm text-muted-foreground">
          The config system has three validation gates, each catching a
          different class of mistake:
        </p>
        <ol className="list-decimal pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">Build time:</strong>{" "}
            <InlineCode>npm run typecheck</InlineCode> exercises every{" "}
            <InlineCode>CONFIG_*</InlineCode> through the typed{" "}
            <InlineCode>DEFAULT_CONFIG</InlineCode> in{" "}
            <InlineCode>lib/types/config.ts</InlineCode>. Renaming or removing a
            constant fails typecheck.
          </li>
          <li>
            <strong className="text-foreground">Server startup:</strong>{" "}
            <InlineCode>lib/config/env.ts</InlineCode> validates every required
            environment variable with Zod. A missing or malformed value throws
            before any request is served.
          </li>
          <li>
            <strong className="text-foreground">First scan:</strong>{" "}
            <InlineCode>instrumentation.ts</InlineCode> reads{" "}
            <InlineCode>vulnradar_schema_meta</InlineCode> and refuses to start
            if <InlineCode>schema_version</InlineCode> is below{" "}
            <InlineCode>CONFIG_MIN_SCHEMA_VERSION</InlineCode>.
          </li>
        </ol>
      </DocsSection>
    </div>
  );
}
