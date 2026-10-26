import Link from "next/link";
import {
  APP_NAME,
  APP_REPO,
  APP_VERSION,
  MIN_SCHEMA_VERSION,
} from "@/lib/config/constants";
import {
  CONFIG_DB_HEALTHCHECK_TIMEOUT_MS,
  CONFIG_SUBDOMAIN_CACHE_TTL_HOURS,
} from "@/lib/config/config-values";
import { REQUIRED_EVENTS } from "@/lib/billing/stripe-webhook-events";
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
  { id: "health", label: "Health check", level: 2 },
  { id: "admin", label: "First Admin User" },
  { id: "tls", label: "TLS (Reverse Proxy)" },
  { id: "stripe", label: "Configure Stripe Webhook" },
  { id: "backups", label: "Backups" },
  { id: "key-rotation", label: "Rotating the encryption key", level: 2 },
  { id: "updates", label: "Updates" },
  { id: "in-app-updater", label: "The in-app updater", level: 2 },
  { id: "network-egress", label: "Network egress" },
  { id: "renaming", label: "Renaming a fork" },
  { id: "troubleshooting", label: "Troubleshooting" },
  { id: "security", label: "Security Checklist" },
];

type EgressRow = {
  host: string;
  sent: string;
  blocked: string;
};

type KeyedEgressRow = EgressRow & { needs: string };

/**
 * The server's own outbound calls to fixed hosts, read off the code that makes
 * them (lib/scanner, lib/auth, lib/billing, lib/updater and the signup route).
 * The README links to #network-egress, so a host added to the code and not here
 * is a firewall rule an operator learns about from a failing feature.
 */
const EGRESS_EVERY_SCAN: EgressRow[] = [
  {
    host: "api.osv.dev",
    sent: "The package name and exact version of each client-side library the scanned page loads.",
    blocked:
      "The library check is recorded as not checked on that scan, never as clean.",
  },
  {
    host: "services.nvd.nist.gov",
    sent: "Vendor, product and version of server software the response headers disclosed, as a CPE match string, with a cap on lookups per scan. NVD_API_KEY goes in a header when you set one and raises the rate limit.",
    blocked:
      "That item's CVE status is unknown in the software inventory, not clean.",
  },
  {
    host: "www.cisa.gov",
    sent: "Nothing about the scan. It downloads the Known Exploited Vulnerabilities catalog, and only when a finding names a CVE. The catalog is cached in the database for the CVE_KEV_CACHE_TTL_HOURS setting.",
    blocked:
      "Findings come back without the in-the-wild flag. Nothing is marked as not exploited.",
  },
  {
    host: "api.first.org",
    sent: "The CVE ids the findings name, in one batched EPSS request. Scores are remembered in memory.",
    blocked: "Findings come back without an exploit probability score.",
  },
  {
    host: "dns.google and cloudflare-dns.com",
    sent: "The scanned domain name, asked over HTTPS for A, DNSKEY, DS, NSEC and NSEC3PARAM records. Both resolvers are asked every time.",
    blocked:
      "If neither answers, the DNSSEC checks report nothing rather than a failure.",
  },
  {
    host: "9.9.9.9 and 1.1.1.1",
    sent: "The scanned hostname, resolved through Quad9 and through a neutral resolver to see whether Quad9's threat feed blocks it. Plain DNS on port 53, not HTTPS.",
    blocked:
      "Quad9 shows as unavailable in the threat intelligence panel, never clean.",
  },
  {
    host: "urlhaus-api.abuse.ch",
    sent: "The scanned hostname, in a POST. URLHAUS_AUTH_KEY goes along when set. abuse.ch asks for a free Auth-Key, and without one the answer is an error.",
    blocked:
      "URLhaus shows as unavailable in the threat intelligence panel, never clean. That is also what an unkeyed request ends up as.",
  },
];

const EGRESS_SUBDOMAIN_SOURCES: { host: string; what: string }[] = [
  { host: "crt.sh", what: "Certificate transparency log search." },
  { host: "api.certspotter.com", what: "Certificate transparency issuances." },
  { host: "api.hackertarget.com", what: "Host search." },
  { host: "api.subdomain.center", what: "Subdomain database." },
  { host: "rapiddns.io", what: "Passive DNS." },
  { host: "otx.alienvault.com", what: "AlienVault OTX passive DNS." },
  {
    host: "jldc.me",
    what: "The Anubis subdomain database. It redirects to jonlu.ca, and the redirect is followed after the destination passes the same private-address check as every other hop, so allow both names.",
  },
  { host: "urlscan.io", what: "Public scan search." },
  { host: "web.archive.org", what: "Wayback Machine URL index." },
];

const EGRESS_KEY_GATED: KeyedEgressRow[] = [
  {
    host: "webrisk.googleapis.com",
    needs: "WEB_RISK_API_KEY",
    sent: "The full scanned URL, path and query included, with the key.",
    blocked:
      "Google Web Risk shows as unavailable in the threat intelligence panel, never clean. With no key it is left out of that panel entirely.",
  },
  {
    host: "api.browserbase.com",
    needs: "BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID",
    sent: "Session create and release calls with your project id, then the URL to open, sent over the debugging socket BrowserBase returns.",
    blocked: "The View Page button fails. Scans do not use it.",
  },
  {
    host: "The AI endpoint",
    needs: "AI_BASE_URL or AI_PROVIDER, AI_MODEL, AI_API_KEY",
    sent: "What each feature works on: chat messages with the knowledge and scan data loaded for them, the finding being verified, the scan being summarized. Also whatever provider a user sets in their own AI settings.",
    blocked:
      "Chat, finding verification and audit summaries fail or are skipped. Scans do not depend on them.",
  },
  {
    host: "api.stripe.com",
    needs: "STRIPE_SECRET_KEY, with billing enabled",
    sent: "Customer, checkout, billing portal and subscription calls, which carry the account's email, name and chosen plan.",
    blocked:
      "Checkout and the other billing actions that call Stripe fail until it is reachable.",
  },
  {
    host: "challenges.cloudflare.com",
    needs: "TURNSTILE_SECRET_KEY and NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    sent: "The visitor's Turnstile token, your secret and the visitor's IP address, at signup, on the contact forms and when a support ticket is created.",
    blocked:
      "Those forms cannot be submitted, because the check cannot pass without an answer from Cloudflare.",
  },
  {
    host: "discord.com",
    needs:
      "DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET; DISCORD_BOT_TOKEN and DISCORD_GUILD_ID for the server auto-join",
    sent: "The OAuth code exchange, the user lookup and, with the bot token, the request that adds the user to your server.",
    blocked:
      "Discord sign-in and Profile, Connections, Discord fail with an OAuth error. Password sign-in is unaffected.",
  },
  {
    host: "github.com and api.github.com",
    needs: "GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET",
    sent: "The OAuth code exchange, the user and email lookups, and the repository API calls for the code scan, made with the user's own token.",
    blocked:
      "GitHub sign-in, linking and the repository scanner fail. Password sign-in is unaffected.",
  },
  {
    host: "oauth2.googleapis.com and openidconnect.googleapis.com",
    needs: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET",
    sent: "The OAuth code exchange and the user lookup.",
    blocked: "Google sign-in fails. Password sign-in is unaffected.",
  },
];

export default function SelfHostingPage() {
  return (
    <div className="space-y-12 sm:space-y-16">
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
          your own DB. See{" "}
          <a
            href="#managed-postgres"
            className="text-primary underline-offset-2 hover:underline"
          >
            Using a managed PostgreSQL
          </a>{" "}
          for the compose setup.
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
POSTGRES_PASSWORD=<output of: openssl rand -hex 32>
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
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          There is no <InlineCode>DATABASE_URL</InlineCode> to fill in here.
          docker-compose builds it for the bundled Postgres from{" "}
          <InlineCode>POSTGRES_USER</InlineCode>,{" "}
          <InlineCode>POSTGRES_PASSWORD</InlineCode> and{" "}
          <InlineCode>POSTGRES_DB</InlineCode>, and sets it on the app service,
          where it wins over anything in <InlineCode>.env</InlineCode>. The
          password goes into that URL as-is, which is why the example uses hex:
          an <InlineCode>@</InlineCode>, <InlineCode>/</InlineCode> or{" "}
          <InlineCode>:</InlineCode> in it breaks the connection string.
          Postgres only reads <InlineCode>POSTGRES_PASSWORD</InlineCode> the
          first time it initialises its volume, so changing it later does not
          change the database&rsquo;s password; set it before the first{" "}
          <InlineCode>docker compose up</InlineCode>.
        </p>
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Google, GitHub and Discord sign-in only work once the provider has
          this instance&rsquo;s callback URL registered, character for
          character. The addresses to register, and how the app decides what its
          own address is behind a proxy, are in{" "}
          <Link
            href="/docs/config#oauth-redirect-uris"
            className="text-primary underline-offset-2 hover:underline"
          >
            Configuration, OAuth redirect URIs
          </Link>
          .
        </p>
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

        <DocsSubSection
          id="managed-postgres"
          title="Using a managed PostgreSQL"
        >
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            Because compose sets <InlineCode>DATABASE_URL</InlineCode> itself,
            putting your provider&rsquo;s URL in <InlineCode>.env</InlineCode>{" "}
            does nothing on its own: the app keeps talking to the bundled
            database. The repository ships{" "}
            <InlineCode>docker-compose.managed-db.yml</InlineCode> for this. It
            hands the app your <InlineCode>DATABASE_URL</InlineCode>, turns SSL
            on by default, and moves the bundled Postgres behind a profile so it
            does not start. Add to <InlineCode>.env</InlineCode>:
          </p>
          <CodeBlock
            language="bash"
            code={`DATABASE_URL=postgresql://user:password@your-db-host:5432/vulnradar
DATABASE_SSL=true
# DATABASE_SSL_CA="-----BEGIN CERTIFICATE-----\\n...\\n-----END CERTIFICATE-----"

# Compose reads this from .env, so every command below uses both files.
COMPOSE_FILE=docker-compose.yml:docker-compose.managed-db.yml`}
          />
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            Keep the <InlineCode>POSTGRES_*</InlineCode> lines from{" "}
            <InlineCode>.env.example</InlineCode>, since the base file still
            names them. This needs Docker Compose 2.24 or newer. Check what
            compose will actually run with{" "}
            <InlineCode>docker compose config --services</InlineCode>, which
            should list <InlineCode>app</InlineCode> and not{" "}
            <InlineCode>postgres</InlineCode>.
          </p>
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="start" title="Start the Stack">
        <CodeBlock
          language="bash"
          code={`docker compose up -d --build
docker compose logs -f app   # watch startup`}
        />
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          <InlineCode>--build</InlineCode> matters on a source checkout. The
          compose file names both the published image and a build context, and
          when both are present a plain{" "}
          <InlineCode>docker compose up</InlineCode> pulls the published image
          rather than building yours. That image was built from upstream&rsquo;s{" "}
          <InlineCode>config-values.ts</InlineCode> and with{" "}
          <InlineCode>NEXT_PUBLIC_APP_URL</InlineCode> baked in as{" "}
          upstream&rsquo;s own domain, so the edits from the previous steps
          would silently not be there.
        </p>
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          On boot, <InlineCode>instrumentation.ts</InlineCode> checks the schema
          version, then calls <InlineCode>apply-boot-schema</InlineCode> (
          <InlineCode>lib/database/boot/apply-boot-schema.ts</InlineCode>),
          which runs the idempotent{" "}
          <InlineCode>CREATE ... IF NOT EXISTS</InlineCode> statements in{" "}
          <InlineCode>lib/database/schema/</InlineCode> for every table. On an
          empty database the version check stamps the{" "}
          <InlineCode>vulnradar_schema_meta</InlineCode> row first, at schema v
          {MIN_SCHEMA_VERSION}. A database that has tables but no recorded
          version is not touched: the app prints a SCHEMA VERSION NOT SET box
          and exits, and <InlineCode>npm run db:migrate</InlineCode> is what
          records one. Look for{" "}
          <InlineCode>Database schema verified successfully</InlineCode> in the
          logs.
        </p>

        <DocsSubSection id="health" title="Health check">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            <InlineCode>GET /api/v3/health</InlineCode> answers one question:
            can this process serve traffic right now. It needs no credentials.
            The image&rsquo;s HEALTHCHECK and the compose healthcheck both call
            it, and it is the address to give a load balancer. Anything but a
            200 means take the instance out of rotation.
          </p>
          <CodeBlock
            language="bash"
            code={`curl -i http://127.0.0.1:3000/api/v3/health`}
          />
          <CodeBlock
            language="json"
            code={`{
  "status": "ok",
  "version": "${APP_VERSION}",
  "uptime_s": 86412,
  "database": {
    "connected": true,
    "latency_ms": 4,
    "schema_version": "${MIN_SCHEMA_VERSION}",
    "schema_required": "${MIN_SCHEMA_VERSION}",
    "schema_ok": true,
    "missing_tables": [],
    "pool": { "total": 2, "idle": 2, "waiting": 0, "max": 10 }
  }
}`}
          />
          <DocsTable
            caption="What each health status means"
            columns={[
              { key: "status", header: "status" },
              { key: "http", header: "HTTP" },
              { key: "meaning", header: "Meaning" },
            ]}
            data={[
              {
                status: "ok",
                http: "200",
                meaning: `The database answered, its schema is at least v${MIN_SCHEMA_VERSION} and every required table exists.`,
              },
              {
                status: "degraded",
                http: "503",
                meaning:
                  "The database answered, but its schema is older than this build needs or a required table is missing (named in database.missing_tables). Run npm run db:migrate.",
              },
              {
                status: "unhealthy",
                http: "503",
                meaning: `The database probe timed out after ${CONFIG_DB_HEALTHCHECK_TIMEOUT_MS / 1000} seconds or failed outright. database.connected is false. The driver's error text is logged, not returned.`,
              },
            ]}
          />
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            A probe must never read a healthy deployment as down, so two things
            that gate everything else skip this endpoint. Maintenance mode does
            not cover it, whether you switched it on in the admin panel or with
            the <InlineCode>MAINTENANCE_MODE</InlineCode> environment variable,
            so an orchestrator does not restart the container in a loop for as
            long as maintenance lasts. And the redirect of plain-HTTP requests
            to HTTPS does not apply, because a probe connects directly over HTTP
            and a redirect to a TLS port nothing listens on would fail every
            check. The answer is never cached; the response carries{" "}
            <InlineCode>Cache-Control: no-store</InlineCode>.
          </p>
          <DocsCallout variant="info" title="/api/version is not a probe">
            <p>
              It asks GitHub for the newest release and caches the answer for an
              hour, and it never touches the database. It answers 200 with the
              database up, down or half migrated, so it cannot tell you whether
              the app works. Use <InlineCode>/api/v3/health</InlineCode> for
              anything that restarts or reroutes.
            </p>
          </DocsCallout>
        </DocsSubSection>
      </DocsSection>

      <DocsSection id="admin" title="First Admin User">
        <ol className="list-decimal pl-6 space-y-2 text-sm text-muted-foreground">
          <li>
            Visit <InlineCode>https://scanner.yourdomain.com/signup</InlineCode>{" "}
            and create an account. The schema creates itself the first time the
            app boots, with or without Docker, so there is nothing to run first.
            (This used to point at <InlineCode>npm run db:create</InlineCode>,
            which is the side-by-side clone tool rather than a first-time setup
            step: it prompts for an existing database to copy from and builds a
            second, differently-named one that nothing is configured to read.)
          </li>
          <li>
            Nothing to run. The first account created on a fresh instance is
            given the <InlineCode>super_admin</InlineCode> role automatically,
            so signing up is all that is needed. Do not run an{" "}
            <InlineCode>UPDATE users SET role = &apos;admin&apos;</InlineCode>{" "}
            against it: <InlineCode>admin</InlineCode> is a lower level than{" "}
            <InlineCode>super_admin</InlineCode>, so that demotes the account,
            and no screen in the product can put it back. A restart can, see the
            note below the list.
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
        <DocsCallout
          variant="warning"
          title="A restart re-promotes the lowest-id account"
        >
          <p>
            On every boot, if no account at all holds{" "}
            <InlineCode>super_admin</InlineCode>, the app promotes the account
            with the lowest id that still exists. That is the first one ever
            registered, until it is deleted. It is the way back for a first
            account you demoted by mistake, and it is also why you cannot retire
            the last super admin by editing the role: the next restart hands the
            role to whoever has the lowest id then. While any account holds{" "}
            <InlineCode>super_admin</InlineCode> the check does nothing.
          </p>
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
        <DocsSubSection title="Client IPs behind more than one proxy">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            Rate limits, session and API key IP binding, and the audit log all
            read the visitor&rsquo;s address from{" "}
            <InlineCode>X-Forwarded-For</InlineCode>. Left unset, the app takes
            the right-most entry, which is correct with exactly one proxy in
            front of it: the Caddy above appends the visitor&rsquo;s address,
            and a visitor cannot forge the entry their proxy adds last. Put a
            second hop in front, such as a CDN ahead of Caddy, and the
            right-most entry becomes the CDN&rsquo;s edge address instead, so
            every visitor arriving through the same edge shares one rate-limit
            bucket. Set <InlineCode>TRUSTED_PROXY_CIDR</InlineCode> to the
            ranges of every proxy between the internet and the app, and the app
            walks the header from the right, skipping those, and uses the first
            address that is not one of yours.
          </p>
          <CodeBlock
            language="bash"
            code={`# .env: your proxies' ranges, comma-separated
TRUSTED_PROXY_CIDR=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16`}
          />
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            List only ranges you control or your CDN publishes. A range that
            covers the public internet lets a visitor put any address they like
            in the header and have it believed.
          </p>
        </DocsSubSection>
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
                Events, rendered from <InlineCode>REQUIRED_EVENTS</InlineCode>{" "}
                in <InlineCode>lib/billing/stripe-webhook-events.ts</InlineCode>{" "}
                rather than restated, because an event the handler acts on but
                that you did not subscribe to simply never arrives:{" "}
                {REQUIRED_EVENTS.map((event, i) => (
                  <span key={event}>
                    <InlineCode>{event}</InlineCode>
                    {i < REQUIRED_EVENTS.length - 1 ? ", " : ""}
                  </span>
                ))}
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
          no secret. Every call needs an admin session, including after the
          webhook is configured, because even that answer tells a caller the
          instance uses Stripe.
        </p>
        <DocsCallout variant="warning">
          Using <InlineCode>curl</InlineCode> against this endpoint without an
          admin session cookie will get 403. Log in as admin in a browser, copy
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
        <DocsCallout
          variant="info"
          title="When the event list gets backfilled onto a live endpoint"
        >
          <p>
            That route is the only code that compares the endpoint&rsquo;s
            events with the list above and adds what is missing, and it only
            gets that far while <InlineCode>STRIPE_WEBHOOK_SECRET</InlineCode>{" "}
            is still unset. Once the secret is in <InlineCode>.env</InlineCode>{" "}
            it answers <InlineCode>configured: true</InlineCode> without calling
            Stripe, and nothing runs it at boot, so a restart never re-checks
            anything. When a release adds an event to the list, add it to the
            existing endpoint in the Stripe dashboard yourself.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="backups" title="Backups">
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          {APP_NAME} ships a built-in backup script: SQL dump to gzip to
          AES-256-GCM encryption to a local file, with optional pruning and
          offsite upload. Run it from the shell, from cron, or with the Backup
          button in <InlineCode>/admin</InlineCode> (which streams the same log
          to the panel).
        </p>
        <CodeBlock
          language="bash"
          code={`# Create a backup (writes to BACKUP_DIR, default ./backups)
npm run db:backup

# Restore. Prints what it would do without --yes; --yes actually applies it.
npm run db:restore -- --file=./backups/vulnradar-backup-<timestamp>.sql.gz.enc --yes`}
        />

        <DocsCallout
          variant="info"
          title="postgresql-client is preferred, not required"
        >
          <p>
            The scripts use <InlineCode>pg_dump</InlineCode> and{" "}
            <InlineCode>psql</InlineCode> (from the{" "}
            <InlineCode>postgresql-client</InlineCode> system package) when they
            are on PATH, and fall back on their own to a built-in JavaScript
            dumper and an in-process restore when they are not. Minimal Node
            images, including the{" "}
            <strong className="text-foreground">
              Pterodactyl and Pelican Node eggs
            </strong>
            , do not ship postgresql-client and give the operator no way to add
            it, which is exactly why the fallback exists: backups work there
            with nothing installed. The file it writes is plain SQL in
            pg_dump&apos;s own shape, so it restores with{" "}
            <InlineCode>npm run db:restore</InlineCode>, psql, pgAdmin, or a
            managed provider&apos;s importer. It covers the public schema only.
            Encryption, gzip, retention and offsite upload are identical on both
            paths. Force the JavaScript path with{" "}
            <InlineCode>npm run db:backup -- --js</InlineCode>, or{" "}
            <InlineCode>BACKUP_FORCE_JS=1</InlineCode> when the admin panel is
            what runs it. Installing postgresql-client is still worth it where
            you can: pg_dump is the more complete tool. The official Docker
            image already includes it.
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
              name: "MIGRATION_BACKUP_RETENTION_DAYS",
              default: "90",
              purpose:
                "The same rule for the pre-migration dumps below, pruned on their own clock. 0 keeps everything.",
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

        <DocsCallout variant="info" title="Migrations take their own backup">
          <p>
            <InlineCode>npm run db:migrate</InlineCode> writes a dump before it
            runs any DDL, whenever the plan has steps to run, so you do not have
            to remember step 1 of the upgrade for the migration itself. It uses
            the same format and the same key as a normal backup (the built-in
            dumper when <InlineCode>pg_dump</InlineCode> is missing), lands in{" "}
            <InlineCode>&lt;BACKUP_DIR&gt;/pre-migration</InlineCode>, and is
            pruned after{" "}
            <InlineCode>MIGRATION_BACKUP_RETENTION_DAYS</InlineCode> rather than{" "}
            <InlineCode>BACKUP_RETENTION_DAYS</InlineCode>. Because that folder
            sits inside <InlineCode>BACKUP_DIR</InlineCode>, the volume you
            mounted for backups already covers it. The in-app updater runs the
            same migrator, so it takes the same dump.
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

        <DocsSubSection id="key-rotation" title="Rotating the encryption key">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            <InlineCode>API_KEY_ENCRYPTION_KEY</InlineCode> encrypts stored API
            keys, two-factor seeds, Discord and GitHub tokens, the AI provider
            keys users save, webhook signing secrets, and, while{" "}
            <InlineCode>BACKUP_ENCRYPTION_KEY</InlineCode> is unset, your
            backups. Swap it for a new value with nothing else in place and
            every one of those becomes unreadable at once. The runbook below
            keeps the old key readable while the new one takes over.
          </p>
          <ol className="list-decimal pl-6 space-y-2 text-sm text-muted-foreground">
            <li>
              Take a backup now. Unless you already set{" "}
              <InlineCode>BACKUP_ENCRYPTION_KEY</InlineCode>, it is encrypted
              with the key you are about to retire, which is the one you will
              need if the rotation has to be undone.
            </li>
            <li>
              Generate the new key with the same command as the first one (64
              hex characters). Any other shape is ignored with an error in the
              log.
            </li>
            <li>
              In <InlineCode>.env</InlineCode>, set{" "}
              <InlineCode>PREVIOUS_API_KEY_ENCRYPTION_KEY</InlineCode> to the
              old value and <InlineCode>API_KEY_ENCRYPTION_KEY</InlineCode> to
              the new one. Restart. Reads try the new key and fall back to the
              old one; every write uses the new one.
            </li>
            <li>
              Check the logs and Admin, Error Logs for a line saying{" "}
              <InlineCode>PREVIOUS_API_KEY_ENCRYPTION_KEY</InlineCode> is not a
              64-character hex string (it was ignored, so nothing is protecting
              the old values), or an API key that could not be decrypted under
              the current or previous key.
            </li>
            <li>
              Take a fresh backup. From here on it is written under the new key.
            </li>
            <li>
              Set a dedicated <InlineCode>BACKUP_ENCRYPTION_KEY</InlineCode> if
              you have not. Backups then stop depending on the key you rotate,
              and a rotation no longer decides whether last month&rsquo;s
              backups can be restored.
            </li>
          </ol>
          <DocsCallout
            variant="warning"
            title="Keep the old key longer than you expect"
          >
            <p>
              There is no command that re-encrypts everything. API keys move to
              the new key the first time each one is used after the rotation, so
              remove <InlineCode>PREVIOUS_API_KEY_ENCRYPTION_KEY</InlineCode>{" "}
              only after every API key in use has been presented at least once.
              The rest move only when something rewrites them: a user
              re-enrolling two-factor, reconnecting Discord or GitHub, saving
              their AI key again, or rotating a webhook secret. Until then those
              rows are readable only through the old key, and dropping it makes
              each one undecryptable: an unused API key answers 401, a
              two-factor seed locks its owner out (see Locked out of your own
              instance under Troubleshooting), and a webhook is delivered
              unsigned. A backup taken before the rotation needs the old key to
              restore: set it as <InlineCode>BACKUP_ENCRYPTION_KEY</InlineCode>{" "}
              for that restore. Keep the old key until every backup that needs
              it has been retired.
            </p>
          </DocsCallout>
          <DocsCallout
            variant="warning"
            title="Do not run db:repair mid-rotation"
          >
            <p>
              <InlineCode>npm run db:diagnose</InlineCode> reads only{" "}
              <InlineCode>API_KEY_ENCRYPTION_KEY</InlineCode>, so while{" "}
              <InlineCode>PREVIOUS_API_KEY_ENCRYPTION_KEY</InlineCode> is
              covering for rows that still sit under the old key, it reports
              those rows as undecryptable. Its repairs for them clear the value
              or revoke the key, which is exactly the loss the rotation was set
              up to avoid. Read the report if you like; do not apply it.
            </p>
          </DocsCallout>
        </DocsSubSection>
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
            <InlineCode>instrumentation.ts</InlineCode> applies the schema
            through <InlineCode>apply-boot-schema</InlineCode> at process boot,
            which is after the new container is already the running one, so
            leaving it to boot means there is no moment where the schema is
            advanced while the old code is still live. And the migrator that
            knows about the new schema version ships inside the new image, so
            running <InlineCode>docker compose exec app</InlineCode> would run
            the old version&rsquo;s migrator and find nothing to do.{" "}
            <InlineCode>docker compose run --rm app</InlineCode> gets you the
            new migrator without giving the new code any traffic. Skip step 4
            and the new container boots, sees a database older than{" "}
            <InlineCode>MIN_SCHEMA_VERSION</InlineCode>, prints a SCHEMA VERSION
            MISMATCH box and exits 1, which is a crash loop, not a rollback.
          </p>
        </DocsCallout>

        <DocsSubSection id="in-app-updater" title="The in-app updater">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            Installs that run from a source checkout can update from Admin,
            Updater instead of the steps above: bare Node under systemd or PM2,
            and the panel eggs that run {APP_NAME} from its own directory
            (Pterodactyl, Pelican, unRAID). Only the super admin can apply an
            update, and it asks for their password again. It downloads the
            release tarball and its checksum file from the GitHub release,
            refuses to continue on a checksum mismatch, verifies the cosign
            signature when the <InlineCode>cosign</InlineCode> binary is on the
            host (a missing binary is skipped, a signature that fails aborts the
            update), copies the files over the app directory, runs{" "}
            <InlineCode>npm ci</InlineCode>, then{" "}
            <InlineCode>npm run db:migrate</InlineCode>, which takes the
            pre-migration backup first.
          </p>
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            It stops there. It does not build and it does not restart: when the
            log says it is done, run <InlineCode>npm run build</InlineCode> and
            restart the process yourself. It also refuses to install a release
            older than the one running.
          </p>
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            The official Docker image sets{" "}
            <InlineCode>VULNRADAR_UPDATER_DISABLED=true</InlineCode>, so there
            the panel shows a reason instead of a button: anything the updater
            wrote into a container would be discarded the next time the
            container is recreated, so an image updates by being replaced, with
            the steps above. Vercel gets the same refusal, and so does any
            install whose app directory the process cannot create files in,
            since an update that fails part way through leaves the files
            describing a version that is not installed.
          </p>
        </DocsSubSection>

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
# db:restore does nothing without --file and --yes, and refuses a
# database that still has tables unless you add --force.
docker compose stop app
docker compose run --rm app npm run db:restore -- \\
  --file=./backups/<the dump from step 1> --yes --force
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

      <DocsSection id="network-egress" title="Network egress">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          What your server calls, read off the code that calls it: the fixed
          hosts below, plus the addresses you configure yourself. It is the
          server&rsquo;s traffic only. What a visitor&rsquo;s browser loads is a
          separate list, set by the Content-Security-Policy in{" "}
          <InlineCode>middleware.ts</InlineCode> and never relayed through your
          server. Everything is HTTPS on port 443 unless the row says otherwise.
        </p>
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          None of these lookups has an off switch. A key-gated one is off until
          you set its key; the rest you stop by blocking the host. Either way
          the scan does not claim a clean result for something it could not look
          up, and the last column says what shows instead.
        </p>

        <DocsSubSection title="On every scan, with no key">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            The host-based lookups are skipped when the target is a raw IP
            address or a private hostname. Each call carries its own timeout, so
            a blocked host costs the scan seconds, not a failure.
          </p>
          <DocsTable
            caption="Outbound calls made on a scan, with no key needed"
            columns={[
              { key: "host", header: "Host" },
              { key: "sent", header: "What is sent", className: "w-1/2" },
              { key: "blocked", header: "If it is blocked" },
            ]}
            data={EGRESS_EVERY_SCAN}
          />
        </DocsSubSection>

        <DocsSubSection title="When the subdomain cache is cold">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            A scan of a domain whose cached subdomain list is older than{" "}
            {CONFIG_SUBDOMAIN_CACHE_TTL_HOURS} hours (the{" "}
            <InlineCode>SUBDOMAIN_CACHE_TTL_HOURS</InlineCode> setting), and
            every press of Discover on a cold cache, asks these nine free
            sources for the domain&rsquo;s subdomains. Each is sent only the
            registrable domain. The scan does not wait for them: the sweep runs
            in the background, and the next scan of that domain reads the cached
            result and calls none of them. A blocked source contributes no
            hosts. The others and the DNS brute force still run, so you get a
            shorter list, not an error.
          </p>
          <DocsTable
            caption="Passive subdomain sources"
            columns={[
              { key: "host", header: "Host" },
              { key: "what", header: "What it is", className: "w-full" },
            ]}
            data={EGRESS_SUBDOMAIN_SOURCES}
          />
        </DocsSubSection>

        <DocsSubSection title="At password signup">
          <DocsTable
            caption="Outbound calls made when someone signs up"
            columns={[
              { key: "host", header: "Host" },
              { key: "sent", header: "What is sent", className: "w-1/2" },
              { key: "blocked", header: "If it is blocked" },
            ]}
            data={[
              {
                host: "www.gravatar.com",
                sent: "A HEAD request carrying the MD5 hash of the new user's lowercased email, to see whether a Gravatar picture exists. It runs in the background and has no setting.",
                blocked:
                  "Ignored silently. The account simply gets no Gravatar picture.",
              },
            ]}
          />
        </DocsSubSection>

        <DocsSubSection title="Only when you set a key">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            Each of these stays idle until the variable in the second column is
            set, so a deployment that sets none of them makes none of these
            calls.
          </p>
          <DocsTable
            caption="Outbound calls that need a key or a client id"
            columns={[
              { key: "host", header: "Host" },
              { key: "needs", header: "Needs" },
              { key: "sent", header: "What is sent", className: "w-1/3" },
              { key: "blocked", header: "If it is blocked" },
            ]}
            data={EGRESS_KEY_GATED}
          />
        </DocsSubSection>

        <DocsSubSection title="Version check and updates">
          <DocsTable
            caption="Outbound calls that check for a newer release"
            columns={[
              { key: "host", header: "Host" },
              { key: "sent", header: "What is sent", className: "w-1/2" },
              { key: "blocked", header: "If it is blocked" },
            ]}
            data={[
              {
                host: "api.github.com",
                sent: `A GET for the latest release of ${APP_REPO}, the repository this build was configured with, so a fork that changes CONFIG_APP_REPO asks about its own. Nothing about your instance is in the request. It is made once at startup (5 second limit), when /api/version is hit (cached for an hour), and when an admin opens the Updater, which also downloads the release files from the URLs that response names.`,
                blocked:
                  "Startup carries on. /api/version answers with status unknown, and the Updater shows no latest version and cannot install one.",
              },
            ]}
          />
        </DocsSubSection>

        <DocsSubSection title="Addresses you choose">
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
            These are not fixed hosts, so no list can name them. Open the ones
            you use.
          </p>
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <InlineCode>DATABASE_URL</InlineCode> (Postgres, port 5432 unless
              you changed it) and <InlineCode>SMTP_HOST</InlineCode> with{" "}
              <InlineCode>SMTP_PORT</InlineCode> for your mail relay.
            </li>
            <li>
              <InlineCode>BACKUP_OFFSITE_UPLOAD_URL</InlineCode>, which receives
              each finished backup in a PUT.
            </li>
            <li>
              The admin alert webhook URL setting (Admin, Settings, Advanced),
              which receives a signed POST for critical system events.
            </li>
            <li>
              The Staff SSO issuer URL setting, and the token and key endpoints
              its discovery document names.
            </li>
            <li>
              Your users&rsquo; webhook URLs, which get a POST when a scan
              completes, and the sites they scan, which are fetched by design.
            </li>
          </ul>
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
# e.g. docker compose exec postgres psql -U vulnradar -d vulnradar
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
