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
  { id: "hardware", label: "Hardware Requirements" },
  { id: "prerequisites", label: "Prerequisites" },
  { id: "clone", label: "Clone and Configure" },
  { id: "env", label: "Create .env" },
  { id: "docker", label: "Configure docker-compose" },
  { id: "start", label: "Start the Stack" },
  { id: "schema", label: "Initialize the Schema" },
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
        description="VulnRadar is GPL-3.0 and can be self-hosted with Docker. This guide walks through a production deployment end to end."
      />

      <DocsSection id="overview" title="Overview">
        <p>
          The fastest way to run VulnRadar yourself. Assumes a single Linux
          server with Docker. For Kubernetes, multi-region, or bare-metal
          setups, adapt accordingly.
        </p>
        <DocsCallout variant="info" title="Time estimate">
          ~30 minutes if you already have Docker + a domain pointed at your
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
              workload: "Public SaaS (100s users)",
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
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
          <li>
            Linux server (Ubuntu 22.04 LTS recommended) or any host with Docker
          </li>
          <li>Docker 24+ and Docker Compose v2</li>
          <li>A domain name with DNS pointing to the server</li>
          <li>
            (Production) A reverse proxy: Caddy, Traefik, or nginx with TLS
          </li>
        </ul>
      </DocsSection>

      <DocsSection id="clone" title="Clone and Configure">
        <CodeBlock
          language="bash"
          code={`git clone https://github.com/VulnRadar/vulnradar.dev.git
cd vulnradar.dev

# Generate a 32-byte API encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# → paste into API_KEY_ENCRYPTION_KEY`}
        />
        <p>
          Edit <code>lib/config/config-values.ts</code> to set:
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
        <p>If you don&apos;t want billing features, set:</p>
        <CodeBlock
          language="typescript"
          code={`export const CONFIG_BILLING_ENABLED = false;`}
        />
      </DocsSection>

      <DocsSection id="env" title="Create .env">
        <CodeBlock language="bash" code={`cp .env.example .env`} />
        <p>Fill in real values:</p>
        <CodeBlock
          language="bash"
          code={`# Required
DATABASE_URL=postgresql://vulnradar:STRONG_PASSWORD@postgres:5432/vulnradar
DATABASE_SSL=false
API_KEY_ENCRYPTION_KEY=<paste your 64-char hex from step 2>
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

# Optional: Cloudflare Turnstile captcha
NEXT_PUBLIC_TURNSTILE_SITE_KEY=...
TURNSTILE_SECRET_KEY=...

# Optional: Stripe billing (only if CONFIG_BILLING_ENABLED=true)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...`}
        />
      </DocsSection>

      <DocsSection id="docker" title="Configure docker-compose">
        <p>
          The default <code>docker-compose.yml</code> works out of the box. The
          app reads <code>.env</code> from the host (via <code>env_file</code>).
          For production, set secrets via Docker secrets or your secret manager
          instead of a <code>.env</code> file on disk.
        </p>
      </DocsSection>

      <DocsSection id="start" title="Start the Stack">
        <CodeBlock
          language="bash"
          code={`docker compose up -d
docker compose logs -f app   # watch startup`}
        />
        <p>Look for:</p>
        <CodeBlock
          language="text"
          code={`✓ Database initialized
✓ Listening on http://0.0.0.0:3000`}
        />
      </DocsSection>

      <DocsSection id="schema" title="Initialize the Schema">
        <CodeBlock
          language="bash"
          code={`docker compose exec app npm run db:create`}
        />
        <p>
          This is idempotent (CREATE TABLE IF NOT EXISTS). Safe to re-run on
          every deploy.
        </p>
        <DocsCallout variant="info" title="Migrations on existing databases">
          If you&apos;re upgrading an existing deployment with data, use{" "}
          <code>npm run db:migrate</code> instead — it diffs the live schema
          against <code>instrumentation.ts</code> and applies only the changes,
          with confirmation before each step.
        </DocsCallout>
      </DocsSection>

      <DocsSection id="admin" title="First Admin User">
        <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
          <li>
            Visit <code>https://scanner.yourdomain.com/signup</code> and create
            an account
          </li>
          <li>
            From your DB client, promote the user:
            <CodeBlock
              language="sql"
              code={`UPDATE users
SET role = 'admin'
WHERE email = 'you@yourdomain.com';`}
            />
          </li>
          <li>
            Sign out and back in. The <code>/admin</code> route is now
            accessible.
          </li>
        </ol>
      </DocsSection>

      <DocsSection id="tls" title="TLS (Reverse Proxy)">
        <p>
          VulnRadar does not terminate TLS itself. Put a reverse proxy in front.
          Minimal Caddy config:
        </p>
        <CodeBlock
          language="caddyfile"
          code={`scanner.yourdomain.com {
    reverse_proxy localhost:3000
    encode zstd gzip
}`}
        />
        <p>Caddy auto-provisions a Let&apos;s Encrypt cert.</p>
        <p>
          For nginx, see the{" "}
          <a
            href="https://nextjs.org/docs/app/building-your-application/deploying#nginx"
            target="_blank"
            rel="noopener noreferrer"
          >
            official nginx + Next.js guide
          </a>
          .
        </p>
      </DocsSection>

      <DocsSection id="stripe" title="Configure Stripe Webhook (If Billing)">
        <p>
          If you set <code>CONFIG_BILLING_ENABLED = true</code>:
        </p>
        <ol className="list-decimal pl-6 space-y-2 text-muted-foreground">
          <li>
            In your Stripe dashboard, create a webhook:
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>
                URL:{" "}
                <code>
                  https://scanner.yourdomain.com/api/v2/webhooks/stripe
                </code>
              </li>
              <li>
                Events: <code>checkout.session.completed</code>,{" "}
                <code>customer.subscription.created</code>,{" "}
                <code>customer.subscription.updated</code>,{" "}
                <code>customer.subscription.deleted</code>,{" "}
                <code>invoice.payment_succeeded</code>,{" "}
                <code>invoice.payment_failed</code>
              </li>
            </ul>
          </li>
          <li>
            Copy the signing secret into <code>STRIPE_WEBHOOK_SECRET</code> in{" "}
            <code>.env</code>
          </li>
          <li>
            <code>docker compose restart app</code>
          </li>
        </ol>
        <p>Alternatively, use the auto-setup endpoint:</p>
        <CodeBlock
          language="bash"
          code={`curl https://scanner.yourdomain.com/api/v2/stripe/setup-webhook
# returns the webhookSecret to paste into .env`}
        />
      </DocsSection>

      <DocsSection id="backups" title="Backups">
        <CodeBlock
          language="bash"
          code={`# Database
docker compose exec postgres pg_dump -U vulnradar vulnradar > backup-$(date +%F).sql

# Restore
cat backup-2026-06-18.sql | docker compose exec -T postgres psql -U vulnradar vulnradar`}
        />
        <p>
          Automate with cron + <code>docker compose exec</code>. Or use a
          managed Postgres with automated backups.
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
        <p>Watch logs for migrations or new env vars.</p>
        <DocsCallout variant="warning" title="After schema changes">
          If <code>instrumentation.ts</code> changed, run{" "}
          <code>docker compose exec app npm run db:migrate</code> to apply the
          diff. The script will ask before each change.
        </DocsCallout>
      </DocsSection>

      <DocsSection id="troubleshooting" title="Troubleshooting">
        <DocsTable
          columns={[
            { key: "symptom", header: "Symptom" },
            { key: "cause", header: "Cause" },
            { key: "fix", header: "Fix" },
          ]}
          data={[
            {
              symptom: "Database initialized then crash",
              cause: "DB not reachable",
              fix: "Check DATABASE_URL and DATABASE_SSL",
            },
            {
              symptom: "Build fails: API_KEY_ENCRYPTION_KEY required",
              cause: "Missing env var at build",
              fix: "Dockerfile provides placeholder; check runtime env",
            },
            {
              symptom: "Config validation failed at runtime",
              cause: "Misconfigured config-values.ts",
              fix: "Check TypeScript errors: npm run typecheck",
            },
            {
              symptom: "502 from reverse proxy",
              cause: "App not listening on 0.0.0.0:3000",
              fix: "Check APP_PORT env var (default 3000)",
            },
            {
              symptom: "Stripe webhook 400s",
              cause: "Wrong signing secret",
              fix: "Re-copy from Stripe dashboard, restart app",
            },
          ]}
        />
      </DocsSection>

      <DocsSection id="security" title="Security Checklist">
        <ul className="space-y-2 text-muted-foreground">
          {[
            "TLS via reverse proxy (Caddy/Traefik/nginx)",
            "Strong API_KEY_ENCRYPTION_KEY (32 random bytes)",
            "Strong POSTGRES_PASSWORD",
            "SMTP credentials use app-specific password (not account password)",
            "Stripe restricted keys (only needed permissions)",
            "Discord OAuth uses HTTPS redirect URI",
            "Backups automated daily",
            "CONFIG_BILLING_ENABLED = false if you don't want paid tiers",
            "https://yourdomain.com/.well-known/security.txt reachable",
            "Cloudflare Turnstile enabled to prevent signup abuse",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" aria-label={item} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground mt-4">
          See <a href="/docs/security">SECURITY.md</a> for the full security
          policy and how to report vulnerabilities.
        </p>
      </DocsSection>
    </div>
  );
}
