"use client"

import React, { useEffect, useRef } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CopyCodeBlock } from "@/components/copy-code-block"
import { AlertTriangle, CheckCircle, Info, Settings } from "lucide-react"
import { APP_NAME, APP_URL, APP_VERSION, ENGINE_VERSION, APP_REPO, APP_SLUG } from "@/lib/constants"
import { useDocsContext, type TocItem } from "../layout"

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

  // Set ToC items on mount
  useEffect(() => {
    setTocItems(tocItems)
    return () => setTocItems([])
  }, [setTocItems])

  // Intersection observer for active section tracking
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
      {/* Header */}
      <section id="overview" className="scroll-mt-24">
        <Badge variant="outline" className="mb-3 sm:mb-4 text-primary border-primary/30">Self-Hosting</Badge>
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight mb-3 sm:mb-4">Setup Guide</h1>
        <p className="text-base sm:text-lg text-muted-foreground leading-relaxed max-w-3xl">
          Complete guide to installing and configuring {APP_NAME} for your environment. Choose from local development, Docker, or cloud deployment.
        </p>

        {/* Quick Options */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4 mt-6 sm:mt-8">
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
      </section>

      {/* Prerequisites */}
      <section id="prerequisites" className="scroll-mt-24 space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Prerequisites</h2>
        <p className="text-muted-foreground">Before you begin, ensure you have the following installed on your system:</p>

        <Card className="p-6 border-border/40 space-y-3">
          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold mb-1">Node.js 18.17+</h4>
              <p className="text-sm text-muted-foreground">JavaScript runtime. Download from <a href="https://nodejs.org" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">nodejs.org</a></p>
              <CopyCodeBlock code="node --version  # Check version">node --version  # Check version</CopyCodeBlock>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold mb-1">npm 9+ or pnpm 8+</h4>
              <p className="text-sm text-muted-foreground">Node package manager (comes with Node.js). We recommend pnpm for faster installation.</p>
              <CopyCodeBlock code="npm --version  # or pnpm --version">npm --version  # or pnpm --version</CopyCodeBlock>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold mb-1">PostgreSQL 14+</h4>
              <p className="text-sm text-muted-foreground">Database server. Download from <a href="https://www.postgresql.org/download" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">postgresql.org</a></p>
              <CopyCodeBlock code="psql --version  # Check version">psql --version  # Check version</CopyCodeBlock>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold mb-1">Git 2.0+</h4>
              <p className="text-sm text-muted-foreground">Version control system. Download from <a href="https://git-scm.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">git-scm.com</a></p>
              <CopyCodeBlock code="git --version  # Check version">git --version  # Check version</CopyCodeBlock>
            </div>
          </div>
        </Card>
      </section>

      {/* Installation */}
      <section id="installation" className="scroll-mt-24 space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Installation Steps</h2>
        <p className="text-muted-foreground">Follow these steps to clone and prepare the repository:</p>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Step 1: Clone the Repository</h3>
          <p className="text-sm text-muted-foreground mb-3">Clone {APP_NAME} from GitHub:</p>
          <CopyCodeBlock code={`git clone https://github.com/${APP_REPO}.git
cd ${APP_SLUG}.dev`}>{`git clone https://github.com/${APP_REPO}.git
cd ${APP_SLUG}.dev`}</CopyCodeBlock>
          <p className="text-xs text-muted-foreground">This creates a directory called &quot;{APP_NAME}&quot; with the latest code from the main branch.</p>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Step 2: Install Dependencies</h3>
          <p className="text-sm text-muted-foreground mb-3">Install all required npm packages:</p>
          <CopyCodeBlock code="npm install">npm install</CopyCodeBlock>
          <p className="text-xs text-muted-foreground mb-3">Or if using pnpm:</p>
          <CopyCodeBlock code="pnpm install">pnpm install</CopyCodeBlock>
          <p className="text-xs text-muted-foreground">This may take 2-5 minutes depending on your internet connection and system performance.</p>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Step 3: Verify Installation</h3>
          <p className="text-sm text-muted-foreground mb-3">Check that all dependencies are installed correctly:</p>
          <CopyCodeBlock code={`npm list --depth=0
# or
pnpm list --depth=0`}>{`npm list --depth=0
# or
pnpm list --depth=0`}</CopyCodeBlock>
        </Card>
      </section>

      {/* Database Setup */}
      <section id="database" className="scroll-mt-24 space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Database Setup</h2>
        <p className="text-muted-foreground">Configure PostgreSQL for {APP_NAME}:</p>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Step 1: Create Database and User</h3>
          <p className="text-sm text-muted-foreground mb-3">Connect to PostgreSQL and create a new database:</p>
          <CopyCodeBlock code={`psql -U postgres

# Inside psql:
CREATE DATABASE vulnradar;
CREATE USER vulnradar_user WITH PASSWORD 'strong_password_here';
ALTER ROLE vulnradar_user SET client_encoding TO 'utf8';
ALTER ROLE vulnradar_user SET default_transaction_isolation TO 'read committed';
ALTER ROLE vulnradar_user SET default_transaction_deferrable TO on;
ALTER ROLE vulnradar_user SET default_transaction_deferrable TO off;
GRANT ALL PRIVILEGES ON DATABASE vulnradar TO vulnradar_user;
\\q`}>{`psql -U postgres

# Inside psql:
CREATE DATABASE vulnradar;
CREATE USER vulnradar_user WITH PASSWORD 'strong_password_here';
ALTER ROLE vulnradar_user SET client_encoding TO 'utf8';
ALTER ROLE vulnradar_user SET default_transaction_isolation TO 'read committed';
ALTER ROLE vulnradar_user SET default_transaction_deferrable TO on;
ALTER ROLE vulnradar_user SET default_transaction_deferrable TO off;
GRANT ALL PRIVILEGES ON DATABASE vulnradar TO vulnradar_user;
\\q`}</CopyCodeBlock>
          <p className="text-xs text-muted-foreground">Replace 'strong_password_here' with a secure password of at least 12 characters.</p>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Step 2: Test Database Connection</h3>
          <p className="text-sm text-muted-foreground mb-3">Verify the connection with your credentials:</p>
          <CopyCodeBlock code={`psql -U vulnradar_user -d vulnradar -h localhost
# Type your password when prompted
\\dt  # Lists all tables
\\q  # Exit psql`}>{`psql -U vulnradar_user -d vulnradar -h localhost
# Type your password when prompted
\\dt  # Lists all tables
\\q  # Exit psql`}</CopyCodeBlock>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Step 3: Auto-Schema Setup</h3>
          <p className="text-sm text-muted-foreground mb-3">{APP_NAME} automatically creates all required tables and indexes when the application starts for the first time. Simply start the dev server:</p>
          <CopyCodeBlock code="npm run dev">npm run dev</CopyCodeBlock>
          <p className="text-xs text-muted-foreground mt-2">The <code className="bg-secondary px-1 rounded text-xs">instrumentation.ts</code> file handles all schema creation on startup. No separate migration command is needed for initial setup.</p>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Step 4: Run Migration Check (Optional)</h3>
          <p className="text-sm text-muted-foreground mb-3">After the app has started at least once, you can verify your database schema matches the expected schema:</p>
          <CopyCodeBlock code="npm run migrate">npm run migrate</CopyCodeBlock>
          <p className="text-xs text-muted-foreground mt-2">This interactive tool compares your database against the expected schema defined in <code className="bg-secondary px-1 rounded text-xs">instrumentation.ts</code>. It will report missing tables, missing columns, and extra columns or tables. You can selectively add missing columns or drop extra ones with confirmation prompts. All destructive actions default to No and require explicit <code className="bg-secondary px-1 rounded text-xs">y</code> confirmation.</p>
        </Card>
      </section>

      {/* Environment Configuration */}
      <section id="environment" className="scroll-mt-24 space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Environment Configuration</h2>
        <p className="text-muted-foreground">Configure environment variables for your {APP_NAME} installation:</p>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Create .env.local File</h3>
          <p className="text-sm text-muted-foreground mb-3">Create a <code className="bg-secondary px-2 py-1 rounded text-xs">.env.local</code> file in the project root with the following environment variables:</p>
          <pre className="bg-secondary/50 p-4 rounded text-sm overflow-x-auto mb-4"><code>{`# Database
DATABASE_URL=postgresql://vulnradar:yourpassword@localhost:5432/vulnradar
DATABASE_SSL=false

# SMTP - No-Reply (password resets, team invites, scan alerts)
SMTP_HOST=smtp.protonmail.ch
SMTP_PORT=587
SMTP_USER=noreply@yourdomain.com
SMTP_PASS=your-smtp-password
SMTP_FROM=noreply@yourdomain.com

# Contact Form
CONTACT_EMAIL=support@yourdomain.com

# Turnstile (Cloudflare CAPTCHA)
TURNSTILE_SITE_KEY=your-turnstile-site-key
TURNSTILE_SECRET_KEY=your-turnstile-secret-key`}</code></pre>

          <div className="space-y-4 mt-4">
            <div>
              <h4 className="font-semibold text-sm mb-2">Database Configuration</h4>
              <div className="space-y-2 text-xs text-muted-foreground">
                <p><code className="bg-secondary px-1 rounded">DATABASE_URL</code> - PostgreSQL connection string. Replace <code className="bg-secondary px-1 rounded">yourpassword</code> with your actual PostgreSQL password.</p>
                <p><code className="bg-secondary px-1 rounded">DATABASE_SSL</code> - Set to <code className="bg-secondary px-1 rounded">true</code> for production environments with SSL.</p>
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">SMTP Configuration (Email)</h4>
              <div className="space-y-2 text-xs text-muted-foreground">
                <p><code className="bg-secondary px-1 rounded">SMTP_HOST</code> - Your SMTP server host (e.g., smtp.protonmail.ch for ProtonMail)</p>
                <p><code className="bg-secondary px-1 rounded">SMTP_PORT</code> - SMTP port (typically 587 for TLS or 465 for SSL)</p>
                <p><code className="bg-secondary px-1 rounded">SMTP_USER</code> - Email address for no-reply emails</p>
                <p><code className="bg-secondary px-1 rounded">SMTP_PASS</code> - SMTP password or app-specific password</p>
                <p><code className="bg-secondary px-1 rounded">SMTP_FROM</code> - Sender email address</p>
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">Contact & Support</h4>
              <div className="space-y-2 text-xs text-muted-foreground">
                <p><code className="bg-secondary px-1 rounded">CONTACT_EMAIL</code> - Email address for contact form submissions</p>
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">Security (Turnstile CAPTCHA)</h4>
              <div className="space-y-2 text-xs text-muted-foreground">
                <p><code className="bg-secondary px-1 rounded">TURNSTILE_SITE_KEY</code> - Get from <a href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Cloudflare Dashboard</a></p>
                <p><code className="bg-secondary px-1 rounded">TURNSTILE_SECRET_KEY</code> - Keep secret, never expose to frontend</p>
              </div>
            </div>
          </div>
        </Card>

        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 flex gap-3">
          <Info className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-foreground mb-1 text-sm">Environment File Security</h3>
            <p className="text-xs text-muted-foreground">Never commit <code className="bg-secondary px-1 rounded">.env.local</code> to version control. It contains sensitive credentials. Add it to <code className="bg-secondary px-1 rounded">.gitignore</code>:</p>
            <CopyCodeBlock code={`echo ".env.local" >> .gitignore`}>{`echo ".env.local" >> .gitignore`}</CopyCodeBlock>
          </div>
        </div>
      </section>

      {/* Application Configuration */}
      <section id="config" className="scroll-mt-24 space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Application Configuration</h2>
        <p className="text-muted-foreground">Customize {APP_NAME} by editing <code className="bg-secondary px-2 py-1 rounded text-xs">config.yaml</code> in the project root:</p>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">config.yaml Overview</h3>
          <p className="text-sm text-muted-foreground mb-3">The <code className="bg-secondary px-1 rounded text-xs">config.yaml</code> file is the single source of truth for all application metadata. No environment variables are needed for these settings.</p>
          <pre className="bg-secondary/50 p-4 rounded text-sm overflow-x-auto mb-4"><code>{`app:
  name: "VulnRadar"           # Application name shown in UI
  slug: "vulnradar"           # URL-safe identifier
  version: "2.0.1"            # Application version
  engine_version: "2.0.1"     # Detection engine version
  description: "..."          # Meta description for SEO
  total_checks_label: "310+"  # Number of security checks
  url: "https://vulnradar.dev"
  repo: "VulnRadar/vulnradar.dev"
  
  # Contact emails
  support_email: "support@yourdomain.com"
  legal_email: "legal@yourdomain.com"
  security_email: "security@yourdomain.com"
  enterprise_email: "enterprise@yourdomain.com"
  noreply_email: "noreply@yourdomain.com"

billing:
  enabled: false              # Enable/disable Stripe billing

features:
  discord_oauth: true         # Enable Discord sign-in
  turnstile: true             # Enable Cloudflare Turnstile`}</code></pre>

          <div className="space-y-4 mt-4">
            <div>
              <h4 className="font-semibold text-sm mb-2">Key Sections</h4>
              <div className="space-y-2 text-xs text-muted-foreground">
                <p><code className="bg-secondary px-1 rounded">app</code> - Application metadata, branding, version info, and contact emails</p>
                <p><code className="bg-secondary px-1 rounded">billing</code> - Enable or disable Stripe billing integration</p>
                <p><code className="bg-secondary px-1 rounded">features</code> - Toggle features like Discord OAuth and Turnstile CAPTCHA</p>
              </div>
            </div>
          </div>
        </Card>

        <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4 flex gap-3">
          <Settings className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-foreground mb-1 text-sm">No Environment Variables Needed</h3>
            <p className="text-xs text-muted-foreground">Unlike typical Next.js apps, {APP_NAME} reads app metadata from <code className="bg-secondary px-1 rounded">config.yaml</code> instead of <code className="bg-secondary px-1 rounded">NEXT_PUBLIC_*</code> environment variables. This makes configuration simpler and keeps all settings in one place.</p>
          </div>
        </div>
      </section>

      {/* Running the Application */}
      <section id="running" className="scroll-mt-24 space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Running the Application</h2>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Development Server</h3>
          <p className="text-sm text-muted-foreground mb-3">Start the development server with hot reload:</p>
          <CopyCodeBlock code={`npm run dev
# or
pnpm dev`}>{`npm run dev
# or
pnpm dev`}</CopyCodeBlock>
          <p className="text-xs text-muted-foreground">The application will be available at <a href="http://localhost:3000" className="text-primary hover:underline">http://localhost:3000</a>. Changes to files will automatically reload the browser.</p>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Production Build</h3>
          <p className="text-sm text-muted-foreground mb-3">Build and run for production:</p>
          <CopyCodeBlock code={`npm run build
npm start
# or
pnpm build
pnpm start`}>{`npm run build
npm start
# or
pnpm build
pnpm start`}</CopyCodeBlock>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Run on Different Port</h3>
          <p className="text-sm text-muted-foreground mb-3">If port 3000 is already in use:</p>
          <CopyCodeBlock code={`npm run dev -- -p 3001
# or
pnpm dev -- -p 3001`}>{`npm run dev -- -p 3001
# or
pnpm dev -- -p 3001`}</CopyCodeBlock>
        </Card>
      </section>

      {/* Verification */}
      <section id="verification" className="scroll-mt-24 space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Verification Steps</h2>
        <p className="text-muted-foreground">Verify that {APP_NAME} is running correctly:</p>

        <Card className="p-6 border-border/40 space-y-4">
          <div>
            <h3 className="font-semibold mb-2">1. Access the Application</h3>
            <p className="text-sm text-muted-foreground">Open your browser and navigate to <a href="http://localhost:3000" className="text-primary hover:underline">http://localhost:3000</a></p>
            <p className="text-xs text-muted-foreground mt-2">You should see the {APP_NAME} landing page with login and signup options.</p>
          </div>

          <div>
            <h3 className="font-semibold mb-2">2. Create a Test Account</h3>
            <p className="text-sm text-muted-foreground">Click "Sign Up" and create a test account with a valid email address</p>
            <p className="text-xs text-muted-foreground mt-2">Password must be at least 8 characters. You'll be logged in automatically after signup.</p>
          </div>

          <div>
            <h3 className="font-semibold mb-2">3. Check Database Connection</h3>
            <p className="text-sm text-muted-foreground">Verify user data was created in the database:</p>
            <CopyCodeBlock code={`psql -U vulnradar_user -d vulnradar -h localhost
SELECT id, email, name FROM users LIMIT 5;
\\q`}>{`psql -U vulnradar_user -d vulnradar -h localhost
SELECT id, email, name FROM users LIMIT 5;
\\q`}</CopyCodeBlock>
          </div>

          <div>
            <h3 className="font-semibold mb-2">4. Generate an API Key</h3>
            <p className="text-sm text-muted-foreground">From the dashboard, navigate to Account Settings → API Keys and create a new key</p>
            <p className="text-xs text-muted-foreground mt-2">This verifies that the application is fully functional and can interact with the database.</p>
          </div>
        </Card>
      </section>

      {/* Troubleshooting */}
      <section id="troubleshooting" className="scroll-mt-24 space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Troubleshooting</h2>

        <Card className="p-6 border-border/40 space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <h3 className="font-semibold">Database Connection Error</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-2">Error: "connect ECONNREFUSED 127.0.0.1:5432"</p>
            <p className="text-sm text-muted-foreground mb-2">Solutions:</p>
            <CopyCodeBlock code={`# Check if PostgreSQL is running
sudo systemctl status postgresql  # Linux
brew services list  # macOS

# Start PostgreSQL if not running
sudo systemctl start postgresql  # Linux
brew services start postgresql  # macOS

# Verify connection string in .env.local
psql -U vulnradar_user -d vulnradar -h localhost`}>{`# Check if PostgreSQL is running
sudo systemctl status postgresql  # Linux
brew services list  # macOS

# Start PostgreSQL if not running
sudo systemctl start postgresql  # Linux
brew services start postgresql  # macOS

# Verify connection string in .env.local
psql -U vulnradar_user -d vulnradar -h localhost`}</CopyCodeBlock>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <h3 className="font-semibold">Port Already in Use</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-2">Error: "EADDRINUSE: address already in use :::3000"</p>
            <p className="text-sm text-muted-foreground mb-2">Solutions:</p>
            <CopyCodeBlock code={`# Find what's using port 3000
lsof -i :3000  # macOS/Linux
netstat -ano | findstr :3000  # Windows

# Kill the process or use different port
npm run dev -- -p 3001`}>{`# Find what's using port 3000
lsof -i :3000  # macOS/Linux
netstat -ano | findstr :3000  # Windows

# Kill the process or use different port
npm run dev -- -p 3001`}</CopyCodeBlock>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <h3 className="font-semibold">Module Not Found Errors</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-2">Error: "Cannot find module 'next'"</p>
            <p className="text-sm text-muted-foreground mb-2">Solutions:</p>
            <pre className="bg-secondary/50 p-2 rounded text-xs overflow-x-auto"><code>{`# Clear and reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Or with pnpm
rm -rf node_modules pnpm-lock.yaml
pnpm install`}</code></pre>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <h3 className="font-semibold">Environment Variables Not Loading</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-2">Verify <code className="bg-secondary px-1 rounded text-xs">.env.local</code> exists in the project root and restart the dev server after making changes</p>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <h3 className="font-semibold">Build Errors</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-2">If <code className="bg-secondary px-1 rounded text-xs">npm run build</code> fails, try:</p>
            <pre className="bg-secondary/50 p-2 rounded text-xs overflow-x-auto"><code>{`npm run clean  # Clear build cache
npm run build
npm start`}</code></pre>
          </div>
        </Card>
      </section>

      {/* Deployment */}
      <section id="deployment" className="scroll-mt-24 space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Deployment Options</h2>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Vercel (Recommended)</h3>
          <p className="text-sm text-muted-foreground mb-3">{APP_NAME} is optimized for Vercel deployment:</p>
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>Push your code to GitHub</li>
            <li>Connect your repository to Vercel</li>
            <li>Add environment variables in Vercel settings</li>
            <li>Deploy with a single click</li>
          </ol>
          <p className="text-xs text-muted-foreground mt-3">For detailed instructions, visit <a href="https://vercel.com/docs" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Vercel Documentation</a></p>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Docker</h3>
          <p className="text-sm text-muted-foreground">Deploy using Docker and Docker Compose. See the <a href="#docker" className="text-primary hover:underline">Docker Deployment</a> section below for a complete walkthrough.</p>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Self-Hosted (Linux/Ubuntu)</h3>
          <p className="text-sm text-muted-foreground mb-3">Deploy to your own server:</p>
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>Provision a server with Node.js 18.17+ and PostgreSQL 14+</li>
            <li>Clone the repository on the server</li>
            <li>Install dependencies with <code className="bg-secondary px-1 rounded text-xs">npm install</code></li>
            <li>Configure environment variables in <code className="bg-secondary px-1 rounded text-xs">.env.local</code></li>
            <li>Start the app once to auto-create the database schema</li>
            <li>Run <code className="bg-secondary px-1 rounded text-xs">npm run migrate</code> to verify schema</li>
            <li>Build for production with <code className="bg-secondary px-1 rounded text-xs">npm run build && npm start</code></li>
            <li>Use PM2 or systemd to manage the process</li>
          </ol>
          <p className="text-xs text-muted-foreground mt-3">On startup, the server console logs the current version and checks for updates automatically. The admin panel also shows a version check card if a newer version is available on GitHub.</p>
        </Card>
      </section>

      {/* Docker Setup - REWRITTEN */}
      <section id="docker" className="scroll-mt-24 space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Docker Deployment</h2>
        <p className="text-muted-foreground">Deploy {APP_NAME} using Docker in 5 minutes. No cloning, no build step—just pull the pre-built image and go.</p>

        <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4 flex gap-3">
          <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-foreground mb-1 text-sm">Prerequisites</h3>
            <p className="text-xs text-muted-foreground">Docker and Docker Compose installed. Verify with:</p>
            <CopyCodeBlock code={`docker --version
docker compose version`}>{`docker --version
docker compose version`}</CopyCodeBlock>
          </div>
        </div>

        {/* Step-by-step deployment */}
        <div className="space-y-3">
          <Card className="p-6 border-border/40">
            <h3 className="font-semibold mb-4">Step 1: Create Project Directory</h3>
            <CopyCodeBlock code={`mkdir -p ~/vulnradar
cd ~/vulnradar`}>{`mkdir -p ~/vulnradar
cd ~/vulnradar`}</CopyCodeBlock>
          </Card>

          <Card className="p-6 border-border/40">
            <h3 className="font-semibold mb-4">Step 2: Download docker-compose.yml</h3>
            <CopyCodeBlock code={`curl -O https://raw.githubusercontent.com/${APP_REPO}/main/docker-compose.yml`}>{`curl -O https://raw.githubusercontent.com/${APP_REPO}/main/docker-compose.yml`}</CopyCodeBlock>
            <p className="text-xs text-muted-foreground">Verify it downloaded:</p>
            <CopyCodeBlock code="ls">ls</CopyCodeBlock>
            <p className="text-xs text-muted-foreground mt-2">You should see <code className="bg-secondary px-1 rounded">docker-compose.yml</code> in the current directory.</p>
          </Card>

          <Card className="p-6 border-border/40">
            <h3 className="font-semibold mb-4">Step 3: Create .env File</h3>
            <p className="text-sm text-muted-foreground mb-3">Create a <code className="bg-secondary px-1 rounded text-xs">.env</code> file with required environment variables:</p>
            <CopyCodeBlock code="nano .env">nano .env</CopyCodeBlock>

            <p className="text-sm text-muted-foreground mb-3">Paste the full configuration (edit values as needed):</p>
            <CopyCodeBlock code={`# ─────────────────────────────────────────────────────────────────────────
# DATABASE (Server-side - Required)
# ─────────────────────────────────────────────────────────────────────────
# Format: postgresql://[user]:[password]@[host]:[port]/[database]
DATABASE_URL=postgresql://vulnradar:your-strong-password@postgres:5432/vulnradar
DATABASE_SSL=false

# ─────────────────────────────────────────────────────────────────────────
# APPLICATION (Client-side - NEXT_PUBLIC_* - Required)
# ─────────────────────────────────────────────────────────────────────────
# Public URL where your app is accessible. Used in emails, redirects, and client-side code.
NEXT_PUBLIC_APP_URL=https://yourdomain.com

# ─────────────────────────────────────────────────────────────────────────
# API KEY ENCRYPTION (Server-side - Required for enhanced security)
# ─────────────────────────────────────────────────────────────────────────
# 32-byte hex string for AES-256 encryption of stored API keys.
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
API_KEY_ENCRYPTION_KEY=your-64-character-hex-key

# ─────────────────────────────────────────────────────────────────────────
# SMTP EMAIL CONFIGURATION (Server-side - Optional)
# ─────────────────────────────────────────────────────────────────────────
# Used for sending transactional emails (password resets, notifications, etc.)
SMTP_HOST=smtp.protonmail.ch
SMTP_PORT=587
SMTP_USER=noreply@yourdomain.com
SMTP_PASS=your-app-specific-password
SMTP_FROM=noreply@yourdomain.com

# ─────────────────────────────────────────────────────────────────────────
# CONTACT & SUPPORT (Server-side - Optional)
# ─────────────────────────────────────────────────────────────────────────
# Email addresses for contact form submissions and support inquiries
CONTACT_EMAIL=support@yourdomain.com

# ─────────────────────────────────────────────────────────────────────────
# STRIPE BILLING (Server-side - Optional, only if billing.enabled=true in config.yaml)
# ─────────────────────────────────────────────────────────────────────────
# Get these from: https://dashboard.stripe.com/apikeys
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Client-side publishable key (same value as STRIPE_PUBLISHABLE_KEY)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Webhook signing secret
# OPTION 1 (Automatic): Call GET /api/v2/stripe/setup-webhook after starting the server
#   - This will auto-create the webhook in Stripe and return the secret
#   - Copy the returned webhookSecret value here
# OPTION 2 (Manual): Create at https://dashboard.stripe.com/webhooks
#   - Endpoint URL: https://yourdomain.com/api/v2/webhooks/stripe
#   - Events: checkout.session.completed, customer.subscription.created,
#             customer.subscription.updated, customer.subscription.deleted,
#             invoice.payment_succeeded, invoice.payment_failed
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxx

# ─────────────────────────────────────────────────────────────────────────
# DISCORD OAUTH (Server-side - Optional, for "Sign in with Discord")
# ─────────────────────────────────────────────────────────────────────────
# Get these from: https://discord.com/developers/applications
# OAuth2 Redirect URL to add in Discord Developer Portal:
#   https://yourdomain.com/api/v2/auth/discord/callback
#   (or for local dev: http://localhost:3000/api/v2/auth/discord/callback)
DISCORD_CLIENT_ID=your-discord-client-id
DISCORD_CLIENT_SECRET=your-discord-client-secret

# Bot token (for auto-joining users to your server)
# Required scopes: guilds.join, identify, email
DISCORD_BOT_TOKEN=your-discord-bot-token

# Your Discord server ID (for auto-join feature)
DISCORD_GUILD_ID=your-discord-guild-id

# ═══════════════════════════════════════════════════════════════════════
# DOCKER-ONLY VARIABLES (Only for docker-compose.yml)
# These are NOT needed for direct deployments or Vercel
# ═══════════════════════════════════════════════════════════════════════
POSTGRES_DB=vulnradar
POSTGRES_USER=vulnradar
POSTGRES_PASSWORD=your-strong-password-here
APP_PORT=3000
DB_PORT=5432`}>{`# ─────────────────────────────────────────────────────────────────────────
# DATABASE (Server-side - Required)
# ─────────────────────────────────────────────────────────────────────────
# Format: postgresql://[user]:[password]@[host]:[port]/[database]
DATABASE_URL=postgresql://vulnradar:your-strong-password@postgres:5432/vulnradar
DATABASE_SSL=false

# ─────────────────────────────────────────────────────────────────────────
# APPLICATION (Client-side - NEXT_PUBLIC_* - Required)
# ─────────────────────────────────────────────────────────────────────────
# Public URL where your app is accessible. Used in emails, redirects, and client-side code.
NEXT_PUBLIC_APP_URL=https://yourdomain.com

# ─────────────────────────────────────────────────────────────────────────
# API KEY ENCRYPTION (Server-side - Required for enhanced security)
# ─────────────────────────────────────────────────────────────────────────
# 32-byte hex string for AES-256 encryption of stored API keys.
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
API_KEY_ENCRYPTION_KEY=your-64-character-hex-key

# ─────────────────────────────────────────────────────────────────────────
# SMTP EMAIL CONFIGURATION (Server-side - Optional)
# ─────────────────────────────────────────────────────────────────────────
# Used for sending transactional emails (password resets, notifications, etc.)
SMTP_HOST=smtp.protonmail.ch
SMTP_PORT=587
SMTP_USER=noreply@yourdomain.com
SMTP_PASS=your-app-specific-password
SMTP_FROM=noreply@yourdomain.com

# ─────────────────────────────────────────────────────────────────────────
# CONTACT & SUPPORT (Server-side - Optional)
# ─────────────────────────────────────────────────────────────────────────
# Email addresses for contact form submissions and support inquiries
CONTACT_EMAIL=support@yourdomain.com

# ─────────────────────────────────────────────────────────────────────────
# STRIPE BILLING (Server-side - Optional, only if billing.enabled=true in config.yaml)
# ─────────────────────────────────────────────────────────────────────────
# Get these from: https://dashboard.stripe.com/apikeys
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Client-side publishable key (same value as STRIPE_PUBLISHABLE_KEY)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Webhook signing secret
# OPTION 1 (Automatic): Call GET /api/v2/stripe/setup-webhook after starting the server
#   - This will auto-create the webhook in Stripe and return the secret
#   - Copy the returned webhookSecret value here
# OPTION 2 (Manual): Create at https://dashboard.stripe.com/webhooks
#   - Endpoint URL: https://yourdomain.com/api/v2/webhooks/stripe
#   - Events: checkout.session.completed, customer.subscription.created,
#             customer.subscription.updated, customer.subscription.deleted,
#             invoice.payment_succeeded, invoice.payment_failed
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxx

# ─────────────────────────────────────────────────────────────────────────
# DISCORD OAUTH (Server-side - Optional, for "Sign in with Discord")
# ─────────────────────────────────────────────────────────────────────────
# Get these from: https://discord.com/developers/applications
# OAuth2 Redirect URL to add in Discord Developer Portal:
#   https://yourdomain.com/api/v2/auth/discord/callback
#   (or for local dev: http://localhost:3000/api/v2/auth/discord/callback)
DISCORD_CLIENT_ID=your-discord-client-id
DISCORD_CLIENT_SECRET=your-discord-client-secret

# Bot token (for auto-joining users to your server)
# Required scopes: guilds.join, identify, email
DISCORD_BOT_TOKEN=your-discord-bot-token

# Your Discord server ID (for auto-join feature)
DISCORD_GUILD_ID=your-discord-guild-id

# ═══════════════════════════════════════════════════════════════════════
# DOCKER-ONLY VARIABLES (Only for docker-compose.yml)
# These are NOT needed for direct deployments or Vercel
# ═══════════════════════════════════════════════════════════════════════
POSTGRES_DB=vulnradar
POSTGRES_USER=vulnradar
POSTGRES_PASSWORD=your-strong-password-here
APP_PORT=3000
DB_PORT=5432`}</CopyCodeBlock>


            <p className="text-sm text-muted-foreground mb-3">Generate a secure encryption key (copy the output and paste into .env):</p>
            <CopyCodeBlock code={`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`}>{`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`}</CopyCodeBlock>

            <p className="text-xs text-muted-foreground mt-3">Save and exit nano with <code className="bg-secondary px-1 rounded">Ctrl+O</code>, <code className="bg-secondary px-1 rounded">Enter</code>, <code className="bg-secondary px-1 rounded">Ctrl+X</code></p>
          </Card>

          <Card className="p-6 border-border/40">
            <h3 className="font-semibold mb-4">Step 4: Build and Start the Application</h3>
            <p className="text-sm text-muted-foreground mb-3">Build from source with your environment variables embedded:</p>
            <CopyCodeBlock code="docker compose up -d">docker compose up -d</CopyCodeBlock>
            <p className="text-xs text-muted-foreground mt-3">The app builds from source with your .env values, then starts in the background. This starts both PostgreSQL and the {APP_NAME} app.</p>

            <p className="text-sm text-muted-foreground mb-3 mt-4">Verify containers are running:</p>
            <CopyCodeBlock code="docker ps">docker ps</CopyCodeBlock>
            <p className="text-xs text-muted-foreground mt-2">You should see two containers: <code className="bg-secondary px-1 rounded">vulnradar-db</code> and <code className="bg-secondary px-1 rounded">vulnradar-app</code></p>
          </Card>

          <Card className="p-6 border-border/40">
            <h3 className="font-semibold mb-4">Step 5: Verify Everything Works</h3>
            <p className="text-sm text-muted-foreground mb-3">Check the application logs:</p>
            <CopyCodeBlock code="docker logs -f vulnradar-app">docker logs -f vulnradar-app</CopyCodeBlock>
            <p className="text-xs text-muted-foreground mb-3">Wait for the message: <code className="bg-secondary px-1 rounded text-xs">ready - started server on</code></p>

            <p className="text-sm text-muted-foreground mb-3">Then access your application at:</p>
            <CopyCodeBlock code="https://yourdomain.com">https://yourdomain.com</CopyCodeBlock>

            <p className="text-xs text-muted-foreground mt-3">Exit logs with <code className="bg-secondary px-1 rounded">Ctrl+C</code></p>
          </Card>
        </div>

        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex gap-3">
          <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-foreground mb-1 text-sm">HTTPS Required</h3>
            <p className="text-xs text-muted-foreground mb-2">
              {APP_NAME} <strong>requires HTTPS and a proper domain</strong>. CSS, authentication, and security headers all depend on it.
            </p>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>Set up a reverse proxy (nginx, Traefik, or Caddy) for HTTPS/TLS termination</li>
              <li>Point your domain to your server</li>
              <li>Set <code className="bg-secondary px-1 rounded">NEXT_PUBLIC_APP_URL=https://yourdomain.com</code> in .env</li>
            </ul>
          </div>
        </div>

        {/* Common operations */}
        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Common Operations</h3>

          <div className="space-y-4">
            <div>
              <h4 className="font-semibold text-sm mb-2">View Live Logs</h4>
              <CopyCodeBlock code="docker logs -f vulnradar-app">docker logs -f vulnradar-app</CopyCodeBlock>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">Stop All Containers</h4>
              <CopyCodeBlock code="docker compose down">docker compose down</CopyCodeBlock>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">Full Reset (Delete Everything Including Database)</h4>
              <CopyCodeBlock code="docker compose down -v">docker compose down -v</CopyCodeBlock>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">Update to Latest Version</h4>
              <CopyCodeBlock code={`docker compose up -d --build`}>{`docker compose up -d --build`}</CopyCodeBlock>
              <p className="text-xs text-muted-foreground mt-2">This rebuilds the app image with latest source and restarts. Database schema updates automatically on startup.</p>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">Restart Application</h4>
              <CopyCodeBlock code="docker compose restart vulnradar-app">docker compose restart vulnradar-app</CopyCodeBlock>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">Check Container Health</h4>
              <CopyCodeBlock code={`docker ps --format "table {{.Names }}\t{{.Status }}"`}>{`docker ps --format "table {{.Names }}\t{{.Status }}"`}</CopyCodeBlock>
            </div>
          </div>
        </Card>

        {/* Troubleshooting */}
        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Troubleshooting</h3>

          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <h4 className="font-semibold text-sm">App won't start or keeps restarting</h4>
              </div>
              <CopyCodeBlock code="docker logs vulnradar-app">docker logs vulnradar-app</CopyCodeBlock>
              <p className="text-xs text-muted-foreground">Check the logs for error messages. Common issues:</p>
              <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside mt-1">
                <li>Missing or incorrect environment variables in .env</li>
                <li>Database not ready yet (wait 10-15 seconds and check again)</li>
                <li>Port 3000 already in use on host</li>
              </ul>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <h4 className="font-semibold text-sm">Database connection errors</h4>
              </div>
              <p className="text-xs text-muted-foreground mb-2">Wait for PostgreSQL to fully initialize (usually 10-15 seconds after <code className="bg-secondary px-1 rounded">docker compose up -d</code>):</p>
              <CopyCodeBlock code="docker logs vulnradar-db">docker logs vulnradar-db</CopyCodeBlock>
              <p className="text-xs text-muted-foreground">Look for <code className="bg-secondary px-1 rounded text-xs">database system is ready to accept connections</code></p>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <h4 className="font-semibold text-sm">Can't access app after startup</h4>
              </div>
              <p className="text-xs text-muted-foreground mb-2">Verify containers are healthy:</p>
              <CopyCodeBlock code="docker compose ps">docker compose ps</CopyCodeBlock>
              <p className="text-xs text-muted-foreground mt-2">If status shows unhealthy, check both logs:</p>
              <CopyCodeBlock code={`docker logs vulnradar-app
docker logs vulnradar-db`}>{`docker logs vulnradar-app
docker logs vulnradar-db`}</CopyCodeBlock>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <h4 className="font-semibold text-sm">HTTPS/SSL certificate issues</h4>
              </div>
              <p className="text-xs text-muted-foreground">Make sure your reverse proxy (nginx, Traefik, Caddy) is properly configured for TLS termination before the traffic reaches the app container.</p>
            </div>
          </div>
        </Card>

        {/* Advanced: Use existing database */}
        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Advanced: Use Existing PostgreSQL</h3>
          <p className="text-sm text-muted-foreground mb-3">If you already have a PostgreSQL server, run just the app container:</p>
          <pre className="bg-secondary/50 p-4 rounded text-sm overflow-x-auto mb-4"><code>{`docker run -d \\
  --name vulnradar \\
  -p 3000:3000 \\
  -e DATABASE_URL="postgresql://user:password@your-db-host:5432/vulnradar" \\
  -e NEXT_PUBLIC_APP_URL="https://yourdomain.com" \\
  -e API_KEY_ENCRYPTION_KEY="your-64-char-hex-key" \\
  --restart unless-stopped \\
  ghcr.io/vulnradar/vulnradar:latest`}</code></pre>
          <p className="text-xs text-muted-foreground">Replace the DATABASE_URL with your actual connection string and encryption key.</p>
        </Card>

        {/* Environment variables reference */}
        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Environment Variables Quick Reference</h3>
          <div className="space-y-4 text-xs">
            <div>
              <h4 className="font-semibold text-sm mb-2">Required</h4>
              <div className="space-y-1 text-muted-foreground">
                <p><code className="bg-secondary px-1 rounded">DATABASE_URL</code> - PostgreSQL connection string</p>
                <p><code className="bg-secondary px-1 rounded">NEXT_PUBLIC_APP_URL</code> - Public URL of your deployment</p>
                <p><code className="bg-secondary px-1 rounded">API_KEY_ENCRYPTION_KEY</code> - 64-char hex key for encryption</p>
              </div>
            </div>
            <div>
              <h4 className="font-semibold text-sm mb-2">Docker-Only</h4>
              <div className="space-y-1 text-muted-foreground">
                <p><code className="bg-secondary px-1 rounded">POSTGRES_PASSWORD</code> - Database password</p>
                <p><code className="bg-secondary px-1 rounded">POSTGRES_DB</code> - Database name (default: vulnradar)</p>
                <p><code className="bg-secondary px-1 rounded">POSTGRES_USER</code> - Database user (default: vulnradar)</p>
                <p><code className="bg-secondary px-1 rounded">APP_PORT</code> - App port (default: 3000)</p>
              </div>
            </div>
            <div>
              <h4 className="font-semibold text-sm mb-2">Optional Integrations</h4>
              <div className="space-y-1 text-muted-foreground">
                <p><code className="bg-secondary px-1 rounded">SMTP_*</code> - Email sending (HOST, PORT, USER, PASS, FROM)</p>
                <p><code className="bg-secondary px-1 rounded">STRIPE_*</code> - Billing (SECRET_KEY, PUBLISHABLE_KEY, WEBHOOK_SECRET)</p>
                <p><code className="bg-secondary px-1 rounded">DISCORD_*</code> - OAuth (CLIENT_ID, CLIENT_SECRET, BOT_TOKEN, GUILD_ID)</p>
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-4">See the full .env file above for complete documentation and setup instructions.</p>
        </Card>
      </section>

      {/* Migration Tool */}
      <section id="migration" className="scroll-mt-24 space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Migration Tool</h2>
        <p className="text-muted-foreground">The built-in migration tool helps keep your database schema in sync when updating {APP_NAME} to a new version.</p>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Running Migrations</h3>
          <p className="text-sm text-muted-foreground mb-3">After pulling a new version, run the migration check:</p>
          <pre className="bg-secondary/50 p-4 rounded text-sm overflow-x-auto mb-4"><code>npm run migrate</code></pre>
          <p className="text-sm text-muted-foreground mb-3">The tool will:</p>
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground mb-4">
            <li>Parse the expected schema from <code className="bg-secondary px-1 rounded text-xs">instrumentation.ts</code></li>
            <li>Query your actual database tables and columns</li>
            <li>Show a comparison with color-coded status (OK, MISSING, EXTRA)</li>
            <li>Offer to add missing columns interactively</li>
            <li>Offer to drop extra columns or tables with double confirmation</li>
          </ol>
          <pre className="bg-secondary/50 p-4 rounded text-xs overflow-x-auto mb-4"><code>{`# Example output:
  OK             users (8 columns)
  MISSING COL    scan_history.new_column
  EXTRA COL      scan_history.old_column (127 rows have data)
  EXTRA TABLE    custom_table (3 columns)`}</code></pre>

          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 flex gap-3 mt-4">
            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-muted-foreground">
              <p><strong>Important:</strong> All destructive actions (dropping columns or tables) default to No and require you to explicitly type <code className="bg-secondary px-1 rounded">y</code>. The tool will warn you about data loss before any deletion.</p>
            </div>
          </div>

          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 flex gap-3 mt-4">
            <Info className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-muted-foreground">
              <p><strong>Recommendation:</strong> We recommend using a dedicated database for {APP_NAME} rather than sharing it with other applications. This ensures migrations can be applied cleanly without conflicting with other schemas.</p>
            </div>
          </div>
        </Card>
      </section>

      {/* Version Checking */}
      <section id="version" className="scroll-mt-24 space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Version Checking</h2>
        <p className="text-muted-foreground">{APP_NAME} includes automatic version checking for self-hosted instances.</p>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Automatic Startup Check</h3>
          <p className="text-sm text-muted-foreground mb-3">When the server starts, it logs the running version and checks GitHub for the latest release:</p>
          <pre className="bg-secondary/50 p-4 rounded text-xs overflow-x-auto mb-4"><code>{`[${APP_NAME}] Starting ${APP_NAME} v${APP_VERSION} (Detection Engine v${ENGINE_VERSION})
[${APP_NAME}] You're running the latest version (v${APP_VERSION}).`}</code></pre>
          <p className="text-sm text-muted-foreground mb-3">If an update is available:</p>
          <pre className="bg-secondary/50 p-4 rounded text-xs overflow-x-auto"><code>{`[${APP_NAME}] Starting ${APP_NAME} v1.6.8 (Detection Engine v${ENGINE_VERSION})
[${APP_NAME}] Update available! You're on v1.6.8, latest is v${APP_VERSION}.
[${APP_NAME}] https://github.com/${APP_REPO}/releases/tag/v${APP_VERSION}`}</code></pre>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Admin Panel Version Check</h3>
          <p className="text-sm text-muted-foreground mb-3">The admin panel (<code className="bg-secondary px-1 rounded text-xs">/admin</code>) includes a version check card that shows the installed vs. latest version with a link to release notes when an update is available.</p>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">API Version Endpoint</h3>
          <p className="text-sm text-muted-foreground mb-3">You can also check the version programmatically:</p>
          <pre className="bg-secondary/50 p-4 rounded text-sm overflow-x-auto"><code>curl {APP_URL}/api/version</code></pre>
          <p className="text-xs text-muted-foreground mt-2">Returns the current version, latest version, engine version, and update status. See <a href="/docs/api#endpoints" className="text-primary hover:underline">API Reference</a> for full response format.</p>
        </Card>
      </section>

      <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4 flex gap-3">
        <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
        <div>
          <h3 className="font-semibold text-foreground mb-1">Setup Complete!</h3>
          <p className="text-sm text-muted-foreground">You're ready to start using {APP_NAME}. Next, check out the <a href="/docs/api" className="text-primary hover:underline">API Reference</a> to learn how to integrate the scanner into your workflow.</p>
        </div>
      </div>
    </div>
  )
}
