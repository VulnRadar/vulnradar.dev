"use client"

import { useEffect, useRef } from "react"
import { Card } from "@/components/ui/card"
import { CheckCircle, AlertTriangle } from "lucide-react"
import { APP_NAME, APP_URL, APP_VERSION, ENGINE_VERSION, APP_REPO } from "@/lib/config/constants"
import { useDocsContext, type TocItem } from "../layout"
import { DocsHero, DocsSection, DocsCallout, CodeBlock } from "@/components/docs"

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
  { id: "deployment", label: "Deployment Options" },
  { id: "docker", label: "Docker Deployment" },
  { id: "migration", label: "Migration Tool" },
  { id: "version", label: "Version Check" },
]

export default function SetupPage() {
  const { setActiveSection, setTocItems } = useDocsContext()
  const observerRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    setTocItems(tocItems)
    return () => setTocItems([])
  }, [setTocItems])

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id)
          }
        })
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 }
    )

    tocItems.forEach((item) => {
      const el = document.getElementById(item.id)
      if (el) observerRef.current?.observe(el)
    })

    return () => observerRef.current?.disconnect()
  }, [setActiveSection])

  return (
    <div className="space-y-16">
      {/* Hero */}
      <DocsHero
        badge="Self-Hosting"
        title="Setup Guide"
        description={`Complete guide to installing and configuring ${APP_NAME} for your environment. Choose from local development, Docker, or cloud deployment.`}
      />

      {/* Quick Options */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4 -mt-10">
        <a href="#installation" className="p-2.5 sm:p-4 rounded-lg bg-card border border-border/40 hover:border-accent transition-colors">
          <div className="text-sm sm:text-lg font-bold text-primary mb-0.5 sm:mb-1">Local Dev</div>
          <div className="text-[10px] sm:text-xs text-muted-foreground">Clone locally</div>
        </a>
        <a href="#docker" className="p-2.5 sm:p-4 rounded-lg bg-card border border-border/40 hover:border-accent transition-colors">
          <div className="text-sm sm:text-lg font-bold text-primary mb-0.5 sm:mb-1">Docker</div>
          <div className="text-[10px] sm:text-xs text-muted-foreground">5 min deploy</div>
        </a>
        <a href="#deployment" className="p-2.5 sm:p-4 rounded-lg bg-card border border-border/40 hover:border-accent transition-colors">
          <div className="text-sm sm:text-lg font-bold text-primary mb-0.5 sm:mb-1">Vercel</div>
          <div className="text-[10px] sm:text-xs text-muted-foreground">One-click</div>
        </a>
      </div>

      {/* Prerequisites */}
      <DocsSection id="prerequisites" title="Prerequisites">
        <p className="text-muted-foreground">Before you begin, ensure you have the following installed:</p>

        <Card className="p-6 border-border/40 space-y-3">
          {[
            { title: "Node.js 18.17+", desc: "JavaScript runtime", link: "https://nodejs.org", cmd: "node --version" },
            { title: "npm 9+ or pnpm 8+", desc: "Package manager (comes with Node.js)", cmd: "npm --version" },
            { title: "PostgreSQL 14+", desc: "Database server", link: "https://www.postgresql.org/download", cmd: "psql --version" },
            { title: "Git 2.0+", desc: "Version control", link: "https://git-scm.com", cmd: "git --version" },
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-3">
              <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-semibold mb-1">{item.title}</h4>
                <p className="text-sm text-muted-foreground">
                  {item.desc}.{item.link && <> Download from <a href={item.link} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{item.link.replace("https://", "")}</a></>}
                </p>
                <CodeBlock code={`${item.cmd}  # Check version`} language="bash" className="mt-2" />
              </div>
            </div>
          ))}
        </Card>
      </DocsSection>

      {/* Installation */}
      <DocsSection id="installation" title="Installation Steps">
        <p className="text-muted-foreground">Follow these steps to clone and prepare the repository:</p>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Step 1: Clone the Repository</h3>
          <p className="text-sm text-muted-foreground mb-3">Clone {APP_NAME} from GitHub:</p>
          <CodeBlock code={`git clone https://github.com/${APP_REPO}.git\ncd ${APP_SLUG}.dev`} language="bash" />
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Step 2: Install Dependencies</h3>
          <p className="text-sm text-muted-foreground mb-3">Install all required npm packages:</p>
          <CodeBlock code="npm install\n# or\npnpm install" language="bash" />
        </Card>
      </DocsSection>

      {/* Database Setup */}
      <DocsSection id="database" title="Database Setup">
        <p className="text-muted-foreground">Configure PostgreSQL for {APP_NAME}:</p>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Step 1: Create Database and User</h3>
          <CodeBlock code={`psql -U postgres

# Inside psql:
CREATE DATABASE vulnradar;
CREATE USER vulnradar_user WITH PASSWORD 'strong_password_here';
GRANT ALL PRIVILEGES ON DATABASE vulnradar TO vulnradar_user;
\\q`} language="sql" />
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Step 2: Auto-Schema Setup</h3>
          <p className="text-sm text-muted-foreground mb-3">
            {APP_NAME} automatically creates all required tables when the application starts. Simply run:
          </p>
          <CodeBlock code="npm run dev" language="bash" />
          <p className="text-xs text-muted-foreground mt-2">
            The <code className="bg-secondary px-1 rounded text-xs">instrumentation.ts</code> file handles all schema creation on startup.
          </p>
        </Card>
      </DocsSection>

      {/* Environment Configuration */}
      <DocsSection id="environment" title="Environment Configuration">
        <p className="text-muted-foreground">Configure environment variables for your {APP_NAME} installation:</p>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Create .env.local File</h3>
          <p className="text-sm text-muted-foreground mb-3">
            Create a <code className="bg-secondary px-2 py-1 rounded text-xs">.env.local</code> file in the project root:
          </p>
          <CodeBlock code={`# DATABASE (Required)
DATABASE_URL=postgresql://vulnradar:your-secure-password-here@localhost:5432/vulnradar
DATABASE_SSL=false

# APPLICATION (Required)
NEXT_PUBLIC_APP_URL=http://localhost:3000

# API KEY ENCRYPTION (Required)
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
API_KEY_ENCRYPTION_KEY=your-64-character-hex-key

# SMTP EMAIL (Optional)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@yourdomain.com
SMTP_PASS=your-smtp-password
SMTP_FROM=noreply@yourdomain.com

# STRIPE BILLING (Optional)
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxx
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# DISCORD OAUTH (Optional)
DISCORD_CLIENT_ID=your-discord-client-id
DISCORD_CLIENT_SECRET=your-discord-client-secret`} language="bash" />

          <div className="space-y-4 mt-4">
            <div>
              <h4 className="font-semibold text-sm mb-2">Required Variables</h4>
              <div className="space-y-2 text-xs text-muted-foreground">
                <p><code className="bg-secondary px-1 rounded">DATABASE_URL</code> - PostgreSQL connection string</p>
                <p><code className="bg-secondary px-1 rounded">NEXT_PUBLIC_APP_URL</code> - Your app&apos;s public URL</p>
                <p><code className="bg-secondary px-1 rounded">API_KEY_ENCRYPTION_KEY</code> - 64-char hex key for API key encryption</p>
              </div>
            </div>
          </div>
        </Card>

        <DocsCallout variant="info" title="Environment File Security">
          <p>Never commit <code className="bg-secondary px-1 rounded">.env.local</code> to version control. Add it to <code className="bg-secondary px-1 rounded">.gitignore</code>.</p>
        </DocsCallout>
      </DocsSection>

      {/* Application Configuration */}
      <DocsSection id="config" title="Application Configuration">
        <p className="text-muted-foreground">
          Customize {APP_NAME} by editing <code className="bg-secondary px-2 py-1 rounded text-xs">config.yaml</code>:
        </p>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">config.yaml Overview</h3>
          <CodeBlock code={`app:
  name: "VulnRadar"           # Application name shown in UI
  slug: "vulnradar"           # URL-safe identifier
  version: "${APP_VERSION}"   # Application version
  url: "${APP_URL}"
  repo: "${APP_REPO}"

billing:
  enabled: false              # Enable/disable Stripe billing

features:
  discord_oauth: true         # Enable Discord sign-in
  turnstile: true             # Enable Cloudflare Turnstile`} language="yaml" />
        </Card>

        <DocsCallout variant="success" title="No Environment Variables Needed">
          <p>
            {APP_NAME} reads app metadata from <code className="bg-secondary px-1 rounded">config.yaml</code> instead of <code className="bg-secondary px-1 rounded">NEXT_PUBLIC_*</code> environment variables.
          </p>
        </DocsCallout>
      </DocsSection>

      {/* Running the Application */}
      <DocsSection id="running" title="Running the Application">
        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Development Server</h3>
          <p className="text-sm text-muted-foreground mb-3">Start with hot reload:</p>
          <CodeBlock code="npm run dev\n# or\npnpm dev" language="bash" />
          <p className="text-xs text-muted-foreground mt-2">
            Available at <a href="http://localhost:3000" className="text-primary hover:underline">http://localhost:3000</a>
          </p>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Production Build</h3>
          <CodeBlock code="npm run build\nnpm start" language="bash" />
        </Card>
      </DocsSection>

      {/* Verification */}
      <DocsSection id="verification" title="Verification Steps">
        <p className="text-muted-foreground">Verify that {APP_NAME} is running correctly:</p>

        <Card className="p-6 border-border/40 space-y-4">
          {[
            { step: "1. Access the Application", desc: "Open http://localhost:3000 - you should see the landing page" },
            { step: "2. Create a Test Account", desc: "Click \"Sign Up\" and create a test account with a valid email" },
            { step: "3. Check Database Connection", desc: "Verify user data was created in the database" },
            { step: "4. Generate an API Key", desc: "Navigate to Account Settings → API Keys to create a new key" },
          ].map((item, i) => (
            <div key={i}>
              <h3 className="font-semibold mb-2">{item.step}</h3>
              <p className="text-sm text-muted-foreground">{item.desc}</p>
            </div>
          ))}
        </Card>
      </DocsSection>

      {/* Troubleshooting */}
      <DocsSection id="troubleshooting" title="Troubleshooting">
        <Card className="p-6 border-border/40 space-y-4">
          {[
            {
              title: "Database Connection Error",
              error: "connect ECONNREFUSED 127.0.0.1:5432",
              solution: "# Check if PostgreSQL is running\nsudo systemctl status postgresql\n\n# Start if not running\nsudo systemctl start postgresql",
            },
            {
              title: "Port Already in Use",
              error: "EADDRINUSE: address already in use :::3000",
              solution: "# Find what's using port 3000\nlsof -i :3000\n\n# Use different port\nnpm run dev -- -p 3001",
            },
            {
              title: "Module Not Found Errors",
              error: "Cannot find module 'next'",
              solution: "# Clear and reinstall\nrm -rf node_modules package-lock.json\nnpm install",
            },
          ].map((item, i) => (
            <div key={i}>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <h3 className="font-semibold">{item.title}</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-2">Error: &quot;{item.error}&quot;</p>
              <CodeBlock code={item.solution} language="bash" />
            </div>
          ))}
        </Card>
      </DocsSection>

      {/* Deployment */}
      <DocsSection id="deployment" title="Deployment Options">
        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Vercel (Recommended)</h3>
          <p className="text-sm text-muted-foreground mb-3">{APP_NAME} is optimized for Vercel:</p>
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>Push your code to GitHub</li>
            <li>Connect your repository to Vercel</li>
            <li>Add environment variables in Vercel settings</li>
            <li>Deploy with a single click</li>
          </ol>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Self-Hosted (Linux/Ubuntu)</h3>
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>Provision a server with Node.js 18.17+ and PostgreSQL 14+</li>
            <li>Clone the repository on the server</li>
            <li>Install dependencies with <code className="bg-secondary px-1 rounded text-xs">npm install</code></li>
            <li>Configure <code className="bg-secondary px-1 rounded text-xs">.env.local</code></li>
            <li>Build and start with <code className="bg-secondary px-1 rounded text-xs">npm run build && npm start</code></li>
            <li>Use PM2 or systemd to manage the process</li>
          </ol>
        </Card>
      </DocsSection>

      {/* Docker Setup */}
      <DocsSection id="docker" title="Docker Deployment">
        <p className="text-muted-foreground">Deploy {APP_NAME} using Docker in 5 minutes.</p>

        <DocsCallout variant="success" title="Prerequisites">
          <p>Docker and Docker Compose installed. Verify with:</p>
          <CodeBlock code="docker --version\ndocker compose version" language="bash" className="mt-2" />
        </DocsCallout>

        <div className="space-y-3">
          <Card className="p-6 border-border/40">
            <h3 className="font-semibold mb-4">Step 1: Create Project Directory</h3>
            <CodeBlock code="mkdir -p ~/vulnradar\ncd ~/vulnradar" language="bash" />
          </Card>

          <Card className="p-6 border-border/40">
            <h3 className="font-semibold mb-4">Step 2: Download docker-compose.yml</h3>
            <CodeBlock code={`curl -O https://raw.githubusercontent.com/${APP_REPO}/main/docker-compose.yml`} language="bash" />
          </Card>

          <Card className="p-6 border-border/40">
            <h3 className="font-semibold mb-4">Step 3: Create .env File</h3>
            <p className="text-sm text-muted-foreground mb-3">Create a <code className="bg-secondary px-1 rounded text-xs">.env</code> file:</p>
            <CodeBlock code={`# Required
DATABASE_URL=postgresql://vulnradar:your-strong-password@postgres:5432/vulnradar
NEXT_PUBLIC_APP_URL=https://yourdomain.com
API_KEY_ENCRYPTION_KEY=your-64-character-hex-key

# Docker-only
POSTGRES_DB=vulnradar
POSTGRES_USER=vulnradar
POSTGRES_PASSWORD=your-strong-password
APP_PORT=3000`} language="bash" />
          </Card>

          <Card className="p-6 border-border/40">
            <h3 className="font-semibold mb-4">Step 4: Build and Start</h3>
            <CodeBlock code="docker compose up -d" language="bash" />
            <p className="text-xs text-muted-foreground mt-2">Verify containers are running:</p>
            <CodeBlock code="docker ps" language="bash" className="mt-2" />
          </Card>

          <Card className="p-6 border-border/40">
            <h3 className="font-semibold mb-4">Step 5: Verify</h3>
            <CodeBlock code="docker logs -f vulnradar-app" language="bash" />
            <p className="text-xs text-muted-foreground mt-2">
              Wait for: <code className="bg-secondary px-1 rounded text-xs">ready - started server on</code>
            </p>
          </Card>
        </div>

        <DocsCallout variant="error" title="HTTPS Required">
          <p>
            {APP_NAME} requires HTTPS. Set up a reverse proxy (nginx, Traefik, or Caddy) for TLS termination.
          </p>
        </DocsCallout>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Common Operations</h3>
          <div className="space-y-4">
            {[
              { title: "View Live Logs", cmd: "docker logs -f vulnradar-app" },
              { title: "Stop All Containers", cmd: "docker compose down" },
              { title: "Full Reset", cmd: "docker compose down -v" },
              { title: "Update to Latest", cmd: "docker compose up -d --build" },
              { title: "Restart Application", cmd: "docker compose restart vulnradar-app" },
            ].map((item, i) => (
              <div key={i}>
                <h4 className="font-semibold text-sm mb-2">{item.title}</h4>
                <CodeBlock code={item.cmd} language="bash" />
              </div>
            ))}
          </div>
        </Card>
      </DocsSection>

      {/* Migration Tool */}
      <DocsSection id="migration" title="Migration Tool">
        <p className="text-muted-foreground">
          Keep your database schema in sync when updating {APP_NAME}.
        </p>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Running Migrations</h3>
          <p className="text-sm text-muted-foreground mb-3">After pulling a new version:</p>
          <CodeBlock code="npm run migrate" language="bash" />
          <p className="text-sm text-muted-foreground mt-4 mb-3">The tool will:</p>
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>Parse expected schema from <code className="bg-secondary px-1 rounded text-xs">instrumentation.ts</code></li>
            <li>Query your actual database tables</li>
            <li>Show comparison with color-coded status</li>
            <li>Offer to add missing columns interactively</li>
          </ol>
        </Card>

        <DocsCallout variant="warning" title="Important">
          <p>
            All destructive actions default to No and require explicit <code className="bg-secondary px-1 rounded">y</code> confirmation.
          </p>
        </DocsCallout>
      </DocsSection>

      {/* Version Checking */}
      <DocsSection id="version" title="Version Checking">
        <p className="text-muted-foreground">
          {APP_NAME} includes automatic version checking for self-hosted instances.
        </p>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Automatic Startup Check</h3>
          <p className="text-sm text-muted-foreground mb-3">On startup, the server logs:</p>
          <CodeBlock code={`[${APP_NAME}] Starting ${APP_NAME} v${APP_VERSION} (Detection Engine v${ENGINE_VERSION})
[${APP_NAME}] You're running the latest version (v${APP_VERSION}).`} language="text" />
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">API Version Endpoint</h3>
          <p className="text-sm text-muted-foreground mb-3">Check version programmatically:</p>
          <CodeBlock code={`curl ${APP_URL}/api/version`} language="bash" />
          <p className="text-sm text-muted-foreground mt-3 mb-3">Returns:</p>
          <CodeBlock code={`{
  "current": "${APP_VERSION}",
  "latest": "${APP_VERSION}",
  "engine": "${ENGINE_VERSION}",
  "status": "up-to-date"
}`} language="json" />
        </Card>
      </DocsSection>
    </div>
  )
}
