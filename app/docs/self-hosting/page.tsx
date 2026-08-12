"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { APP_NAME, APP_REPO } from "@/lib/config/constants";
import { useDocsContext, type TocItem } from "@/components/docs/docs-shell";
import {
  DocsHero,
  DocsSection,
  DocsCallout,
  CodeBlock,
  DocsTable,
  InlineCode,
} from "@/components/docs";

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "hardware", label: "Hardware Requirements" },
  { id: "prerequisites", label: "Prerequisites" },
  { id: "clone", label: "Clone and Configure" },
  { id: "env", label: "Create .env" },
  { id: "ai", label: "AI Features (Optional)" },
  { id: "docker", label: "docker-compose" },
  { id: "start", label: "Start the Stack" },
  { id: "admin", label: "First Admin User" },
  { id: "tls", label: "TLS (Reverse Proxy)" },
  { id: "stripe", label: "Configure Stripe Webhook" },
  { id: "backups", label: "Backups" },
  { id: "updates", label: "Updates" },
  { id: "troubleshooting", label: "Troubleshooting" },
  { id: "security", label: "Security Checklist" },
];

export default function SelfHostingPage() {
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
        badge="Deployment"
        title="Self-Hosting"
        description={`${APP_NAME} is GPL-3.0 and can be self-hosted with Docker. This guide walks through a production deployment end to end.`}
      />

      <DocsSection id="overview" title="Overview">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          The fastest path to running {APP_NAME} yourself. Assumes a single
          Linux server with Docker. For Kubernetes, multi-region, or bare-metal
          setups, adapt accordingly.
        </p>
        <DocsCallout variant="info" title="Time estimate">
          About 30 minutes if you already have Docker + a domain pointed at your
          server.
        </DocsCallout>
      </DocsSection>

      <DocsSection id="hardware" title="Hardware Requirements">
        <DocsTable
          columns={[
            { key: "workload", header: "Workload" },
            { key: "cpu", header: "CPU" },
            { key: "ram", header: "RAM" },
            { key: "disk", header: "Disk" },
          ]}
          data={[
            {
              workload: "Demo / personal use",
              cpu: "1 vCPU",
              ram: "1 GB",
              disk: "20 GB",
            },
            {
              workload: "Small team (10 users)",
              cpu: "2 vCPU",
              ram: "2 GB",
              disk: "50 GB",
            },
            {
              workload: "Public SaaS (100s of users)",
              cpu: "4+ vCPU",
              ram: "8+ GB",
              disk: "200+ GB",
            },
          ]}
        />
        <DocsCallout variant="info">
          A managed PostgreSQL (Neon, Supabase, RDS) is recommended over running
          your own DB.
        </DocsCallout>
      </DocsSection>

      <DocsSection id="prerequisites" title="Prerequisites">
        <ul className="list-disc pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            Linux server (Ubuntu 22.04+ recommended) or any host with Docker
          </li>
          <li>Docker 24+ and Docker Compose v2</li>
          <li>A domain name with DNS pointing to the server</li>
          <li>
            (Production) A reverse proxy (Caddy, Traefik, or nginx) for TLS
            termination
          </li>
        </ul>
      </DocsSection>

      <DocsSection id="clone" title="Clone and Configure">
        <CodeBlock
          language="bash"
          code={`git clone https://github.com/${APP_REPO}.git
cd vulnradar.dev

# Generate a 32-byte API encryption key (64 hex chars)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# → paste into API_KEY_ENCRYPTION_KEY`}
        />
        <p className="text-sm text-muted-foreground">
          Edit <InlineCode>lib/config/config-values.ts</InlineCode> to set:
        </p>
        <CodeBlock
          language="typescript"
          code={`export const CONFIG_APP_NAME = "YourBrand Scanner";
export const CONFIG_APP_URL = "https://scanner.yourdomain.com";
export const CONFIG_APP_REPO = "yourname/your-repo";
export const CONFIG_DISCORD_INVITE_URL = ""; // optional

export const CONFIG_SUPPORT_EMAIL = "support@yourdomain.com";
export const CONFIG_LEGAL_EMAIL = "legal@yourdomain.com";
export const CONFIG_SECURITY_EMAIL = "security@yourdomain.com";
export const CONFIG_ENTERPRISE_EMAIL = "enterprise@yourdomain.com";
export const CONFIG_NOREPLY_EMAIL = "noreply@yourdomain.com";`}
        />
        <p className="text-sm text-muted-foreground">
          If you don&apos;t want billing features, set:
        </p>
        <CodeBlock
          language="typescript"
          code={`export const CONFIG_BILLING_ENABLED = false;`}
        />
        <p className="text-sm text-muted-foreground">
          Full reference on the{" "}
          <Link
            href="/docs/config"
            className="text-primary underline-offset-2 hover:underline"
          >
            Configuration
          </Link>{" "}
          page.
        </p>
      </DocsSection>

      <DocsSection id="env" title="Create .env">
        <CodeBlock language="bash" code={`cp .env.example .env`} />
        <p className="text-sm text-muted-foreground">Fill in real values:</p>
        <CodeBlock
          language="bash"
          code={`# Required
DATABASE_URL=postgresql://vulnradar:STRONG_PASSWORD@postgres:5432/vulnradar
DATABASE_SSL=false
API_KEY_ENCRYPTION_KEY=<paste your 64-char hex>
NEXT_PUBLIC_APP_URL=https://scanner.yourdomain.com

# Optional: SMTP for transactional email
SMTP_HOST=smtp.yourdomain.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=noreply@yourdomain.com

# Optional: Discord OAuth
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_BOT_TOKEN=...
DISCORD_GUILD_ID=...

# Optional: Cloudflare Turnstile
NEXT_PUBLIC_TURNSTILE_SITE_KEY=...
TURNSTILE_SECRET_KEY=...

# Optional: Stripe (only if CONFIG_BILLING_ENABLED=true)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...`}
        />
      </DocsSection>

      <DocsSection id="ai" title="AI Features (Optional)">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Chat, finding verification, and audit summaries are off unless you
          point them at an AI endpoint. Add to <InlineCode>.env</InlineCode>:{" "}
          <InlineCode>AI_BASE_URL</InlineCode> (or the{" "}
          <InlineCode>AI_PROVIDER</InlineCode> shorthand),{" "}
          <InlineCode>AI_MODEL</InlineCode>, and{" "}
          <InlineCode>AI_API_KEY</InlineCode>. Full variable reference and a
          real per-model context-window / max-output-token table are on{" "}
          <Link
            href="/docs/config#ai-models"
            className="text-primary underline-offset-2 hover:underline"
          >
            Configuration → AI Providers & Models
          </Link>
          .
        </p>
        <DocsCallout variant="warning" title="Bring a real context window">
          <p>
            These features load actual scan output into the prompt, not a short
            chat message. As a floor, use a model with around{" "}
            <strong className="text-foreground">300,000 tokens</strong> of
            context. A small local model, e.g. Ollama&rsquo;s default{" "}
            <InlineCode>llama3.2</InlineCode>, does not have that headroom and
            will degrade or break outright once enough context is loaded.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="docker" title="docker-compose">
        <p className="text-sm text-muted-foreground">
          The default <InlineCode>docker-compose.yml</InlineCode> provisions
          Postgres + the app container + a healthcheck + a smoke test. The app
          reads <InlineCode>.env</InlineCode> via{" "}
          <InlineCode>env_file</InlineCode>.
        </p>
        <DocsCallout variant="info">
          For production, prefer Docker secrets or a secret manager over a plain{" "}
          <InlineCode>.env</InlineCode> file on disk.
        </DocsCallout>
      </DocsSection>

      <DocsSection id="start" title="Start the Stack">
        <CodeBlock
          language="bash"
          code={`docker compose up -d
docker compose logs -f app   # watch startup`}
        />
        <p className="text-sm text-muted-foreground">
          On boot, <InlineCode>instrumentation.ts</InlineCode> runs{" "}
          <InlineCode>CREATE TABLE IF NOT EXISTS</InlineCode> for every table.
          The meta row in <InlineCode>vulnradar_schema_meta</InlineCode> is
          written on the first successful migration. Look for{" "}
          <InlineCode>Database schema verified successfully</InlineCode> in the
          logs.
        </p>
      </DocsSection>

      <DocsSection id="admin" title="First Admin User">
        <ol className="list-decimal pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            Visit <InlineCode>https://scanner.yourdomain.com/signup</InlineCode>{" "}
            and create an account. (Running without Docker, e.g. for local
            development? Create the schema first with{" "}
            <InlineCode>npm run db:create</InlineCode>.)
          </li>
          <li>
            Connect to Postgres and promote the user:
            <CodeBlock
              language="sql"
              code={`UPDATE users
SET role = 'admin'
WHERE email = 'you@yourdomain.com';`}
            />
          </li>
          <li>
            Sign out and back in. The <InlineCode>/admin</InlineCode> route is
            now accessible.
          </li>
          <li>
            Open <InlineCode>/admin</InlineCode>, go to Settings, and set your
            rate limits, feature flags, billing limits, and retention windows
            there instead of editing{" "}
            <InlineCode>lib/config/config-values.ts</InlineCode> for anything
            that page covers. Those changes take effect for every running
            instance within about 30 seconds, no rebuild or restart needed.
            <InlineCode>config-values.ts</InlineCode> is still where you edit
            the app name, branding, and SEO metadata, since those are baked into
            the build.
          </li>
        </ol>
        <DocsCallout variant="info">
          Full reference on which settings live where:{" "}
          <Link
            href="/docs/config#admin-settings"
            className="text-primary underline-offset-2 hover:underline"
          >
            Configuration → Admin Settings Page
          </Link>
          .
        </DocsCallout>
      </DocsSection>

      <DocsSection id="tls" title="TLS (Reverse Proxy)">
        <p className="text-sm text-muted-foreground">
          {APP_NAME} does not terminate TLS itself. Put a reverse proxy in
          front. Minimal Caddy config:
        </p>
        <CodeBlock
          language="caddyfile"
          code={`scanner.yourdomain.com {
    reverse_proxy localhost:3000
    encode zstd gzip
}`}
        />
        <p className="text-sm text-muted-foreground">
          Caddy auto-provisions a Let&apos;s Encrypt certificate.
        </p>
        <p className="text-sm text-muted-foreground">
          For nginx, see the{" "}
          <a
            href="https://nextjs.org/docs/app/building-your-application/deploying#nginx"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline-offset-2 hover:underline"
          >
            official nginx + Next.js guide
          </a>
          .
        </p>
      </DocsSection>

      <DocsSection id="stripe" title="Configure Stripe Webhook (If Billing)">
        <DocsCallout variant="info">
          Skip this section if{" "}
          <InlineCode>CONFIG_BILLING_ENABLED = false</InlineCode>.
        </DocsCallout>

        <h4 className="text-sm font-semibold mb-3 mt-2">
          Option A: Stripe dashboard
        </h4>
        <ol className="list-decimal pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            In the Stripe dashboard, create a webhook:
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>
                URL:{" "}
                <InlineCode>
                  https://scanner.yourdomain.com/api/v3/webhooks/stripe
                </InlineCode>
              </li>
              <li>
                Events: <InlineCode>checkout.session.completed</InlineCode>,{" "}
                <InlineCode>customer.subscription.created</InlineCode>,{" "}
                <InlineCode>customer.subscription.updated</InlineCode>,{" "}
                <InlineCode>customer.subscription.deleted</InlineCode>,{" "}
                <InlineCode>invoice.payment_succeeded</InlineCode>,{" "}
                <InlineCode>invoice.payment_failed</InlineCode>
              </li>
            </ul>
          </li>
          <li>
            Copy the signing secret into{" "}
            <InlineCode>STRIPE_WEBHOOK_SECRET</InlineCode> in{" "}
            <InlineCode>.env</InlineCode>.
          </li>
          <li>
            <InlineCode>docker compose restart app</InlineCode>
          </li>
        </ol>

        <h4 className="text-sm font-semibold mb-3 mt-6">
          Option B: auto-setup endpoint
        </h4>
        <p className="max-w-[68ch] text-sm text-muted-foreground mb-2">
          <InlineCode>GET /api/v3/stripe/setup-webhook</InlineCode> registers
          the webhook in Stripe and returns the signing secret, but only when
          the secret is not yet stored. After first run it returns{" "}
          <InlineCode>{`{ success: true, configured: true }`}</InlineCode> with
          no secret. The endpoint requires an admin session unless the webhook
          is already configured.
        </p>
        <DocsCallout variant="warning">
          Using <InlineCode>curl</InlineCode> against this endpoint without an
          admin session cookie will get 401. Log in as admin in a browser, copy
          the session cookie, and pass it as{" "}
          <InlineCode>-b &quot;cookie.txt&quot;</InlineCode> in curl.
        </DocsCallout>
        <CodeBlock
          language="bash"
          code={`# Log in via the web UI as an admin user, then export the cookie:
curl -b cookies.txt https://scanner.yourdomain.com/api/v3/stripe/setup-webhook
# First call: returns { success: true, webhookSecret: "whsec_..." }
# Paste the secret into STRIPE_WEBHOOK_SECRET in .env and restart.`}
        />
      </DocsSection>

      <DocsSection id="backups" title="Backups">
        <CodeBlock
          language="bash"
          code={`# Database dump
docker compose exec postgres pg_dump -U vulnradar vulnradar > backup-$(date +%F).sql

# Restore
cat backup-2026-06-18.sql | docker compose exec -T postgres psql -U vulnradar vulnradar`}
        />
        <p className="text-sm text-muted-foreground">
          Automate with cron + <InlineCode>docker compose exec</InlineCode>, or
          use a managed Postgres with built-in automated backups.
        </p>
      </DocsSection>

      <DocsSection id="updates" title="Updates">
        <CodeBlock
          language="bash"
          code={`cd vulnradar.dev
git pull
docker compose build app
docker compose up -d`}
        />
        <p className="text-sm text-muted-foreground">
          Watch the logs for new env-var requirements or schema changes.
        </p>
        <DocsCallout variant="warning" title="After schema changes">
          If <InlineCode>instrumentation.ts</InlineCode> changed in the new
          release, run <InlineCode>npm run db:migrate</InlineCode> inside the
          app container to apply the diff interactively. The script is
          idempotent; safe to re-run.
        </DocsCallout>
      </DocsSection>

      <DocsSection id="troubleshooting" title="Troubleshooting">
        <DocsTable
          columns={[
            { key: "symptom", header: "Symptom" },
            { key: "cause", header: "Likely cause" },
            { key: "fix", header: "Fix" },
          ]}
          data={[
            {
              symptom: "App crashes after schema verify",
              cause: "DATABASE_URL unreachable",
              fix: "Check DATABASE_URL and DATABASE_SSL; confirm Postgres accepts the connection.",
            },
            {
              symptom: "Schema version mismatch on startup",
              cause:
                "vulnradar_schema_meta.schema_version < CONFIG_MIN_SCHEMA_VERSION",
              fix: "Run npm run db:migrate (or upgrade CONFIG_MIN_SCHEMA_VERSION to match if you just want to skip).",
            },
            {
              symptom: "API_KEY_ENCRYPTION_KEY invalid",
              cause: "Not 64 hex chars, or unset",
              fix: "Generate one: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
            },
            {
              symptom: "Build fails: TypeScript errors in lib/config",
              cause:
                "Renamed a CONFIG_* constant without updating the typed DEFAULT_CONFIG",
              fix: "Run npm run typecheck; the error points at the exact field.",
            },
            {
              symptom: "502 from reverse proxy",
              cause: "App not listening on the expected port",
              fix: "Check APP_PORT (default 3000); confirm the app container is up via docker compose ps.",
            },
            {
              symptom: "Stripe webhook 400s",
              cause: "Wrong signing secret or missing STRIPE_WEBHOOK_SECRET",
              fix: "Re-copy from Stripe dashboard, restart app.",
            },
            {
              symptom: "Login succeeds but 2FA code never arrives",
              cause: "SMTP not configured",
              fix: "Set SMTP_HOST/PORT/USER/PASS/FROM in .env and restart, or disable 2FA via /api/v3/auth/2fa/disable.",
            },
          ]}
        />
      </DocsSection>

      <DocsSection id="security" title="Security Checklist">
        <ul className="space-y-2 text-sm text-muted-foreground">
          {[
            "TLS via reverse proxy (Caddy / Traefik / nginx)",
            "Strong API_KEY_ENCRYPTION_KEY (32 random bytes, base16)",
            "Strong POSTGRES_PASSWORD",
            "SMTP credentials use an app-specific password",
            "Stripe uses restricted keys (only required permissions)",
            "Discord OAuth redirect URI is HTTPS",
            "Backups automated daily with off-host retention",
            "CONFIG_BILLING_ENABLED = false if you do not need paid tiers",
            "https://yourdomain.com/.well-known/security.txt is reachable",
            "Cloudflare Turnstile enabled to prevent signup abuse",
            "For a high-security deployment, consider enabling session and/or API key IP binding in Admin -> Settings -> Authentication (off by default)",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1 accent-primary"
                aria-label={item}
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <DocsCallout variant="info">
          <p>
            The full security policy and disclosure procedure live in{" "}
            <InlineCode>SECURITY.md</InlineCode> at the repo root and are served
            at <InlineCode>/.well-known/security.txt</InlineCode>.
          </p>
        </DocsCallout>
      </DocsSection>
    </div>
  );
}
