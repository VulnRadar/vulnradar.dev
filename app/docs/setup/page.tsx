"use client"

import { Card } from "@/components/ui/card"
import { AlertTriangle, CheckCircle, Info } from "lucide-react"
import { APP_NAME } from "@/lib/constants"

export default function SetupPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-2">Setup Guide</h1>
        <p className="text-lg text-muted-foreground">Complete guide to installing and configuring {APP_NAME} for your environment</p>
      </div>

      {/* Prerequisites */}
      <section id="prerequisites" className="space-y-4">
        <h2 className="text-2xl font-bold">Prerequisites</h2>
        <p className="text-muted-foreground">Before you begin, ensure you have the following installed on your system:</p>
        
        <Card className="p-6 border-border/40 space-y-3">
          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold mb-1">Node.js 18.17+</h4>
              <p className="text-sm text-muted-foreground">JavaScript runtime. Download from <a href="https://nodejs.org" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">nodejs.org</a></p>
              <pre className="bg-secondary/50 p-2 rounded text-xs mt-2 overflow-x-auto"><code>node --version  # Check version</code></pre>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold mb-1">npm 9+ or pnpm 8+</h4>
              <p className="text-sm text-muted-foreground">Node package manager (comes with Node.js). We recommend pnpm for faster installation.</p>
              <pre className="bg-secondary/50 p-2 rounded text-xs mt-2 overflow-x-auto"><code>npm --version  # or pnpm --version</code></pre>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold mb-1">PostgreSQL 14+</h4>
              <p className="text-sm text-muted-foreground">Database server. Download from <a href="https://www.postgresql.org/download" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">postgresql.org</a></p>
              <pre className="bg-secondary/50 p-2 rounded text-xs mt-2 overflow-x-auto"><code>psql --version  # Check version</code></pre>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold mb-1">Git 2.0+</h4>
              <p className="text-sm text-muted-foreground">Version control system. Download from <a href="https://git-scm.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">git-scm.com</a></p>
              <pre className="bg-secondary/50 p-2 rounded text-xs mt-2 overflow-x-auto"><code>git --version  # Check version</code></pre>
            </div>
          </div>
        </Card>
      </section>

      {/* Installation */}
      <section id="installation" className="space-y-4">
        <h2 className="text-2xl font-bold">Installation Steps</h2>
        <p className="text-muted-foreground">Follow these steps to clone and prepare the repository:</p>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Step 1: Clone the Repository</h3>
          <p className="text-sm text-muted-foreground mb-3">Clone VulnRadar from GitHub:</p>
          <pre className="bg-secondary/50 p-4 rounded text-sm overflow-x-auto mb-4"><code>{`git clone https://github.com/RejectModders/VulnRadar.git
cd VulnRadar`}</code></pre>
          <p className="text-xs text-muted-foreground">This creates a directory called "VulnRadar" with the latest code from the main branch.</p>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Step 2: Install Dependencies</h3>
          <p className="text-sm text-muted-foreground mb-3">Install all required npm packages:</p>
          <pre className="bg-secondary/50 p-4 rounded text-sm overflow-x-auto mb-3"><code>npm install</code></pre>
          <p className="text-xs text-muted-foreground mb-3">Or if using pnpm:</p>
          <pre className="bg-secondary/50 p-4 rounded text-sm overflow-x-auto mb-4"><code>pnpm install</code></pre>
          <p className="text-xs text-muted-foreground">This may take 2-5 minutes depending on your internet connection and system performance.</p>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Step 3: Verify Installation</h3>
          <p className="text-sm text-muted-foreground mb-3">Check that all dependencies are installed correctly:</p>
          <pre className="bg-secondary/50 p-4 rounded text-sm overflow-x-auto"><code>{`npm list --depth=0
# or
pnpm list --depth=0`}</code></pre>
        </Card>
      </section>

      {/* Database Setup */}
      <section id="database" className="space-y-4">
        <h2 className="text-2xl font-bold">Database Setup</h2>
        <p className="text-muted-foreground">Configure PostgreSQL for VulnRadar:</p>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Step 1: Create Database and User</h3>
          <p className="text-sm text-muted-foreground mb-3">Connect to PostgreSQL and create a new database:</p>
          <pre className="bg-secondary/50 p-4 rounded text-sm overflow-x-auto mb-4"><code>{`psql -U postgres

# Inside psql:
CREATE DATABASE vulnradar;
CREATE USER vulnradar_user WITH PASSWORD 'strong_password_here';
ALTER ROLE vulnradar_user SET client_encoding TO 'utf8';
ALTER ROLE vulnradar_user SET default_transaction_isolation TO 'read committed';
ALTER ROLE vulnradar_user SET default_transaction_deferrable TO on;
ALTER ROLE vulnradar_user SET default_transaction_deferrable TO off;
GRANT ALL PRIVILEGES ON DATABASE vulnradar TO vulnradar_user;
\\q`}</code></pre>
          <p className="text-xs text-muted-foreground">Replace 'strong_password_here' with a secure password of at least 12 characters.</p>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Step 2: Test Database Connection</h3>
          <p className="text-sm text-muted-foreground mb-3">Verify the connection with your credentials:</p>
          <pre className="bg-secondary/50 p-4 rounded text-sm overflow-x-auto"><code>{`psql -U vulnradar_user -d vulnradar -h localhost
# Type your password when prompted
\\dt  # Lists all tables
\\q  # Exit psql`}</code></pre>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Step 3: Run Migrations</h3>
          <p className="text-sm text-muted-foreground mb-3">After setting environment variables (next section), run migrations:</p>
          <pre className="bg-secondary/50 p-4 rounded text-sm overflow-x-auto"><code>{`npm run db:migrate
# or
pnpm db:migrate`}</code></pre>
          <p className="text-xs text-muted-foreground mt-2">This creates all necessary tables and indexes in your database.</p>
        </Card>
      </section>

      {/* Environment Configuration */}
      <section id="environment" className="space-y-4">
        <h2 className="text-2xl font-bold">Environment Configuration</h2>
        <p className="text-muted-foreground">Configure environment variables for your VulnRadar installation:</p>

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
            <pre className="bg-secondary/50 p-2 rounded text-xs mt-2"><code>echo ".env.local" >> .gitignore</code></pre>
          </div>
        </div>
      </section>

      {/* Running the Application */}
      <section id="running" className="space-y-4">
        <h2 className="text-2xl font-bold">Running the Application</h2>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Development Server</h3>
          <p className="text-sm text-muted-foreground mb-3">Start the development server with hot reload:</p>
          <pre className="bg-secondary/50 p-4 rounded text-sm overflow-x-auto mb-3"><code>{`npm run dev
# or
pnpm dev`}</code></pre>
          <p className="text-xs text-muted-foreground">The application will be available at <a href="http://localhost:3000" className="text-primary hover:underline">http://localhost:3000</a>. Changes to files will automatically reload the browser.</p>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Production Build</h3>
          <p className="text-sm text-muted-foreground mb-3">Build and run for production:</p>
          <pre className="bg-secondary/50 p-4 rounded text-sm overflow-x-auto"><code>{`npm run build
npm start
# or
pnpm build
pnpm start`}</code></pre>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Run on Different Port</h3>
          <p className="text-sm text-muted-foreground mb-3">If port 3000 is already in use:</p>
          <pre className="bg-secondary/50 p-4 rounded text-sm overflow-x-auto"><code>{`npm run dev -- -p 3001
# or
pnpm dev -- -p 3001`}</code></pre>
        </Card>
      </section>

      {/* Verification */}
      <section id="verification" className="space-y-4">
        <h2 className="text-2xl font-bold">Verification Steps</h2>
        <p className="text-muted-foreground">Verify that VulnRadar is running correctly:</p>

        <Card className="p-6 border-border/40 space-y-4">
          <div>
            <h3 className="font-semibold mb-2">1. Access the Application</h3>
            <p className="text-sm text-muted-foreground">Open your browser and navigate to <a href="http://localhost:3000" className="text-primary hover:underline">http://localhost:3000</a></p>
            <p className="text-xs text-muted-foreground mt-2">You should see the VulnRadar landing page with login and signup options.</p>
          </div>

          <div>
            <h3 className="font-semibold mb-2">2. Create a Test Account</h3>
            <p className="text-sm text-muted-foreground">Click "Sign Up" and create a test account with a valid email address</p>
            <p className="text-xs text-muted-foreground mt-2">Password must be at least 8 characters. You'll be logged in automatically after signup.</p>
          </div>

          <div>
            <h3 className="font-semibold mb-2">3. Check Database Connection</h3>
            <p className="text-sm text-muted-foreground">Verify user data was created in the database:</p>
            <pre className="bg-secondary/50 p-2 rounded text-xs mt-2 overflow-x-auto"><code>{`psql -U vulnradar_user -d vulnradar -h localhost
SELECT * FROM "User";
\\q`}</code></pre>
          </div>

          <div>
            <h3 className="font-semibold mb-2">4. Generate an API Key</h3>
            <p className="text-sm text-muted-foreground">From the dashboard, navigate to Account Settings → API Keys and create a new key</p>
            <p className="text-xs text-muted-foreground mt-2">This verifies that the application is fully functional and can interact with the database.</p>
          </div>
        </Card>
      </section>

      {/* Troubleshooting */}
      <section id="troubleshooting" className="space-y-4">
        <h2 className="text-2xl font-bold">Troubleshooting</h2>

        <Card className="p-6 border-border/40 space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <h3 className="font-semibold">Database Connection Error</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-2">Error: "connect ECONNREFUSED 127.0.0.1:5432"</p>
            <p className="text-sm text-muted-foreground mb-2">Solutions:</p>
            <pre className="bg-secondary/50 p-2 rounded text-xs overflow-x-auto mb-2"><code>{`# Check if PostgreSQL is running
sudo systemctl status postgresql  # Linux
brew services list  # macOS

# Start PostgreSQL if not running
sudo systemctl start postgresql  # Linux
brew services start postgresql  # macOS

# Verify connection string in .env.local
psql -U vulnradar_user -d vulnradar -h localhost`}</code></pre>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <h3 className="font-semibold">Port Already in Use</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-2">Error: "EADDRINUSE: address already in use :::3000"</p>
            <p className="text-sm text-muted-foreground mb-2">Solutions:</p>
            <pre className="bg-secondary/50 p-2 rounded text-xs overflow-x-auto"><code>{`# Find what's using port 3000
lsof -i :3000  # macOS/Linux
netstat -ano | findstr :3000  # Windows

# Kill the process or use different port
npm run dev -- -p 3001`}</code></pre>
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
      <section id="deployment" className="space-y-4">
        <h2 className="text-2xl font-bold">Deployment Options</h2>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Vercel (Recommended)</h3>
          <p className="text-sm text-muted-foreground mb-3">VulnRadar is optimized for Vercel deployment:</p>
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
          <p className="text-sm text-muted-foreground mb-3">Deploy using Docker containers:</p>
          <pre className="bg-secondary/50 p-3 rounded text-sm overflow-x-auto"><code>{`docker build -t vulnradar .
docker run -p 3000:3000 \\
  -e DATABASE_URL="postgresql://..." \\
  -e NEXTAUTH_SECRET="..." \\
  vulnradar`}</code></pre>
        </Card>

        <Card className="p-6 border-border/40">
          <h3 className="font-semibold mb-4">Self-Hosted (Linux/Ubuntu)</h3>
          <p className="text-sm text-muted-foreground mb-3">Deploy to your own server:</p>
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>Provision a server with Node.js and PostgreSQL</li>
            <li>Clone the repository on the server</li>
            <li>Configure environment variables</li>
            <li>Run migrations</li>
            <li>Use PM2 or systemd to manage the process</li>
          </ol>
        </Card>
      </section>

      <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4 flex gap-3">
        <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
        <div>
          <h3 className="font-semibold text-foreground mb-1">Setup Complete!</h3>
          <p className="text-sm text-muted-foreground">You're ready to start using VulnRadar. Next, check out the <a href="/docs/api" className="text-primary hover:underline">API Reference</a> to learn how to integrate the scanner into your workflow.</p>
        </div>
      </div>
    </div>
  )
}
