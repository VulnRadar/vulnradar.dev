"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { CheckCircle, AlertTriangle } from "lucide-react";
import {
  APP_NAME,
  APP_URL,
  APP_VERSION,
  ENGINE_VERSION,
  APP_REPO,
  APP_SLUG,
} from "@/lib/config/constants";
import { useDocsContext, type TocItem } from "../layout";
import {
  DocsHero,
  DocsSection,
  DocsCallout,
  CodeBlock,
} from "@/components/docs";

const tocItems: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "prerequisites", label: "Prerequisites" },
  { id: "installation", label: "Installation" },
  { id: "database", label: "Database Setup" },
  { id: "environment", label: "Environment Config" },
  { id: "config", label: "App Configuration" },
  { id: "running", label: "Running the App" },
  { id: "verification", label: "Verification" },
  { id: "troubleshooting", label: "Troubleshooting" },
  { id: "deployment", label: "Deployment" },
  { id: "docker", label: "Docker Deployment" },
  { id: "migration", label: "Schema Migration" },
  { id: "version", label: "Version Check" },
];

export default function SetupPage() {
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
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
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
        title="Setup Guide"
        description={`Install and configure ${APP_NAME} locally or in production. Three deployment paths: local Node, Docker, or a generic Node host.`}
      />

      <div className="grid grid-cols-3 gap-2 sm:gap-4 -mt-10">
        <a
          href="#installation"
          className="p-2.5 sm:p-4 rounded-lg bg-card border border-border/40 hover:border-accent transition-colors"
        >
          <div className="text-sm sm:text-lg font-bold text-primary mb-0.5 sm:mb-1">
            Local Dev
          </div>
          <div className="text-[10px] sm:text-xs text-muted-foreground">
            Clone + npm
          </div>
        </a>
        <a
          href="#docker"
          className="p-2.5 sm:p-4 rounded-lg bg-card border border-border/40 hover:border-accent transition-colors"
        >
          <div className="text-sm sm:text-lg font-bold text-primary mb-0.5 sm:mb-1">
            Docker
          </div>
          <div className="text-[10px] sm:text-xs text-muted-foreground">
            5 min deploy
          </div>
        </a>
        <a
          href="#deployment"
          className="p-2.5 sm:p-4 rounded-lg bg-card border border-border/40 hover:border-accent transition-colors"
        >
          <div className="text-sm sm:text-lg font-bold text-primary mb-0.5 sm:mb-1">
            Bare Node
          </div>
          <div className="text-[10px] sm:text-xs text-muted-foreground">
            systemd / PM2
          </div>
        </a>
      </div>

      <DocsSection id="prerequisites" title="Prerequisites">
        <p className="text-muted-foreground">
          Before you begin, ensure you have the following installed:
        </p>

        <Card className="p-6 border-border/40 space-y-3">
          {[
            {
              title: "Node.js 22 LTS",
              desc: "JavaScript runtime. The project supports Node 20 LTS and Node 22 LTS (engines field in package.json). Odd versions like 21 and 23 are excluded by vitest@4 and friends; see the Node Version Policy on the Developers page.",
              link: "https://nodejs.org",
              cmd: "node --version",
            },
            {
              title: "npm 9+ or pnpm 8+",
              desc: "Package manager (ships with Node.js).",
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
              <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-semibold mb-1">{item.title}</h4>
                <p className="text-sm text-muted-foreground">
                  {item.desc}.
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
          <h3 className="font-semibold mb-4">Step 1: Clone the Repository</h3>
          <CodeBlock
            code={`git clone https://github.com/${APP_REPO}.git\ncd ${APP_SLUG}.dev`}
            language="bash"
          />
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Step 2: Install Dependencies</h3>
          <CodeBlock code="npm ci" language="bash" />
          <p className="text-xs text-muted-foreground mt-2">
            Allow-scripts for native packages (bcrypt, esbuild, sharp,
            unrs-resolver, core-js) are whitelisted in <code>.npmrc</code>.
          </p>
        </Card>
      </DocsSection>

      <DocsSection id="database" title="Database Setup">
        <p className="text-muted-foreground">
          Configure PostgreSQL for {APP_NAME}.
        </p>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">
            Option A: Dedicated database (no Docker)
          </h3>
          <CodeBlock
            code={`psql -U postgres

CREATE DATABASE vulnradar;
CREATE USER vulnradar_user WITH PASSWORD 'strong_password_here';
GRANT ALL PRIVILEGES ON DATABASE vulnradar TO vulnradar_user;
\\q`}
            language="sql"
          />
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">
            Option B: Docker Compose (recommended)
          </h3>
          <p className="text-sm text-muted-foreground mb-3">
            The included <code>docker-compose.yml</code> provisions Postgres
            with credentials <code>vulnradar:vulnradar</code> on port 5432. See
            the <a href="#docker">Docker section</a> below.
          </p>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Schema auto-creates on boot</h3>
          <p className="text-sm text-muted-foreground">
            <code>instrumentation.ts</code> runs{" "}
            <code>CREATE TABLE IF NOT EXISTS</code> for every table on first
            server boot. No manual migration is required for a fresh database.
            For databases upgraded from an older schema, see{" "}
            <a href="#migration">Schema Migration</a>.
          </p>
        </Card>
      </DocsSection>

      <DocsSection id="environment" title="Environment Configuration">
        <p className="text-muted-foreground">
          Secrets and per-deployment overrides go in <code>.env</code> (or{" "}
          <code>.env.local</code> for local-only overrides; Next.js loads{" "}
          <code>.env.local</code> with higher precedence than <code>.env</code>
          ).
        </p>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Create .env from the template</h3>
          <CodeBlock code="cp .env.example .env" language="bash" />
          <p className="text-sm text-muted-foreground mt-4">
            Open <code>.env</code> and fill in at minimum:
          </p>
          <CodeBlock
            code={`# Database
DATABASE_URL=postgresql://vulnradar:your-password@localhost:5432/vulnradar
DATABASE_SSL=false

# Public URL
NEXT_PUBLIC_APP_URL=http://localhost:3000

# API key encryption (REQUIRED). Generate with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
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
            <code>.env</code> and <code>.env.local</code> are git-ignored by
            default. If you fork the repo, double-check <code>.gitignore</code>.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="config" title="App Configuration">
        <p className="text-muted-foreground">
          Non-secret deployment tunables live in{" "}
          <code>lib/config/config-values.ts</code>. Edit that file before the
          first build. Restart the process to pick up changes.
        </p>

        <DocsCallout variant="info" title="There is no YAML config file">
          <p>
            Earlier (pre-v2.3.0) planning docs referenced a{" "}
            <code>config.yaml</code> file. The current implementation does not
            use one. All non-secret configuration is in{" "}
            <code>lib/config/config-values.ts</code>; all secrets are
            environment variables.
          </p>
        </DocsCallout>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Common changes</h3>
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>CONFIG_APP_NAME</code>, <code>CONFIG_APP_URL</code>,{" "}
              <code>CONFIG_APP_DESCRIPTION</code> — branding
            </li>
            <li>
              <code>CONFIG_SUPPORT_EMAIL</code>, <code>CONFIG_LEGAL_EMAIL</code>
              , <code>CONFIG_SECURITY_EMAIL</code> — outbound email addresses
            </li>
            <li>
              <code>CONFIG_BILLING_ENABLED = false</code> — disable Stripe
              entirely
            </li>
            <li>
              <code>CONFIG_FEATURE_DEMO_MODE = false</code> — hide the{" "}
              <code>/demo</code> page
            </li>
          </ul>
          <p className="text-sm text-muted-foreground mt-4">
            Full reference: <Link href="/docs/config">/docs/config</Link>.
          </p>
        </Card>
      </DocsSection>

      <DocsSection id="running" title="Running the Application">
        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Development (with hot reload)</h3>
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
          <h3 className="font-semibold mb-4">Production</h3>
          <CodeBlock code="npm run build\nnpm start" language="bash" />
          <p className="text-xs text-muted-foreground mt-2">
            Listens on port 3000 by default. Put behind a reverse proxy (Caddy,
            Traefik, nginx) for TLS.
          </p>
        </Card>
      </DocsSection>

      <DocsSection id="verification" title="Verification">
        <Card className="p-6 border-border/40 space-y-4">
          <div>
            <h3 className="font-semibold mb-2">1. Access the app</h3>
            <p className="text-sm text-muted-foreground">
              Open <code>http://localhost:3000</code>. The landing page renders
              and middleware redirects unauthenticated users to{" "}
              <code>/landing</code>.
            </p>
          </div>
          <div>
            <h3 className="font-semibold mb-2">2. Sign up the first user</h3>
            <p className="text-sm text-muted-foreground">
              Visit <code>/signup</code>. Email verification is required before
              login if SMTP is configured.
            </p>
          </div>
          <div>
            <h3 className="font-semibold mb-2">3. Promote to admin</h3>
            <p className="text-sm text-muted-foreground mb-2">
              Connect to Postgres and set the role:
            </p>
            <CodeBlock
              code={`docker compose exec postgres psql -U vulnradar -d vulnradar -c \\
  "UPDATE users SET role = 'admin' WHERE email = 'you@example.com'"`}
              language="bash"
            />
          </div>
          <div>
            <h3 className="font-semibold mb-2">4. Generate an API key</h3>
            <p className="text-sm text-muted-foreground">
              Open <Link href="/profile">/profile</Link> → API Keys → Generate
              New Key. The raw key is shown once; copy it immediately.
            </p>
          </div>
          <div>
            <h3 className="font-semibold mb-2">5. Run a scan</h3>
            <CodeBlock
              code={`curl -X POST "${APP_URL}/api/v3/scan" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://example.com"}'`}
              language="bash"
            />
          </div>
        </Card>
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
              error: "Schema version mismatch: expected v2.0.0, found v1.0.0",
              solution: `# Run the migration tool (interactive)
npm run db:migrate

# Or, in dry-run first
npm run db:migrate:dry-run`,
            },
            {
              title: "Validation: API_KEY_ENCRYPTION_KEY invalid",
              error: "Invalid API_KEY_ENCRYPTION_KEY (must be 64 hex chars)",
              solution: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Paste the output into .env, restart.`,
            },
          ].map((item, i) => (
            <div key={i}>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <h3 className="font-semibold">{item.title}</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-2">
                Error: <code>{item.error}</code>
              </p>
              <CodeBlock code={item.solution} language="bash" />
            </div>
          ))}
        </Card>
      </DocsSection>

      <DocsSection id="deployment" title="Deployment Options">
        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Vercel</h3>
          <p className="text-sm text-muted-foreground mb-3">
            VulnRadar is a standard Next.js 15 App Router app and runs on Vercel
            out of the box. Use Neon or any other serverless Postgres for the
            database. Configure environment variables in the Vercel dashboard
            before deploying.
          </p>
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>Push the repo to GitHub.</li>
            <li>Import the project in Vercel.</li>
            <li>Add the required env vars (see above).</li>
            <li>Deploy.</li>
          </ol>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Self-hosted (Linux)</h3>
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>Provision a server with Node 22 LTS and PostgreSQL 14+.</li>
            <li>
              Clone the repo, install dependencies (<code>npm ci</code>).
            </li>
            <li>
              Configure <code>.env</code>.
            </li>
            <li>
              <code>npm run build &amp;&amp; npm start</code>
            </li>
            <li>
              Manage the process with PM2 or systemd. Reverse-proxy (Caddy,
              Traefik, nginx) for TLS.
            </li>
          </ol>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Docker Compose</h3>
          <p className="text-sm text-muted-foreground">
            See the Docker section below.
          </p>
        </Card>
      </DocsSection>

      <DocsSection id="docker" title="Docker Deployment">
        <p className="text-muted-foreground">
          Deploy {APP_NAME} with the included <code>docker-compose.yml</code>{" "}
          (Postgres + app + healthcheck + smoke test).
        </p>

        <DocsCallout variant="success" title="Prerequisites">
          <p>Docker 24+ and Docker Compose v2.</p>
          <CodeBlock
            code="docker --version\ndocker compose version"
            language="bash"
            className="mt-2"
          />
        </DocsCallout>

        <div className="space-y-3">
          <Card className="p-6 border-border/40">
            <h3 className="font-semibold mb-4">Step 1: Project directory</h3>
            <CodeBlock
              code="mkdir -p ~/vulnradar\ncd ~/vulnradar"
              language="bash"
            />
          </Card>

          <Card className="p-6 border-border/40">
            <h3 className="font-semibold mb-4">
              Step 2: Get <code>docker-compose.yml</code>
            </h3>
            <p className="text-sm text-muted-foreground mb-3">
              Either pull the prebuilt image from GHCR:
            </p>
            <CodeBlock
              code={`curl -O https://raw.githubusercontent.com/${APP_REPO}/main/docker-compose.yml\ncurl -O https://raw.githubusercontent.com/${APP_REPO}/main/.env.example`}
              language="bash"
            />
            <p className="text-sm text-muted-foreground mt-3">
              Or build from source locally:
            </p>
            <CodeBlock
              code={`git clone https://github.com/${APP_REPO}.git\ncd ${APP_SLUG}.dev\ncp .env.example .env`}
              language="bash"
            />
          </Card>

          <Card className="p-6 border-border/40">
            <h3 className="font-semibold mb-4">Step 3: Configure .env</h3>
            <CodeBlock
              code={`# Required
DATABASE_URL=postgresql://vulnradar:your-strong-password@postgres:5432/vulnradar
NEXT_PUBLIC_APP_URL=https://yourdomain.com
API_KEY_ENCRYPTION_KEY=your-64-character-hex-key

# Used by docker-compose.yml to provision Postgres
POSTGRES_DB=vulnradar
POSTGRES_USER=vulnradar
POSTGRES_PASSWORD=your-strong-password

# Ports
APP_PORT=3000
DB_PORT=5432`}
              language="bash"
            />
          </Card>

          <Card className="p-6 border-border/40">
            <h3 className="font-semibold mb-4">Step 4: Start</h3>
            <CodeBlock code="docker compose up -d" language="bash" />
            <CodeBlock
              code="docker compose ps"
              language="bash"
              className="mt-2"
            />
          </Card>

          <Card className="p-6 border-border/40">
            <h3 className="font-semibold mb-4">Step 5: Verify</h3>
            <CodeBlock code="docker compose logs -f app" language="bash" />
            <p className="text-xs text-muted-foreground mt-2">
              Look for the startup banner and{" "}
              <code>Database schema verified successfully</code>.
            </p>
          </Card>
        </div>

        <DocsCallout variant="error" title="HTTPS required">
          <p>
            Put the app behind a reverse proxy (Caddy, Traefik, nginx) for TLS
            termination. Cookie flags (<code>secure</code>) and CSP headers
            assume HTTPS in production.
          </p>
        </DocsCallout>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Common operations</h3>
          <div className="space-y-4">
            {[
              {
                title: "Tail logs",
                cmd: "docker compose logs -f app",
              },
              {
                title: "Stop (keep data)",
                cmd: "docker compose down",
              },
              {
                title: "Full reset (drop volumes)",
                cmd: "docker compose down -v",
              },
              {
                title: "Update",
                cmd: "docker compose pull && docker compose up -d",
              },
              {
                title: "Restart only the app",
                cmd: "docker compose restart app",
              },
              {
                title: "Open a psql shell",
                cmd: "docker compose exec postgres psql -U vulnradar -d vulnradar",
              },
            ].map((item, i) => (
              <div key={i}>
                <h4 className="font-semibold text-sm mb-2">{item.title}</h4>
                <CodeBlock code={item.cmd} language="bash" />
              </div>
            ))}
          </div>
        </Card>
      </DocsSection>

      <DocsSection id="migration" title="Schema Migration">
        <p className="text-muted-foreground">
          When upgrading between schema versions (e.g. v1 → v2), use the
          interactive migration tool. The migrator reads{" "}
          <code>vulnradar_schema_meta</code> to detect the current schema, picks
          the target version, builds a DDL plan, and applies it in a single
          transaction.
        </p>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Run a migration</h3>
          <CodeBlock
            code={`# Preview the plan first
npm run db:migrate:dry-run

# Then run for real (interactive)
npm run db:migrate`}
            language="bash"
          />
          <p className="text-xs text-muted-foreground mt-2">
            Flags accepted by the CLI: <code>--dry-run</code>,{" "}
            <code>--help</code>. The target version is selected interactively;
            downgrades require typing <code>yes-delete-data</code>.
          </p>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Side-by-side clone</h3>
          <p className="text-sm text-muted-foreground mb-3">
            To create a new database (e.g. for testing an upgrade on a copy of
            production), use <code>db:create</code>:
          </p>
          <CodeBlock
            code={`# Preview
npm run db:create:dry-run

# Interactive: choose source DB, target DB name, copy data?
npm run db:create`}
            language="bash"
          />
        </Card>

        <DocsCallout variant="warning" title="Schema drift detector">
          <p>
            <code>npm run audit:v2-tables</code> compares{" "}
            <code>instrumentation.ts</code> against{" "}
            <code>scripts/migrate/versions/_snippets.mjs</code>. If they drift,
            the migrator will fail until both are in sync. Wire this into CI.
          </p>
        </DocsCallout>
      </DocsSection>

      <DocsSection id="version" title="Version Check">
        <p className="text-muted-foreground">
          {APP_NAME} compares its installed version against the latest GitHub
          release once per hour.
        </p>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Programmatic check</h3>
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
          <h3 className="font-semibold mb-4">Status values</h3>
          <ul className="list-disc pl-6 space-y-1 text-sm text-muted-foreground">
            <li>
              <code>up-to-date</code> — running the latest release
            </li>
            <li>
              <code>behind</code> — newer release exists;{" "}
              <code>release_url</code> points to it
            </li>
            <li>
              <code>ahead</code> — running a version newer than the latest
              release (development / RC)
            </li>
            <li>
              <code>unknown</code> — GitHub unreachable, rate-limited, or the
              repo does not exist
            </li>
          </ul>
        </Card>
      </DocsSection>
    </div>
  );
}
