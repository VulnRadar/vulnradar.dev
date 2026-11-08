import Link from "next/link";
import { Card } from "@/components/ui/card";
import { CheckCircle, AlertTriangle } from "lucide-react";
import {
  APP_NAME,
  APP_URL,
  APP_VERSION,
  ENGINE_VERSION,
  KNOWN_SCHEMA_VERSIONS,
  MIN_SCHEMA_VERSION,
  APP_REPO,
  APP_SLUG,
} from "@/lib/config/constants";
import type { TocItem } from "@/components/docs/docs-types";
import { DocsTocSpy } from "../docs-toc-spy";
import {
  DocsHero,
  DocsSection,
  DocsCallout,
  CodeBlock,
  InlineCode,
} from "@/components/docs";
import { LeadingIcon } from "@/components/shared/leading-icon";

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "prerequisites", label: "Prerequisites" },
  { id: "installation", label: "Installation" },
  { id: "database", label: "Database Setup" },
  { id: "environment", label: "Environment Config" },
  { id: "config", label: "App Configuration" },
  { id: "running", label: "Running the App" },
  { id: "verification", label: "Verification" },
  { id: "health", label: "Health check", level: 2 },
  { id: "troubleshooting", label: "Troubleshooting" },
  { id: "deployment", label: "Deployment" },
  { id: "docker", label: "Docker Deployment" },
  { id: "migration", label: "Schema Migration" },
  { id: "version", label: "Version Check" },
];

/** The schema version one step below the one this build requires, for the
 *  migration example. Read from the same list the boot gate uses, so it moves
 *  when a schema version is added. */
const PREVIOUS_SCHEMA_VERSION =
  KNOWN_SCHEMA_VERSIONS[KNOWN_SCHEMA_VERSIONS.indexOf(MIN_SCHEMA_VERSION) - 1];

export default function SetupPage() {
  return (
    <div className="space-y-12 sm:space-y-16">
      <DocsTocSpy items={tocItems} />
      <DocsHero
        badge="Self-Hosting"
        title="Setup Guide"
        description={`Install and configure ${APP_NAME} locally or in production. Three deployment paths: local Node, Docker, or a generic Node host.`}
      />

      {/* grid-cols-1 below sm: at 375px three tiles get ~109px each and the
        two-word labels ("systemd / PM2", "Self-Hosting guide") wrap, leaving the
        row uneven. This was the only multi-column grid in the content
        surface with no responsive prefix. */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-4">
        <a
          href="#installation"
          className="p-2.5 sm:p-4 rounded-lg bg-card border border-border/40 hover:border-accent transition-colors"
        >
          <div className="text-sm sm:text-lg font-semibold text-primary mb-0.5 sm:mb-1">
            Local Dev
          </div>
          <div className="text-[10px] sm:text-xs text-muted-foreground">
            Clone + npm
          </div>
        </a>
        <Link
          href="/docs/self-hosting"
          className="p-2.5 sm:p-4 rounded-lg bg-card border border-border/40 hover:border-accent transition-colors"
        >
          <div className="text-sm sm:text-lg font-semibold text-primary mb-0.5 sm:mb-1">
            Docker
          </div>
          <div className="text-[10px] sm:text-xs text-muted-foreground">
            Self-Hosting guide
          </div>
        </Link>
        <a
          href="#deployment"
          className="p-2.5 sm:p-4 rounded-lg bg-card border border-border/40 hover:border-accent transition-colors"
        >
          <div className="text-sm sm:text-lg font-semibold text-primary mb-0.5 sm:mb-1">
            Bare Node
          </div>
          <div className="text-[10px] sm:text-xs text-muted-foreground">
            systemd / PM2
          </div>
        </a>
      </div>

      <DocsSection id="prerequisites" title="Prerequisites">
        <p className="text-sm text-muted-foreground">
          Before you begin, ensure you have the following installed:
        </p>

        <Card className="p-6 border-border/40 space-y-3">
          {[
            {
              title: "Node.js 22 LTS",
              desc: "JavaScript runtime. package.json pins engines.node to >=22.0.0 <23.0.0 and .npmrc makes that range a hard install failure, the Dockerfile builds on node:22.23.4-alpine, and CI runs on Node 22 only. See the Node Version Policy on the Developers page.",
              link: "https://nodejs.org",
              cmd: "node --version",
            },
            {
              title: "npm 10+",
              desc: "Package manager. Use npm, not pnpm or yarn: this repo's node_modules layout and lockfile assume npm.",
              cmd: "npm --version",
            },
            {
              title: "PostgreSQL 14+",
              desc: "Database server. Single Postgres instance handles app, sessions, and rate-limit tables.",
              link: "https://www.postgresql.org/download",
              cmd: "psql --version",
            },
            {
              title: "Git 2.0+",
              desc: "Version control.",
              link: "https://git-scm.com",
              cmd: "git --version",
            },
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-3">
              <LeadingIcon
                icon={CheckCircle}
                size="lg"
                className="text-primary"
              />
              <div className="flex-1">
                <h3 className="text-sm font-semibold mb-1">{item.title}</h3>
                <p className="text-sm text-muted-foreground">
                  {item.desc}
                  {item.link && (
                    <>
                      {" "}
                      Download from{" "}
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {item.link.replace("https://", "")}
                      </a>
                    </>
                  )}
                </p>
                <CodeBlock
                  code={`${item.cmd}  # Check version`}
                  language="bash"
                  className="mt-2"
                />
              </div>
            </div>
          ))}
        </Card>
      </DocsSection>

      <DocsSection id="installation" title="Installation Steps">
        <Card className="p-6 border-border/40">
          <h3 className="text-base font-semibold mb-4">
            Step 1: Clone the Repository
          </h3>
          <CodeBlock
            code={`git clone https://github.com/${APP_REPO}.git\ncd ${APP_SLUG}.dev`}
            language="bash"
          />
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="text-base font-semibold mb-4">
            Step 2: Install Dependencies
          </h3>
          <CodeBlock code="npm ci" language="bash" />
          <p className="text-xs text-muted-foreground mt-2">
            <InlineCode>.npmrc</InlineCode> sets{" "}
            <InlineCode>engine-strict=true</InlineCode>, so an install under a
            Node outside <InlineCode>engines</InlineCode> (
            <InlineCode>&gt;=22.0.0 &lt;23.0.0</InlineCode>) fails instead of
            warning. It holds no install-script allow-list: npm has no such
            mechanism, and the Docker build installs with{" "}
            <InlineCode>--ignore-scripts</InlineCode> because nothing in the
            production tree needs one (sharp and the Next SWC binaries ship
            prebuilt as optional dependencies).
          </p>
        </Card>
      </DocsSection>

      <DocsSection id="database" title="Database Setup">
        <p className="text-sm text-muted-foreground">
          Configure PostgreSQL for {APP_NAME}.
        </p>

        <Card className="p-6 border-border/40">
          <h3 className="text-base font-semibold mb-4">
            Option A: Dedicated database (no Docker)
          </h3>
          <p className="text-sm text-muted-foreground mb-3">
            Open a psql shell as the Postgres superuser:
          </p>
          <CodeBlock code="psql -U postgres" language="bash" />
          <p className="text-sm text-muted-foreground mt-3 mb-3">
            Then create the user and database. Generate the password with{" "}
            <InlineCode>openssl rand -hex 32</InlineCode> and use the same value
            in <InlineCode>DATABASE_URL</InlineCode> below.
          </p>
          <CodeBlock
            code={`CREATE USER vulnradar WITH PASSWORD 'your-password';
CREATE DATABASE vulnradar OWNER vulnradar;
\\q`}
            language="sql"
          />
          <p className="text-sm text-muted-foreground mt-3">
            Make the user the database&apos;s owner rather than granting it
            privileges on the database. Since PostgreSQL 15 nobody but the owner
            may create tables in the <InlineCode>public</InlineCode> schema, and{" "}
            <InlineCode>GRANT ALL PRIVILEGES ON DATABASE</InlineCode> does not
            change that, so {APP_NAME} would stop at its first{" "}
            <InlineCode>CREATE TABLE</InlineCode> with &quot;permission denied
            for schema public&quot;.
          </p>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="text-base font-semibold mb-4">
            Option B: Docker Compose (recommended)
          </h3>
          <p className="text-sm text-muted-foreground mb-3">
            The included <InlineCode>docker-compose.yml</InlineCode> provisions
            Postgres as user <InlineCode>vulnradar</InlineCode> and database{" "}
            <InlineCode>vulnradar</InlineCode> by default.{" "}
            <InlineCode>POSTGRES_PASSWORD</InlineCode> has no default: compose
            refuses to start until you set it in <InlineCode>.env</InlineCode>.
            The database port is not published to the host at all, so it is
            reachable only from inside the compose network, at{" "}
            <InlineCode>postgres:5432</InlineCode>. See{" "}
            <Link
              href="/docs/self-hosting"
              className="text-primary underline-offset-2 hover:underline"
            >
              Self-Hosting
            </Link>
            .
          </p>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="text-base font-semibold mb-4">
            Schema auto-creates on boot
          </h3>
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            On first server boot <InlineCode>instrumentation.ts</InlineCode>{" "}
            calls <InlineCode>apply-boot-schema</InlineCode>, which runs the
            idempotent <InlineCode>CREATE ... IF NOT EXISTS</InlineCode>{" "}
            statements in <InlineCode>lib/database/schema/</InlineCode> for
            every table. No manual migration is required for a fresh database.
            For databases upgraded from an older schema, see{" "}
            <a
              href="#migration"
              className="text-primary underline-offset-2 hover:underline"
            >
              Schema Migration
            </a>
            .
          </p>
        </Card>
      </DocsSection>

      <DocsSection id="environment" title="Environment Configuration">
        <p className="text-sm text-muted-foreground">
          Secrets and per-deployment overrides go in{" "}
          <InlineCode>.env</InlineCode> (or <InlineCode>.env.local</InlineCode>{" "}
          for local-only overrides; Next.js loads{" "}
          <InlineCode>.env.local</InlineCode> with higher precedence than{" "}
          <InlineCode>.env</InlineCode>
          ).
        </p>

        <Card className="p-6 border-border/40">
          <h3 className="text-base font-semibold mb-4">
            Create .env from the template
          </h3>
          <CodeBlock code="cp .env.example .env" language="bash" />
          <p className="text-sm text-muted-foreground mt-4">
            Open <InlineCode>.env</InlineCode> and fill in at minimum:
          </p>
          <CodeBlock
            code={`# Database
DATABASE_URL=postgresql://vulnradar:your-password@localhost:5432/vulnradar
DATABASE_SSL=false

# Public URL
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Plain http://localhost with nothing terminating TLS. Trusted networks only:
# remove this once a reverse proxy serves the app over HTTPS.
ALLOW_INSECURE_HTTP=1

# API key encryption (REQUIRED). Generate with:
#   openssl rand -hex 32
API_KEY_ENCRYPTION_KEY=your-64-character-hex-key`}
            language="bash"
          />
          <p className="text-sm text-muted-foreground mt-4">
            Optional: SMTP, Stripe, Discord, Turnstile. Full reference on the{" "}
            <Link href="/docs/config" className="text-primary hover:underline">
              Configuration
            </Link>{" "}
            page.
          </p>
        </Card>

        <DocsCallout variant="info" title="Never commit .env">
          <p>
            <InlineCode>.env</InlineCode> and{" "}
            <InlineCode>.env.local</InlineCode> are git-ignored by default. If
            you fork the repo, double-check <InlineCode>.gitignore</InlineCode>.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="config" title="App Configuration">
        <p className="text-sm text-muted-foreground">
          Non-secret deployment tunables live in{" "}
          <InlineCode>lib/config/config-values.ts</InlineCode>. Branding, app
          name, and SEO values are baked in at build time, so edit those before
          the first build and restart to pick up changes. Most of the rest (rate
          limits, feature flags, billing, scan timeouts) can also be changed at
          runtime after signup, from <InlineCode>/admin</InlineCode>&rsquo;s
          Settings tab, with no restart. See{" "}
          <Link href="/docs/config" className="text-primary hover:underline">
            Configuration
          </Link>{" "}
          for which is which.
        </p>

        <DocsCallout variant="info" title="There is no YAML config file">
          <p>
            Earlier (pre-v2.3.0) planning docs referenced a{" "}
            <InlineCode>config.yaml</InlineCode> file. The current
            implementation does not use one. All non-secret configuration is in{" "}
            <InlineCode>lib/config/config-values.ts</InlineCode>; all secrets
            are environment variables.
          </p>
        </DocsCallout>

        <Card className="p-6 border-border/40">
          <h3 className="text-base font-semibold mb-4">Common changes</h3>
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <InlineCode>CONFIG_APP_NAME</InlineCode>,{" "}
              <InlineCode>CONFIG_APP_URL</InlineCode>,{" "}
              <InlineCode>CONFIG_APP_DESCRIPTION</InlineCode>: branding
            </li>
            <li>
              <InlineCode>CONFIG_SUPPORT_EMAIL</InlineCode>,{" "}
              <InlineCode>CONFIG_LEGAL_EMAIL</InlineCode>,{" "}
              <InlineCode>CONFIG_SECURITY_EMAIL</InlineCode>: outbound email
              addresses
            </li>
            <li>
              <InlineCode>CONFIG_BILLING_ENABLED = false</InlineCode>: disable
              Stripe entirely
            </li>
            <li>
              <InlineCode>CONFIG_FEATURE_DEMO_MODE = false</InlineCode>: hide
              the <InlineCode>/demo</InlineCode> page
            </li>
          </ul>
          <p className="text-sm text-muted-foreground mt-4">
            Full reference:{" "}
            <Link
              href="/docs/config"
              className="text-primary underline-offset-2 hover:underline"
            >
              /docs/config
            </Link>
            .
          </p>
        </Card>
      </DocsSection>

      <DocsSection id="running" title="Running the Application">
        <Card className="p-6 border-border/40">
          <h3 className="text-base font-semibold mb-4">
            Development (with hot reload)
          </h3>
          <CodeBlock code="npm run dev" language="bash" />
          <p className="text-xs text-muted-foreground mt-2">
            Available at{" "}
            <a
              href="http://localhost:3000"
              className="text-primary hover:underline"
            >
              http://localhost:3000
            </a>
          </p>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="text-base font-semibold mb-4">Production</h3>
          <CodeBlock
            code={`npm run build
npm start`}
            language="bash"
          />
          <p className="text-xs text-muted-foreground mt-2">
            Listens on port 3000 by default. Put behind a reverse proxy (Caddy,
            Traefik, nginx) for TLS.
          </p>
        </Card>

        <DocsCallout variant="warning" title="No TLS yet?">
          <p>
            The app redirects every plain-HTTP request to https, and with no
            proxy in front nothing is listening there. Keep{" "}
            <InlineCode>ALLOW_INSECURE_HTTP=1</InlineCode> in{" "}
            <InlineCode>.env</InlineCode>, as in the block above, until a proxy
            terminates TLS, then remove it. Trusted networks only: traffic and
            the session cookie are unencrypted while it is set.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="verification" title="Verification">
        <Card className="p-6 border-border/40 space-y-4">
          <div>
            <h3 className="text-base font-semibold mb-2">1. Access the app</h3>
            <p className="text-sm text-muted-foreground">
              Open <InlineCode>http://localhost:3000</InlineCode>. The landing
              page renders at that address for anyone who is signed out, once{" "}
              <InlineCode>ALLOW_INSECURE_HTTP=1</InlineCode> is set or a proxy
              is in front.
            </p>
          </div>
          <div>
            <h3 className="text-base font-semibold mb-2">
              2. Sign up the first user
            </h3>
            <p className="text-sm text-muted-foreground">
              Visit <InlineCode>/signup</InlineCode>. Email verification is
              required before login if SMTP is configured.
            </p>
          </div>
          <div>
            <h3 className="text-base font-semibold mb-2">
              3. Promote to admin
            </h3>
            <p className="text-sm text-muted-foreground mb-2">
              The first account on a fresh instance is already{" "}
              <InlineCode>super_admin</InlineCode>, so there is nothing to run.
              The command below promotes a <em>later</em> account to{" "}
              <InlineCode>admin</InlineCode>, which is one level lower. Running
              it against the first account demotes it, and no screen in the
              product can restore <InlineCode>super_admin</InlineCode>. A
              restart can: when no account holds the role, the next boot
              promotes the lowest-id verified, non-disabled account, which is
              normally the first one ever registered.
            </p>
            <CodeBlock
              code={`docker compose exec postgres psql -U vulnradar -d vulnradar -c \\
  "UPDATE users SET role = 'admin' WHERE email = 'a-colleague@example.com'"`}
              language="bash"
            />
          </div>
          <div>
            <h3 className="text-base font-semibold mb-2">
              4. Generate an API key
            </h3>
            <p className="text-sm text-muted-foreground">
              Open{" "}
              <Link
                href="/profile?tab=developer&dtab=api-keys"
                className="text-primary underline-offset-2 hover:underline"
              >
                Profile &gt; Developer &gt; API Keys
              </Link>
              : type a name, keep the scan scopes ticked, click Create key. The
              key is shown once.
            </p>
          </div>
          <div>
            <h3 className="text-base font-semibold mb-2">5. Run a scan</h3>
            <CodeBlock
              code={`# Your own instance: http://localhost:3000, or your NEXT_PUBLIC_APP_URL.
curl -X POST "http://localhost:3000/api/v3/scan" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://example.com"}'

# Answers with { "scanId": ..., "status": "running" }. Poll it, using that scanId:
curl "http://localhost:3000/api/v3/scan/status/SCAN_ID" \\
  -H "Authorization: Bearer YOUR_API_KEY"`}
              language="bash"
            />
            <p className="text-sm text-muted-foreground mt-3">
              Repeat the poll until the response says{" "}
              <InlineCode>status: completed</InlineCode>. The result comes back
              in the same response.
            </p>
          </div>
        </Card>

        <div id="health" className="scroll-mt-24">
          <Card className="p-6 border-border/40">
            <h3 className="text-base font-semibold mb-4">Health check</h3>
            <CodeBlock
              code="curl -i http://localhost:3000/api/v3/health"
              language="bash"
            />
            <p className="max-w-[68ch] text-sm text-muted-foreground mt-3">
              <InlineCode>200</InlineCode> with{" "}
              <InlineCode>&quot;status&quot;: &quot;ok&quot;</InlineCode> means
              the database answered, the schema is at least v
              {MIN_SCHEMA_VERSION} and every required table exists.{" "}
              <InlineCode>503</InlineCode> is either{" "}
              <InlineCode>degraded</InlineCode> (the database answered but the
              schema is behind: run <InlineCode>npm run db:migrate</InlineCode>)
              or <InlineCode>unhealthy</InlineCode> (it did not answer). It
              needs no login, ignores maintenance mode and the HTTPS redirect,
              and is what the Docker HEALTHCHECK and a load balancer should
              call. <InlineCode>/api/version</InlineCode> is not a substitute:
              it only asks GitHub for the latest release and answers 200
              whatever the database is doing. Every field is described under{" "}
              <Link
                href="/docs/self-hosting#health"
                className="text-primary underline-offset-2 hover:underline"
              >
                Self-Hosting, Health check
              </Link>
              .
            </p>
          </Card>
        </div>
      </DocsSection>

      <DocsSection id="troubleshooting" title="Troubleshooting">
        <Card className="p-6 border-border/40 space-y-4">
          {[
            {
              title: "Database connection refused",
              error: "ECONNREFUSED 127.0.0.1:5432",
              solution: `# Local install
sudo systemctl status postgresql
sudo systemctl start postgresql

# Docker
docker compose ps postgres
docker compose logs postgres`,
            },
            {
              title: "Password authentication failed",
              error: 'password authentication failed for user "vulnradar"',
              solution: `# DATABASE_URL has to use the user and password from Database Setup.
# Not sure what the password was? Set it again:
psql -U postgres -c "ALTER USER vulnradar WITH PASSWORD 'your-password'"

# Docker: Postgres reads POSTGRES_PASSWORD only when its volume is first
# created, so a later change to .env does not change the database. Run this
# with the value from .env, then: docker compose up -d app
docker compose exec postgres psql -U vulnradar -d vulnradar -c "ALTER USER vulnradar WITH PASSWORD 'your-password'"`,
            },
            {
              title: "Port 3000 already in use",
              error: "EADDRINUSE: address already in use :::3000",
              solution: `# Find the process
lsof -i :3000

# Or use a different port (Next.js CLI flag)
npm run dev -- -p 3001`,
            },
            {
              title: "Module not found after fresh clone",
              error: "Cannot find module 'next'",
              solution: `# Remove stale lockfile + reinstall
rm -rf node_modules .next
npm ci`,
            },
            {
              title: "Schema version mismatch at startup",
              error: `SCHEMA VERSION MISMATCH ... Database schema: v2.0.0 / App requires: v${MIN_SCHEMA_VERSION}`,
              solution: `# Run the migration tool (interactive)
npm run db:migrate

# Or, in dry-run first
npm run db:migrate:dry-run`,
            },
            {
              title: "Validation: API_KEY_ENCRYPTION_KEY invalid",
              error:
                "API_KEY_ENCRYPTION_KEY must be a 64-character hex string (32 bytes).",
              solution: `openssl rand -hex 32
# Paste the output into .env, then stop and re-run npm start.
# Docker: docker compose up -d app`,
            },
          ].map((item, i) => (
            <div key={i}>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-[hsl(var(--warning))]" />
                <h3 className="text-base font-semibold">{item.title}</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-2">
                Error: <InlineCode>{item.error}</InlineCode>
              </p>
              <CodeBlock code={item.solution} language="bash" />
            </div>
          ))}
        </Card>
      </DocsSection>

      <DocsSection id="deployment" title="Deployment Options">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          <strong className="text-foreground">
            Serverless hosts are not supported.
          </strong>{" "}
          Background workers and detached scans never run there. Use Docker or a
          Node host with PM2 or systemd, and follow{" "}
          <Link
            href="/docs/self-hosting"
            className="text-primary underline-offset-2 hover:underline"
          >
            Self-Hosting
          </Link>
          .
        </p>

        <Card className="p-6 border-border/40">
          <h3 className="text-base font-semibold mb-4">Self-hosted (Linux)</h3>
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>Provision a server with Node 22 LTS and PostgreSQL 14+.</li>
            <li>
              Clone the repo, install dependencies (
              <InlineCode>npm ci</InlineCode>).
            </li>
            <li>
              Configure <InlineCode>.env</InlineCode>.
            </li>
            <li>
              <InlineCode>npm run build</InlineCode>
            </li>
            <li>
              Run it under systemd or PM2, below, with a reverse proxy (Caddy,
              Traefik, nginx) in front for TLS.
            </li>
          </ol>

          <h4 className="text-sm font-semibold mt-6 mb-2">systemd</h4>
          <CodeBlock
            code={`[Unit]
Description=${APP_NAME}
After=network.target postgresql.service

[Service]
User=vulnradar
WorkingDirectory=/opt/${APP_SLUG}.dev
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/npm start
Restart=on-failure

[Install]
WantedBy=multi-user.target`}
            language="ini"
            filename="/etc/systemd/system/vulnradar.service"
          />
          <p className="max-w-[68ch] text-sm text-muted-foreground mt-3 mb-2">
            Set <InlineCode>User</InlineCode> and{" "}
            <InlineCode>WorkingDirectory</InlineCode> for your server, and the{" "}
            <InlineCode>ExecStart</InlineCode> path to what{" "}
            <InlineCode>which npm</InlineCode> prints. The app reads{" "}
            <InlineCode>.env</InlineCode> from the working directory. Then:
          </p>
          <CodeBlock
            code={`sudo systemctl daemon-reload
sudo systemctl enable --now vulnradar`}
            language="bash"
          />

          <h4 className="text-sm font-semibold mt-6 mb-2">PM2</h4>
          <CodeBlock
            code="pm2 start npm --name vulnradar -- start"
            language="bash"
          />
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="text-base font-semibold mb-4">Docker Compose</h3>
          <p className="text-sm text-muted-foreground">
            Follow{" "}
            <Link
              href="/docs/self-hosting"
              className="text-primary underline-offset-2 hover:underline"
            >
              Self-Hosting
            </Link>
            .
          </p>
        </Card>
      </DocsSection>

      {/* Only the heading and id are left: the id keeps old links landing here
          until this page redirects to Self-Hosting. */}
      <DocsSection id="docker" title="Docker Deployment">
        <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
          Deploying with Docker? Follow{" "}
          <Link
            href="/docs/self-hosting"
            className="text-primary underline-offset-2 hover:underline"
          >
            Self-Hosting
          </Link>
          , which is the supported path.
        </p>
      </DocsSection>

      <DocsSection id="migration" title="Schema Migration">
        <p className="max-w-[68ch] text-sm text-muted-foreground">
          When a database is behind the schema this build requires, use the
          interactive migration tool. This build requires v{MIN_SCHEMA_VERSION}
          {PREVIOUS_SCHEMA_VERSION
            ? `, so a database still on v${PREVIOUS_SCHEMA_VERSION} is migrated up with the ${PREVIOUS_SCHEMA_VERSION}-to-${MIN_SCHEMA_VERSION} step`
            : ""}
          . The migrator reads <InlineCode>vulnradar_schema_meta</InlineCode> to
          detect the current schema (and fingerprints the tables when there is
          no row), picks the target version, builds a DDL plan, and applies it
          in a single transaction. Before it runs any DDL it writes a backup of
          its own, to <InlineCode>&lt;BACKUP_DIR&gt;/pre-migration</InlineCode>{" "}
          and pruned after{" "}
          <InlineCode>MIGRATION_BACKUP_RETENTION_DAYS</InlineCode> (default 90
          days).
        </p>

        <Card className="p-6 border-border/40">
          <h3 className="text-base font-semibold mb-4">Run a migration</h3>
          <CodeBlock
            code={`# Preview the plan first
npm run db:migrate:dry-run

# Then run for real (interactive)
npm run db:migrate`}
            language="bash"
          />
          <p className="text-xs text-muted-foreground mt-2">
            Flags accepted by the CLI: <InlineCode>--dry-run</InlineCode>,{" "}
            <InlineCode>--yes</InlineCode> (non-interactive, accept every
            default) and <InlineCode>--help</InlineCode>. It also goes
            non-interactive on its own whenever stdin is not a terminal, which
            is what makes{" "}
            <InlineCode>
              docker compose run --rm app npm run db:migrate
            </InlineCode>{" "}
            work in a pipeline. The target version is selected interactively;
            downgrades require typing <InlineCode>yes-delete-data</InlineCode>.
          </p>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="text-base font-semibold mb-4">Side-by-side clone</h3>
          <p className="text-sm text-muted-foreground mb-3">
            To create a new database (e.g. for testing an upgrade on a copy of
            production), use <InlineCode>db:create</InlineCode>:
          </p>
          <CodeBlock
            code={`# Preview
npm run db:create:dry-run

# Interactive: choose source DB, target DB name, copy data?
npm run db:create`}
            language="bash"
          />
        </Card>
      </DocsSection>

      <DocsSection id="version" title="Version Check">
        <p className="text-sm text-muted-foreground">
          {APP_NAME} compares its installed version against the latest GitHub
          release once per hour.
        </p>

        <Card className="p-6 border-border/40">
          <h3 className="text-base font-semibold mb-4">Programmatic check</h3>
          <CodeBlock code={`curl ${APP_URL}/api/version`} language="bash" />
          <p className="text-xs text-muted-foreground mt-2">
            Unauthenticated. Cached for 1 hour upstream of GitHub.
          </p>
          <CodeBlock
            code={`{
  "current": "${APP_VERSION}",
  "engine": "${ENGINE_VERSION}",
  "latest": "${APP_VERSION}",
  "status": "up-to-date",
  "message": "You're running the latest version.",
  "release_url": "https://github.com/${APP_REPO}/releases/tag/v${APP_VERSION}"
}`}
            language="json"
            className="mt-3"
          />
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="text-base font-semibold mb-4">Status values</h3>
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <InlineCode>up-to-date</InlineCode>: running the latest release
            </li>
            <li>
              <InlineCode>behind</InlineCode>: a newer release exists;{" "}
              <InlineCode>release_url</InlineCode> points to it. To move to it,
              follow{" "}
              <Link
                href="/docs/self-hosting#updates"
                className="text-primary underline-offset-2 hover:underline"
              >
                Self-Hosting, Upgrading
              </Link>
            </li>
            <li>
              <InlineCode>ahead</InlineCode>: running a version newer than the
              latest release (development / RC)
            </li>
            <li>
              <InlineCode>unknown</InlineCode>: GitHub unreachable,
              rate-limited, or the repo does not exist
            </li>
          </ul>
        </Card>
      </DocsSection>
    </div>
  );
}
