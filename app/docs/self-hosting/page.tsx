import Link from "next/link";
import { APP_NAME, APP_REPO } from "@/lib/config/constants";
import type { TocItem } from "@/components/docs/docs-types";
import { DocsTocSpy } from "../docs-toc-spy";
import {
  DocsHero,
  DocsSection,
  DocsSubSection,
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
  { id: "renaming", label: "Renaming a fork" },
  { id: "troubleshooting", label: "Troubleshooting" },
  { id: "security", label: "Security Checklist" },
];

export default function SelfHostingPage() {
  return (
    <div className="space-y-16">
      <DocsTocSpy items={tocItems} />
      <DocsHero
        id="top"
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
          Postgres and the app container, each with a healthcheck, and the app
          waits for Postgres to report healthy before it starts. The app reads{" "}
          <InlineCode>.env</InlineCode> via <InlineCode>env_file</InlineCode>,
          so every variable in that file reaches the container; the values
          compose derives itself, such as the in-network database URL, are set
          on the service and take precedence.
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
            Nothing to run. The first account created on a fresh instance is
            given the <InlineCode>super_admin</InlineCode> role automatically,
            so signing up is all that is needed. Do not run an{" "}
            <InlineCode>UPDATE users SET role = &apos;admin&apos;</InlineCode>{" "}
            against it: <InlineCode>admin</InlineCode> is a lower level than{" "}
            <InlineCode>super_admin</InlineCode>, so that demotes the account,
            and no screen in the product can put it back.
            <CodeBlock
              language="sql"
              code={`-- Only for promoting a LATER account, never the first one:
UPDATE users
SET role = 'admin'
WHERE email = 'a-colleague@yourdomain.com';`}
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

        <h3 className="text-sm font-semibold mb-3 mt-2">
          Option A: Stripe dashboard
        </h3>
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
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          {APP_NAME} ships a built-in backup script:{" "}
          <InlineCode>pg_dump</InlineCode> to gzip to AES-256-GCM encryption to
          a local file, with optional pruning and offsite upload. Run it from
          the shell, from cron, or with the Backup button in{" "}
          <InlineCode>/admin</InlineCode> (which streams the same log to the
          panel).
        </p>
        <CodeBlock
          language="bash"
          code={`# Create a backup (writes to BACKUP_DIR, default ./backups)
npm run db:backup

# Restore. Prints what it would do without --yes; --yes actually applies it.
npm run db:restore -- --file=./backups/vulnradar-backup-<timestamp>.sql.gz.enc --yes`}
        />

        <DocsCallout
          variant="warning"
          title="pg_dump must be installed (postgresql-client)"
        >
          <p>
            The backup and restore scripts shell out to{" "}
            <InlineCode>pg_dump</InlineCode> and <InlineCode>psql</InlineCode>,
            which come from the <InlineCode>postgresql-client</InlineCode>{" "}
            system package. Minimal Node images, including the{" "}
            <strong className="text-foreground">Pterodactyl Node egg</strong>,
            do not ship it, so backups fail with{" "}
            <InlineCode>pg_dump not found</InlineCode> and no{" "}
            <InlineCode>backups/</InlineCode> directory is created. Install it
            first, e.g.{" "}
            <InlineCode>apt-get install -y postgresql-client</InlineCode>{" "}
            (Debian/Ubuntu) or{" "}
            <InlineCode>apk add postgresql-client</InlineCode> (Alpine). The
            official Docker image already includes it.
          </p>
        </DocsCallout>

        <h3 className="text-sm font-semibold mb-3 mt-2">
          Backup environment variables
        </h3>
        <p className="text-sm text-muted-foreground">
          All optional; set them in <InlineCode>.env</InlineCode>. Full
          reference on the{" "}
          <Link
            href="/docs/config#layer-2"
            className="text-primary underline-offset-2 hover:underline"
          >
            Configuration
          </Link>{" "}
          page.
        </p>
        <DocsTable
          columns={[
            { key: "name", header: "Variable" },
            { key: "default", header: "Default" },
            { key: "purpose", header: "Purpose" },
          ]}
          data={[
            {
              name: "BACKUP_DIR",
              default: "./backups",
              purpose:
                "Directory backups are written to (relative to the app root).",
            },
            {
              name: "BACKUP_RETENTION_DAYS",
              default: "14",
              purpose:
                "Prune local backups older than this after a successful run. 0 keeps everything.",
            },
            {
              name: "BACKUP_ENCRYPTION_KEY",
              default: "API_KEY_ENCRYPTION_KEY",
              purpose:
                "64-hex-char AES-256 key. Unset falls back to the app base key, so backups are encrypted by default.",
            },
            {
              name: "BACKUP_OFFSITE_UPLOAD_URL",
              default: "(none)",
              purpose:
                "Presigned PUT URL (S3/R2/B2 or any receiver). Backup is uploaded there after the local write.",
            },
          ]}
        />

        <DocsCallout variant="warning" title="Use a persistent volume">
          <p>
            <InlineCode>BACKUP_DIR</InlineCode> defaults to{" "}
            <InlineCode>./backups</InlineCode> at the app root. On a container
            that is ephemeral: mount a persistent/host volume there (or set{" "}
            <InlineCode>BACKUP_DIR</InlineCode> to a mounted path), otherwise
            every backup is wiped on the next rebuild or redeploy. Set{" "}
            <InlineCode>BACKUP_OFFSITE_UPLOAD_URL</InlineCode> as well so a copy
            leaves the host entirely.
          </p>
        </DocsCallout>

        <DocsCallout variant="info" title="Encryption and restore">
          <p>
            Each dump is encrypted with AES-256-GCM. When{" "}
            <InlineCode>BACKUP_ENCRYPTION_KEY</InlineCode> is unset the script
            falls back to <InlineCode>API_KEY_ENCRYPTION_KEY</InlineCode>, so a
            plaintext backup is never written by accident. A separate{" "}
            <InlineCode>BACKUP_ENCRYPTION_KEY</InlineCode> is still recommended
            for defense in depth. An encrypted <InlineCode>.enc</InlineCode>{" "}
            file is restored using the same key resolution, and needs its{" "}
            <InlineCode>.json</InlineCode> sidecar (the IV and auth tag) present
            next to it. Rehearse a restore against a throwaway database before
            you rely on it.
          </p>
        </DocsCallout>

        <p className="text-sm text-muted-foreground">
          Prefer to manage backups outside the app? A managed Postgres (Neon,
          Supabase, RDS) with built-in automated backups, or a plain cron job,
          both work:
        </p>
        <CodeBlock
          language="bash"
          code={`# Manual dump/restore straight through docker compose
docker compose exec postgres pg_dump -U vulnradar vulnradar > backup-$(date +%F).sql
cat backup-2026-06-18.sql | docker compose exec -T postgres psql -U vulnradar vulnradar`}
        />
      </DocsSection>

      <DocsSection id="updates" title="Updates">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          There is no deploy pipeline that does this for you, and no automatic
          rollback. Upgrading is five steps, in this order, and the first one is
          not optional.
        </p>
        <CodeBlock
          language="bash"
          code={`cd vulnradar.dev

# 1. Back up, and write down where you are. This is your way back.
docker compose exec app npm run db:backup
git rev-parse --short HEAD          # or: git describe --tags

# 2. Fetch the new code
git pull

# 3. Build the new image. This does NOT swap the running container yet.
docker compose build app

# 4. Run the NEW image's migrator against the database, with the old
#    container still serving traffic. 'run --rm' starts a throwaway
#    container from the image you just built and never touches the
#    'app' service, so the schema advances while the old code is live.
docker compose run --rm app npm run db:migrate:dry-run   # read the plan
docker compose run --rm app npm run db:migrate

# 5. Now swap in the new version
docker compose up -d
docker compose logs -f app`}
        />
        <DocsCallout variant="warning" title="Why step 4 uses the new image">
          <p>
            Two things make the ordering matter.{" "}
            <InlineCode>instrumentation.ts</InlineCode> applies its schema block
            at process boot, which is after the new container is already the
            running one, so leaving it to boot means there is no moment where
            the schema is advanced while the old code is still live. And the
            migrator that knows about the new schema version ships inside the
            new image, so running{" "}
            <InlineCode>docker compose exec app</InlineCode> would run the old
            version&rsquo;s migrator and find nothing to do.{" "}
            <InlineCode>docker compose run --rm app</InlineCode> gets you the
            new migrator without giving the new code any traffic. Skip step 4
            and the new container boots, sees a database older than{" "}
            <InlineCode>MIN_SCHEMA_VERSION</InlineCode>, prints a SCHEMA VERSION
            MISMATCH box and exits 1, which is a crash loop, not a rollback.
          </p>
        </DocsCallout>

        <DocsSubSection title="Rolling back">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            Reverting the image alone is only safe when the new version made no
            schema change. If it did, the old code will not tolerate the new
            schema, so the database has to go back too.
          </p>
          <CodeBlock
            language="bash"
            code={`# Schema unchanged: pin the previous tag and restart
git checkout <previous-tag>
docker compose build app && docker compose up -d

# Schema changed: put the database back first, then the code.
# Stop only the app so Postgres stays up for the restore.
docker compose stop app
docker compose run --rm app npm run db:restore   # the dump from step 1
git checkout <previous-tag>
docker compose build app && docker compose up -d`}
          />
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            The migrator does ship reversible transitions (every version file
            exports both an <InlineCode>upgrade</InlineCode> and a{" "}
            <InlineCode>downgrade</InlineCode> plan, and{" "}
            <InlineCode>npm run db:migrate</InlineCode> lets you pick an older
            target), but a downgrade drops tables and columns and makes you type{" "}
            <InlineCode>yes-delete-data</InlineCode> to confirm. Restoring the
            backup you took in step 1 is the safer route and is the one to reach
            for unless you know exactly what the downgrade removes.
          </p>
          <DocsCallout
            variant="warning"
            title="Rehearse this before you need it"
          >
            <p>
              A restore path you have never run is not a rollback plan. Point a
              throwaway database at a copy of your dump and bring the app up
              against it once, so the first time you run these commands is not
              during an outage.
            </p>
          </DocsCallout>
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="renaming" title="Renaming a fork">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          GPL-3.0 makes a rebranded fork an expected use, so this is a real
          question rather than a discouraged one. Here is the honest scope of
          the work.
        </p>

        <DocsSubSection title="What one setting covers">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            <InlineCode>CONFIG_APP_NAME</InlineCode> in{" "}
            <InlineCode>lib/config/config-values.ts</InlineCode> is exported as{" "}
            <InlineCode>APP_NAME</InlineCode>, and that one value already drives
            the application chrome, page titles and social cards, every email
            the app sends, all four report exporters (PDF, Markdown, SARIF and
            the compliance crosswalk), the scanner&rsquo;s own User-Agent on
            every outbound request, the comparison pages, and this
            documentation. Change it and rebuild, and those all follow.{" "}
            <InlineCode>CONFIG_APP_SLUG</InlineCode>,{" "}
            <InlineCode>CONFIG_APP_URL</InlineCode>,{" "}
            <InlineCode>CONFIG_LOGO_URL</InlineCode> and the support email
            constants sit alongside it and want the same treatment.
          </p>
        </DocsSubSection>

        <DocsSubSection title="What it does not cover">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            Roughly two hundred further occurrences of the name are literal
            strings, of which maybe sixty are visible to a user of a renamed
            instance. The clusters worth doing, in order: the browser extension
            (which has its own constants file and its own store listing), the
            OAuth error strings in the sign-in callbacks, and the SDK sample
            code in the API reference. Everything else is either a comment or
            somewhere nobody looks.
          </p>
        </DocsSubSection>

        <DocsCallout variant="warning" title="Two things must not be renamed">
          <p>
            The webhook signature header is part of the wire protocol: every
            receiver your users have already written parses it by name, so
            renaming it breaks them silently. And the changelog is a historical
            record of releases that shipped under this name; templating it would
            rewrite history rather than rebrand it. Leave both alone.
          </p>
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
                "Renamed or removed a CONFIG_* constant that registry.ts or constants.ts still imports by name",
              fix: "Run npm run typecheck; the error points at the exact import site.",
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
              fix: "Set SMTP_HOST/PORT/USER/PASS/FROM in .env and restart. If you are already locked out, clear 2FA from the database (see Locked out of your own instance below): /api/v3/auth/2fa/disable needs a completed login and cannot help here.",
            },
          ]}
        />

        <DocsSubSection title="Locked out of your own instance">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            The app has no self-service escape from a second factor you cannot
            receive. <InlineCode>POST /api/v3/auth/2fa/disable</InlineCode>{" "}
            calls <InlineCode>getSession()</InlineCode> and 401s without one,
            and an account stopped at the 2FA prompt has no session yet: the
            interim state is a separate signed token, not a session cookie. The
            only recovery is from outside the app, against the database.
          </p>
          <CodeBlock
            language="bash"
            code={`# Clear the second factor for one account. Run against your database,
# e.g. docker compose exec db psql -U vulnradar -d vulnradar
UPDATE users
   SET totp_enabled = false,
       two_factor_method = NULL,
       totp_secret = NULL,
       backup_codes = NULL
 WHERE email = 'you@example.com';`}
          />
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            The user can sign in with their password afterwards and re-enrol.
            Nothing else about the account changes.
          </p>
          <DocsCallout variant="warning" title="db:repair-2fa is not this">
            <p>
              <InlineCode>npm run db:repair-2fa</InlineCode> only touches rows
              that <InlineCode>npm run db:diagnose-2fa</InlineCode> proves are
              corrupt, such as <InlineCode>totp_enabled = true</InlineCode> with
              no secret. A healthy row whose email simply cannot be delivered is
              not corrupt, so the repair script will report nothing to do. Use
              the SQL above.
            </p>
          </DocsCallout>
        </DocsSubSection>

        <DocsSubSection title="Database diagnostics and repair">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            Every one of these reports before it writes. Run the{" "}
            <InlineCode>diagnose</InlineCode> command first and read the output;
            the <InlineCode>repair</InlineCode> commands only act on what the
            matching diagnostic flagged.
          </p>
          <DocsTable
            columns={[
              { key: "command", header: "Command" },
              { key: "what", header: "What it does" },
            ]}
            data={[
              {
                command: "npm run db:diagnose",
                what: "Introspects the live schema and reports data corruption: foreign-key orphans, encrypted columns that will not decrypt, out-of-range enum values, impossible timestamps.",
              },
              {
                command: "npm run db:repair",
                what: "Applies the fixes db:diagnose found. Dry run by default; a real write needs --apply --admin-id=<id> and is recorded in admin_audit_log.",
              },
              {
                command: "npm run db:diagnose-2fa",
                what: "Reports accounts whose 2FA columns are internally inconsistent.",
              },
              {
                command: "npm run db:repair-2fa",
                what: "Fixes only the rows db:diagnose-2fa proved corrupt. It cannot unlock a healthy account.",
              },
              {
                command: "npm run db:repair-sequences",
                what: "Resets the Postgres identity sequences, which is what causes duplicate-key errors on insert after a restore.",
              },
              {
                command: "npm run db:backup",
                what: "Writes a full dump. Run this before any upgrade or repair.",
              },
              {
                command: "npm run db:restore",
                what: "Restores a dump written by db:backup.",
              },
            ]}
          />
        </DocsSubSection>
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
