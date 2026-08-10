# VulnRadar Public Docs: AI Knowledge

_Auto-compiled from `app/docs/*/page.tsx` on 2026-08-10._

This file is consumed by the AI system prompt at runtime so the
assistant can answer questions about every public docs page. Edit
the source pages; this file regenerates on `npm run build` and
`npm run dev`.

Extraction covers: DocsHero, DocsSection, DocsCallout,
DocsCodeTabs, CodeBlock, EndpointCard (typed endpoints array),
Feature[] arrays (platformFeatures, apiCategories, etc.), TOC
headings, and prose paragraphs.

---

## Overview
Route: /docs

# ${APP_NAME} documentation
Paste a URL, get a ranked list of what is wrong with it and how to fix each one. These pages cover the REST API, webhooks, quotas, self-hosting, and the internals if you want to add a check of your own.

### Sections
- **First scan** (`#quick-start`)
- **The documentation set** (`#documentation`)
- **What gets checked** (`#coverage`)
- **Support and versions** (`#support`)

### Headings
- {section.title}

### Notes
- probes is optional. Leave it out and only the web checks run. Full request and response shapes are on the API reference .
- detections live in lib/scanner/checks-data/, one JSON file per category, each paired with a detector module in lib/scanner/checks/. Every check has a stable id, so a finding you triage today keeps the same id on the next scan and in the API response.
- Service probes are separate and opt-in. They open a bounded TCP socket, read the greeting, and report version disclosure and reachability for https:// target.
- The full catalogue is served, unauthenticated, from GET /api/v3/finding-types. Use it if you are building an SDK and want every id ahead of time. See Developer documentation for the payload shape.
- If something here is wrong or missing, say so. Bug reports and doc corrections go to the issue tracker; anything account-specific goes through the contact form. Legal terms, the privacy policy, and the acceptable-use rules for scanning targets you do not own are on the legal pages .

## Setup
Route: /docs/setup

### Sections
- **Prerequisites** (`#prerequisites`)
- **Installation Steps** (`#installation`)
- **Database Setup** (`#database`)
- **Environment Configuration** (`#environment`)
- **App Configuration** (`#config`)
- **Running the Application** (`#running`)
- **Verification** (`#verification`)
- **Troubleshooting** (`#troubleshooting`)
- **Deployment Options** (`#deployment`)
- **Docker Deployment** (`#docker`)
- **Schema Migration** (`#migration`)
- **Version Check** (`#version`)

### Callouts
> **INFO: Never commit .env**
> .env and{" "}
.env.local are git-ignored by default. If
you fork the repo, double-check .gitignore.

> **INFO: There is no YAML config file**
> Earlier (pre-v2.3.0) planning docs referenced a{" "}
config.yaml file. The current
implementation does not use one. All non-secret configuration is in{" "}
lib/config/config-values.ts; all secrets
are environment variables.

> **SUCCESS: Prerequisites**
> Docker 24+ and Docker Compose v2.

> **ERROR: HTTPS required**
> Put the app behind a reverse proxy (Caddy, Traefik, nginx) for TLS
termination. Cookie flags (secure) and CSP
headers assume HTTPS in production.

> **WARNING: Schema drift detector**
> npm run audit:v2-tables compares{" "}
instrumentation.ts against{" "}
scripts/migrate/versions/_snippets.mjs. If
they drift, the migrator will fail until both are in sync. Wire this
into CI.

### Headings
- Step 1: Clone the Repository
- Step 2: Install Dependencies
- Option A: Dedicated database (no Docker)
- Option B: Docker Compose (recommended)
- Schema auto-creates on boot
- Create .env from the template
- Common changes
- Development (with hot reload)
- Production
- 1. Access the app
- 2. Sign up the first user
- 3. Promote to admin
- 4. Generate an API key
- 5. Run a scan
- {item.title}
- Vercel
- Self-hosted (Linux)
- Docker Compose
- Step 1: Project directory
- Step 2: Get docker-compose.yml
- Step 3: Configure .env
- Step 4: Start
- Step 5: Verify
- Common operations
- Run a migration

### Notes
- Before you begin, ensure you have the following installed:
- Allow-scripts for native packages (bcrypt, esbuild, sharp, unrs-resolver, core-js) are whitelisted in .npmrc.
- The included docker-compose.yml provisions Postgres with credentials vulnradar:vulnradar on port 5432. See the Docker section below.
- instrumentation.ts runs CREATE TABLE IF NOT EXISTS for every table on first server boot. No manual migration is required for a fresh database. For databases upgraded from an older schema, see Schema Migration .
- Secrets and per-deployment overrides go in .env (or .env.local for local-only overrides; Next.js loads .env.local with higher precedence than .env ).
- Open .env and fill in at minimum:
- Optional: SMTP, Stripe, Discord, Turnstile. Full reference on the Configuration page.
- .env and .env.local are git-ignored by default. If you fork the repo, double-check .gitignore.
- Non-secret deployment tunables live in lib/config/config-values.ts. Branding, app name, and SEO values are baked in at build time, so edit those before the first build and restart to pick up changes. Most of the rest (rate limits, feature flags, billing, scan timeouts) can also be changed at runtime after signup, from /admin&rsquo;s Settings tab, with no restart. See Configuration for which is which.
- Earlier (pre-v2.3.0) planning docs referenced a config.yaml file. The current implementation does not use one. All non-secret configuration is in lib/config/config-values.ts; all secrets are environment variables.

### Code examples
```bash
<value>  # Check version
```

```bash
git clone https://github.com/<value>.git
cd <value>.dev
```

```sql
psql -U postgres

CREATE DATABASE vulnradar;
CREATE USER vulnradar_user WITH PASSWORD 'strong_password_here';
GRANT ALL PRIVILEGES ON DATABASE vulnradar TO vulnradar_user;
\\q
```

```bash
# Database
DATABASE_URL=postgresql://vulnradar:your-password@localhost:5432/vulnradar
DATABASE_SSL=false

# Public URL
NEXT_PUBLIC_APP_URL=http://localhost:3000

# API key encryption (REQUIRED). Generate with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
API_KEY_ENCRYPTION_KEY=your-64-character-hex-key
```

```bash
docker compose exec postgres psql -U vulnradar -d vulnradar -c \\
  "UPDATE users SET role = 'admin' WHERE email = 'you@example.com'"
```

```bash
curl -X POST "<value>/api/v3/scan" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://example.com"}'
```

```bash
curl -O https://raw.githubusercontent.com/<value>/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/<value>/main/.env.example
```

```bash
git clone https://github.com/<value>.git
cd <value>.dev
cp .env.example .env
```

## Self-Hosting
Route: /docs/self-hosting

### Sections
- **Overview** (`#overview`)
- **Hardware Requirements** (`#hardware`)
- **Prerequisites** (`#prerequisites`)
- **Clone and Configure** (`#clone`)
- **Create .env** (`#env`)
- **AI Features (Optional)** (`#ai`)
- **docker-compose** (`#docker`)
- **Start the Stack** (`#start`)
- **First Admin User** (`#admin`)
- **TLS (Reverse Proxy)** (`#tls`)
- **Configure Stripe Webhook (If Billing)** (`#stripe`)
- **Backups** (`#backups`)
- **Updates** (`#updates`)
- **Troubleshooting** (`#troubleshooting`)
- **Security Checklist** (`#security`)

### Callouts
> **INFO: Time estimate**
> About 30 minutes if you already have Docker + a domain pointed at your
server.

> **WARNING: Bring a real context window**
> These features load actual scan output into the prompt, not a short
chat message. As a floor, use a model with around{" "}
300,000 tokens of
context. A small local model, e.g. Ollama&rsquo;s default{" "}
llama3.2, does not have that headroom and
will degrade or break outright once enough context is 

> **WARNING: After schema changes**
> If instrumentation.ts changed in the new
release, run npm run db:migrate inside the
app container to apply the diff interactively. The script is
idempotent; safe to re-run.

### Headings
- Option A: Stripe dashboard
- Option B: auto-setup endpoint

### Notes
- The fastest path to running yourself. Assumes a single Linux server with Docker. For Kubernetes, multi-region, or bare-metal setups, adapt accordingly.
- Edit lib/config/config-values.ts to set:
- If you don&apos;t want billing features, set:
- Full reference on the Configuration page.
- These features load actual scan output into the prompt, not a short chat message. As a floor, use a model with around 300,000 tokens of context. A small local model, e.g. Ollama&rsquo;s default llama3.2, does not have that headroom and will degrade or break outright once enough context is loaded.
- The default docker-compose.yml provisions Postgres + the app container + a healthcheck + a smoke test. The app reads .env via env_file.
- On boot, instrumentation.ts runs CREATE TABLE IF NOT EXISTS for every table. The meta row in vulnradar_schema_meta is written on the first successful migration. Look for Database schema verified successfully in the logs.
- does not terminate TLS itself. Put a reverse proxy in front. Minimal Caddy config:
- Caddy auto-provisions a Let&apos;s Encrypt certificate.
- For nginx, see the official nginx + Next.js guide .

### Code examples
```typescript
git clone https://github.com/<value>.git
cd vulnradar.dev

# Generate a 32-byte API encryption key (64 hex chars)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# → paste into API_KEY_ENCRYPTION_KEY
```

```bash
export const CONFIG_BILLING_ENABLED = false;
```

```bash
# Required
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
STRIPE_WEBHOOK_SECRET=whsec_...
```

```caddyfile
UPDATE users
SET role = 'admin'
WHERE email = 'you@yourdomain.com';
```

```bash
# Log in via the web UI as an admin user, then export the cookie:
curl -b cookies.txt https://scanner.yourdomain.com/api/v3/stripe/setup-webhook
# First call: returns { success: true, webhookSecret: "whsec_..." }
# Paste the secret into STRIPE_WEBHOOK_SECRET in .env and restart.
```

```text
export const CONFIG_APP_NAME = "YourBrand Scanner";
export const CONFIG_APP_URL = "https://scanner.yourdomain.com";
export const CONFIG_APP_REPO = "yourname/your-repo";
export const CONFIG_DISCORD_INVITE_URL = ""; // optional

export const CONFIG_SUPPORT_EMAIL = "support@yourdomain.com";
export const CONFIG_LEGAL_EMAIL = "legal@yourdomain.com";
export const CONFIG_SECURITY_EMAIL = "security@yourdomain.com";
export const CONFIG_ENTERPRISE_EMAIL = "enterprise@yourdomain.com";
export const CONFIG_NOREPLY_EMAIL = "noreply@yourdomain.com";
```

```text
cp .env.example .env
```

```text
docker compose up -d
docker compose logs -f app   # watch startup
```

## Configuration
Route: /docs/config

### Sections
- **Overview** (`#overview`)
- **Quick Reference** (`#quick-reference`)
- **Architecture** (`#architecture`)
- **Layer 1: Static App Config** (`#layer-1`)
- **Admin Settings Page** (`#admin-settings`)
- **Layer 2: Runtime Secrets** (`#layer-2`)
- **AI Providers & Models** (`#ai-models`)
- **Self-Hosting Checklist** (`#checklist`)
- **Validation** (`#validation`)

### Callouts
> **INFO: TL;DR**
> Most things you want to change live in{" "}
lib/config/config-values.ts. Secrets go in{" "}
.env. Edit{" "}
config-values.ts first.

> **INFO: ~30 second propagation**
> The resolver caches the whole table for 30 seconds so a value read
on every request (like a rate limit) does not hit Postgres every
time. The admin who makes a change sees it immediately (the write
clears that process&rsquo;s cache); every other running instance
picks it up the next time its own 30 

> **WARNING: AI features need real context**
> Verifying findings or summarizing a full scan means loading a lot of
scan output into the prompt. As a floor, look for a model with
around 300,000 tokens{" "}
of context. A small local model such as Ollama&rsquo;s default{" "}
llama3.2 has nowhere near that: it will
degrade or break outright as more

### Notes
- has a two-layer configuration model designed to keep secrets out of source code while making non-secret deployment settings easy to customize for self-hosters.
- Single source of truth: lib/config/config-values.ts exports raw CONFIG_* constants. Everything else (types, derived objects, route maps) is built from those constants. Edit config-values.ts to customize your deployment.
- Edit lib/config/config-values.ts to change the shipped default for any of these. Whether that edit needs a restart depends on the setting&rsquo;s tier: General, Branding, and SEO values are baked into the build and need a rebuild either way, but most of the rest (rate limits, feature flags, billing, scan timeouts, auth windows, and more) can also be overridden at runtime, without touching source, from the Admin Settings Page below.
- All values are per-IP unless noted. The window is in minutes. Internally lib/config/constants.ts multiplies by 60 for the per-second window.
- The /demo page lets unauthenticated visitors run scans. Rate-limited per IP.
- Disable demo mode entirely with CONFIG_FEATURE_DEMO_MODE = false.
- Plan catalogs (limits per plan) live in lib/billing/catalog.ts. The values below only configure the upper bounds and the retention window.
- of the values above also have a row in the system_settings database table and a control on /admin &rsquo;s Settings tab, sign in as an admin to reach it. The tab list there () and every field on it is generated from the same registry that generates the reference tables below, so the two cannot drift apart.
- Every setting on the page is one of two tiers, shown as a badge per tab rather than repeated on every field:
- The database wins because that is the layer the admin panel edits. An environment variable of the same name comes next, so a container can pin a value without a database write. The shipped CONFIG_* constant is the last resort, which is why a fresh install with an empty system_settings table behaves exactly as it does today.

### Code examples
```text
lib/config/
├── config-values.ts        ← SOURCE OF TRUTH (raw CONFIG_* constants)
├── constants.ts            ← Re-exports + derived route/error maps
├── client-constants.ts     ← Client-safe subset (no server-only values)
├── config.ts               ← Cached loader (loadConfig, getConfigValue)
└── public-paths.ts         ← Middleware public-path allowlist

lib/types/
└── config.ts                ← Type definitions + DEFAULT_CONFIG
                              (DERIVED from config-values.ts)
```

```text
resolve(key) = database value  ??  environment override  ??  shipped default
```

## API Reference
Route: /docs/api

### Sections
- **Overview** (`#overview`)
- **Authentication** (`#authentication`)
- **Endpoints** (`#endpoints`)
- **Code Examples** (`#code-examples`)
- **Rate Limiting** (`#rate-limiting`)
- **Error Handling** (`#error-handling`)
- **Before You Ship This** (`#best-practices`)

### Callouts
> **WARNING: Three keys, and they leak**
> Each account is capped at 3 active keys. Keep them out of
version control and rotate with{" "}
POST /api/v3/keys/[id]/rotate, which
deletes the old key in the same call.

> **INFO: Sessions and keys count separately**
> A scan run from the web app decrements a per-user counter. A scan
run with a Bearer key decrements that key&apos;s counter. Both emit
the same X-RateLimit-* headers, but the
reset is midnight UTC for sessions and a rolling 24 hours for keys.

### Endpoints
#### `POST /scan`: Create a Scan
Start a vulnerability scan against a target. Pass a hostname or a full URL; we auto-prepend https:// if you omit the scheme. Service probes are opt-in via the probes field. The scan runs as a background job: this call returns immediately with a scan id, and you poll GET /scan/status/{scanId} for progress and the final result.

- **Request body:**
```json
{
  "url": "example.com",
  "probes": ["ssh:22", "smtp:587"]
}
```

- **Response (200):**
```json
{
  "scanId": 12345,
  "status": "running"
}
```

#### `GET /scan/status/{id}`: Get Scan Job Status
Poll a scan job started by POST /scan or POST /scan/crawl. Returns live progress while the job runs and the full result once it completes.

- **Response (200):**
```json
{
  "status": "running",
  "currentCategory": "headers",
  "categoriesCompleted": 4,
  "categoriesTotal": 12,
  "elapsedMs": 1820
}
```

#### `DELETE /scan/status/{id}`: Cancel a Scan Job
Cancel a scan that is still pending or running. Has no effect on a scan that already finished.

- **Response (200):**
```json
{
  "status": "failed",
  "cancelled": true
}
```

#### `POST /scan/authenticated`: Authenticated Scan
Scan a single page after logging in first. Credentials are supplied in this one request and are never stored: they live only in memory for the duration of the call. Unlike POST /scan, this endpoint is synchronous (no polling) and scans exactly one page; it does not crawl.

- **Request body:**
```json
{
  "url": "https://example.com/dashboard",
  "auth": {
    "method": "form",
    "loginUrl": "https://example.com/login",
    "username": "demo@example.com",
    "password": "correct-horse-battery-staple"
  }
}
```

- **Response (200):**
```json
{
  "scanHistoryId": 12345,
  "url": "https://example.com/dashboard",
  "scannedAt": "2026-08-05T15:30:00.000Z",
  "duration": 2210,
  "findings": [],
  "summary": { "critical": 0, "high": 0, "medium": 1, "low": 0, "info": 0, "total": 1 },
  "responseHeaders": { "content-type": "text/html; charset=utf-8" },
  "authReport": { "status": "authenticated", "method": "form" }
}
```

#### `POST /scan/bulk`: Bulk Scan
Submit up to 100 URLs in one request. Each URL counts as one daily quota unit.

- **Request body:**
```json
{
  "urls": [
    "https://example.com",
    "https://example.org",
    "https://example.net"
  ]
}
```

- **Response (200):**
```json
{
  "results": [
    { "url": "https://example.com", "summary": { "critical": 0, "high": 1, "medium": 2, "low": 1, "info": 0, "total": 4 } },
    { "url": "https://example.org", "summary": { "critical": 0, "high": 0, "medium": 0, "low": 1, "info": 2, "total": 3 } }
  ],
  "totalScans": 3,
  "totalFindings": 12
}
```

#### `POST /scan/crawl`: Deep Crawl Scan
Crawl the target and scan each discovered page. Either provide a pre-selected URL list or let the crawler discover links. Up to 15 pages per crawl. Like POST /scan, this runs as a background job: the call returns immediately with a scan id, and you poll GET /scan/status/{scanId} for progress and the final aggregate result.

- **Request body:**
```json
{
  "url": "https://example.com",
  "urls": ["https://example.com/about", "https://example.com/contact"]
}
```

- **Response (200):**
```json
{
  "scanId": 12346,
  "status": "running"
}
```

#### `POST /scan/crawl/discover`: Discover URLs
Discover links from a target without scanning them. Useful for previewing what a crawl would cover.

- **Request body:**
```json
{
  "url": "https://example.com"
}
```

- **Response (200):**
```json
{
  "urls": [
    "https://example.com",
    "https://example.com/about",
    "https://example.com/contact",
    "https://example.com/blog"
  ],
  "total": 4
}
```

#### `POST /scan/discover`: Discover Subdomains
Enumerate subdomains for a domain. Aggregates results from crt.sh, HackerTarget, Subdomain.Center, RapidDNS, and brute-force DNS.

- **Request body:**
```json
{
  "url": "https://example.com",
  "forceRefresh": false
}
```

- **Response (200):**
```json
{
  "subdomains": [
    { "host": "www.example.com", "source": "crt.sh" },
    { "host": "api.example.com", "source": "rapiddns" },
    { "host": "staging.example.com", "source": "brute" }
  ]
}
```

#### `GET /history`: List Scan History
Returns up to 100 most recent scans for the authenticated user. Retention follows the user's plan (Free: 30 days, Core: 90, Pro/Elite: forever). Staff roles bypass retention.

- **Response (200):**
```json
{
  "scans": [
    {
      "id": 1,
      "url": "https://example.com",
      "summary": { "critical": 0, "high": 1, "medium": 2, "low": 3, "info": 1, "total": 7 },
      "findings_count": 7,
      "duration": 1423,
      "scanned_at": "2026-03-10T15:30:00.000Z",
      "source": "api",
      "tags": ["production", "weekly-scan"]
    }
  ]
}
```

#### `GET /history/[id]`: Get Scan Details
Return full scan details: findings, response headers, scan metadata. Owner or same-team member can view.

- **Response (200):**
```json
{
  "url": "https://example.com",
  "scannedAt": "2026-03-10T15:30:00.000Z",
  "duration": 1423,
  "summary": { "critical": 0, "high": 1, "medium": 2, "low": 3, "info": 1, "total": 7 },
  "findings": [
    { /* full Vulnerability object, see /scan response */ }
  ],
  "responseHeaders": {
    "content-type": "text/html; charset=utf-8",
    "server": "nginx/1.18.0"
  }
}
```

#### `DELETE /history`: Delete All Scan History
Permanently delete every scan and tag for the authenticated user. Cannot be undone.

- **Response (200):**
```json
{
  "success": true,
  "deleted": 47
}
```

#### `DELETE /history/[id]`: Delete a Single Scan
Permanently delete a single scan by ID. Owner only.

- **Response (200):**
```json
{
  "success": true,
  "message": "Scan deleted successfully"
}
```

#### `PATCH /history/[id]`: Update Scan Notes
Update the user note on a scan. Owner only.

- **Request body:**
```json
{
  "notes": "Investigating HSTS issue with infra team"
}
```

- **Response (200):**
```json
{
  "success": true
}
```

#### `POST /browser/sessions`: Start a Browser Session
Open an ephemeral BrowserBase session so the user can view the scanned site from a remote, sandboxed browser. Sessions are time-limited and end automatically when the popup closes. Only enabled when BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID are configured on the server.

- **Request body:**
```json
{
  "url": "https://example.com",
  "ttlSeconds": 300
}
```

- **Response (200):**
```json
{
  "session": {
    "id": "01HXY...",
    "status": "RUNNING",
    "url": "https://example.com",
    "debuggerUrl": "https://www.browserbase.com/devtools/inspector.html?wss=connect.browserbase.com%2Fdebug%2F...",
    "debuggerFullscreenUrl": "https://www.browserbase.com/devtools-fullscreen/inspector.html?wss=connect.browserbase.com%2Fdebug%2F...",
    "connectUrl": "wss://connect.browserbase.com/debug/...",
    "liveViewerUrl": "https://www.browserbase.com/devtools-fullscreen/inspector.html?wss=...&navbar=false",
    "expiresAt": "2026-06-26T18:25:55.722+00:00"
  },
  "expiresInSeconds": 300
}
```

#### `GET /browser/sessions?id={id}`: Read Browser Session
Fetch the latest BrowserBase session metadata (status, current URL, viewer URL). Used by the popup page to refresh after the user reconnects.

- **Response (200):**
```json
{
  "session": {
    "id": "bb_session_abc123",
    "status": "RUNNING",
    "url": "https://example.com/login",
    "liveViewerUrl": "https://app.browserbase.com/..."
  }
}
```

#### `DELETE /browser/sessions?id={id}`: End Browser Session
End a BrowserBase session early. Idempotent, so it is safe to call from window.onbeforeunload.

- **Response (200):**
```json
{
  "ended": true,
  "id": "bb_session_abc123"
}
```

#### `GET /api/version`: Version Check
Compare installed version against the latest GitHub release. Unauthenticated. Cached upstream of GitHub for 1 hour.

- **Response (200):**
```json
{
  "current": "${APP_VERSION}",
  "engine": "${ENGINE_VERSION}",
  "latest": "${APP_VERSION}",
  "status": "up-to-date",
  "message": "You're running the latest version.",
  "release_url": "https://github.com/${APP_REPO}/releases/tag/v${APP_VERSION}"
}
```

#### `GET /api/v3/finding-types`: Finding Types
Returns the full catalogue of detection checks. Use this to display human-readable titles, categorize findings, or build SDKs that know every check ID ahead of time.

- **Response (200):**
```json
{
  "success": true,
  "count": 695,
  "categories": {
    "content": 148,
    "headers": 130,
    "code": 112,
    "secrets-extended": 55,
    "information-disclosure": 40,
    "api": 32,
    "vibe-code": 31,
    "cookies": 32,
    "tls": 20,
    "configuration": 18,
    "email": 18,
    "client-side": 16,
    "supply-chain": 15,
    "dns": 13,
    "ssl": 8,
    "host-validation": 7
  },
  "data": [
    {
      "id": "hsts-missing",
      "type": "header",
      "title": "HSTS Header Missing",
      "category": "headers",
      "severity": "medium",
      "description": "HTTP Strict Transport Security header is not set."
    },
    {
      "id": "csp-missing",
      "type": "header",
      "title": "Content Security Policy Header Missing",
      "category": "headers",
      "severity": "medium",
      "description": "Content Security Policy header is not set."
    }
  ]
}
```

#### `GET /keys`: List API Keys
List API keys for the authenticated user. Secret values are never returned.

- **Response (200):**
```json
{
  "keys": [
    {
      "id": 1,
      "name": "CI",
      "prefix": "vr_live_abc12345",
      "created_at": "2026-03-10T15:30:00.000Z",
      "last_used_at": "2026-03-10T16:00:00.000Z",
      "daily_limit": 150,
      "revoked_at": null
    }
  ]
}
```

#### `POST /keys`: Create API Key
Generate a new API key. The raw value is returned ONLY in this response, so copy and store it immediately. Up to 3 active keys per user.

- **Request body:**
```json
{
  "name": "CI"
}
```

- **Response (200):**
```json
{
  "id": 1,
  "name": "CI",
  "key": {
    "raw_key": "vr_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "prefix": "vr_live_xxxxxxxx",
    "daily_limit": 50
  }
}
```

#### `POST /keys/[id]/rotate`: Rotate API Key
Hard-delete the key and create a new one with the same name. Returns the new raw key once.

- **Response (200):**
```json
{
  "id": 2,
  "name": "CI",
  "key": { "raw_key": "vr_live_…", "prefix": "vr_live_…", "daily_limit": 50 }
}
```

#### `POST /keys/[id]/revoke`: Revoke API Key
Set revoked_at on the key. The key stops working immediately.

- **Response (200):**
```json
{
  "success": true
}
```

### Headings
- Getting a key
- Headers on a successful response
- Body of a 429
- Create a scan
- List scan history
- Get scan details

### Notes
- Authentication is either the session cookie the web app already holds, or a Bearer API key prefixed vr_live_ ( CONFIG_API_KEY_PREFIX). Which one you use changes how quota is counted, so read Rate Limits before you wire this into CI.
- Each account is capped at 3 active keys. Keep them out of version control and rotate with POST /api/v3/keys/[id]/rotate, which deletes the old key in the same call.
- The same three calls in curl, JavaScript, and Python. Swap the placeholder key and they run as-is. The Python tab uses the official SDK (pip install vulnradar, source at github.com/VulnRadar/Python-SDK ) instead of raw HTTP calls.
- A per-key daily quota, plus per-IP burst limits on the auth endpoints. The numbers, the reset semantics, and worked backoff code are on the Rate Limits page. What follows is the part you need while reading this reference.
- A scan run from the web app decrements a per-user counter. A scan run with a Bearer key decrements that key&apos;s counter. Both emit the same X-RateLimit-* headers, but the reset is midnight UTC for sessions and a rolling 24 hours for keys.
- Standard HTTP status codes. Every error body carries at least an error string; quota errors add the counters shown above.

### Code examples
```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 150
X-RateLimit-Remaining: 147
X-RateLimit-Used: 3
X-RateLimit-Policy: daily
X-RateLimit-Reset: 2026-03-12T00:00:00.000Z
```

```json
{
  "error": "Daily scan limit reached. Resets at 2026-03-12T00:00:00Z.",
  "limit": 150,
  "used": 150,
  "remaining": 0,
  "resets_at": "2026-03-12T00:00:00Z"
}
```

```http
Authorization: Bearer YOUR_API_KEY_HERE
```

## Webhooks
Route: /docs/webhooks

# Webhooks
Retrieve all webhooks for the authenticated user.

### Sections
- **Overview** (`#overview`)
- **Supported Platforms** (`#supported-platforms`)
- **API Endpoints** (`#endpoints`)
- **Webhook Payloads** (`#payloads`)
- **Security** (`#security`)
- **Integration Examples** (`#examples`)

### Headings
- Discord
- Slack
- Generic
- Creating a Discord webhook
- Local development: receive on webhook.site

### Notes
- detects the platform by matching the URL pattern. Override with the type body field if needed.
- Manage webhooks through these session-authenticated endpoints (the /api/v3/webhooks family requires a logged-in user; API keys are not accepted).
- Each platform receives a tailored payload. The summary object is the same in all three: critical, high, medium, low, info, total.
- Embed color: 0xef4444 (red, any critical), 0xf97316 (orange, any high), 0xeab308 (yellow, any medium), 0x22c55e (green, otherwise).
- Delivered with Content-Type: application/json, User-Agent: -Webhook/1.0, and (if the webhook has a secret) an X-VulnRadar-Signature header -- see Security below.

### Code examples
```json
{
  "embeds": [
    {
      "title": "<value> Scan Complete",
      "description": "Scan finished for **https://example.com**",
      "color": 15158332,
      "fields": [
        { "name": "Critical", "value": "1", "inline": true },
        { "name": "High", "value": "2", "inline": true },
        { "name": "Medium", "value": "1", "inline": true },
        { "name": "Low", "value": "1", "inline": true },
        { "name": "Info", "value": "0", "inline": true },
        { "name": "Total Issues", "value": "5", "inline": true },
        { "name": "Duration", "value": "1.4s", "inline": true }
      ],
      "footer": { "text": "<value> Security Scanner" },
      "timestamp": "2026-03-10T15:30:00.000Z"
    }
  ]
}
```

```json
{
  "blocks": [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "<value> Scan Complete"
      }
    },
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": "*URL:* https://example.com" }
    },
    {
      "type": "section",
      "fields": [
        { "type": "mrkdwn", "text": "*Critical:* 1" },
        { "type": "mrkdwn", "text": "*High:* 2" },
        { "type": "mrkdwn", "text": "*Medium:* 1" },
        { "type": "mrkdwn", "text": "*Low:* 1" },
        { "type": "mrkdwn", "text": "*Total:* 5" },
        { "type": "mrkdwn", "text": "*Duration:* 1.4s" }
      ]
    },
    {
      "type": "context",
      "elements": [
        { "type": "mrkdwn", "text": "Sent by <value> Security Scanner" }
      ]
    }
  ]
}
```

```json
{
  "event": "scan.completed",
  "data": {
    "url": "https://example.com",
    "summary": {
      "critical": 1, "high": 2, "medium": 1, "low": 1, "info": 0, "total": 5
    },
    "findings_count": 5,
    "duration": 1423,
    "scanned_at": "2026-03-10T15:30:00.000Z"
  }
}
```

## Rate Limits
Route: /docs/rate-limits

### Sections
- **Overview** (`#overview`)
- **Daily Quotas by Plan** (`#limits-by-plan`)
- **Per-IP Limits** (`#ip-rate-limits`)
- **Rate Limit Headers** (`#headers`)
- **Handling 429 Responses** (`#handling`)
- **Best Practices** (`#best-practices`)

### Callouts
> **INFO: Where the numbers come from**
> Daily quotas are defined in{" "}
lib/billing/catalog.ts (one entry per plan:{" "}
dailyScans and{" "}
apiRequestsPerDay). New API keys default to{" "}
CONFIG_DEFAULT_API_KEY_DAILY_LIMIT = 50 (
lib/config/config-values.ts).

> **INFO: Staff accounts have no limit**
> Users with role admin,{" "}
moderator, or{" "}
support are exempt from daily quotas (
daily-limits.ts returns{" "}
Infinity).

> **SUCCESS: Crawl count semantics**
> For Bearer-authenticated deep crawls (
/api/v3/scan/crawl
), the call itself counts as{" "}
1 daily quota unit. For
session-authenticated crawls, each scanned page counts as 1 unit (10
pages = 10 quota units). Discovery (
/api/v3/scan/crawl/discover) counts as 1
unit regardless of how many URLs it r

> **INFO: Not the same as IP session binding**
> These are frequency limits: how often a given IP or key may call an
endpoint. A separate, optional setting can additionally bind a
session or API key to the subnet it started on and end it on a
mismatch. That is an identity check, off by default, documented on
the{" "}

Configuration
{" "}
page, not

> **INFO: Reset semantics differ by auth**
> For session auth, the
daily counter resets at{" "}
00:00 UTC. For{" "}
API-key auth, the
counter is a rolling 24-hour window anchored to the oldest usage in
the current period. The same{" "}
X-RateLimit-Reset header reflects whichever
applies.

### Headings
- 429 response
- Exponential backoff (TypeScript)
- Python

### Notes
- Two separate limit systems protect the platform. They are enforced in different places and behave differently on overflow.
- Two separate counters: scans/day enforced for session-authenticated users, and API requests/day enforced for Bearer-authenticated API keys.
- Daily quotas are defined in lib/billing/catalog.ts (one entry per plan: dailyScans and apiRequestsPerDay). New API keys default to CONFIG_DEFAULT_API_KEY_DAILY_LIMIT = 50 ( lib/config/config-values.ts).
- Users with role admin, moderator, or support are exempt from daily quotas ( daily-limits.ts returns Infinity).
- IP-based rate limits are configured in lib/config/config-values.ts as CONFIG_RATE_LIMIT_*_ATTEMPTS + _WINDOW_MINUTES pairs. The window is converted to seconds at boot.
- For Bearer-authenticated deep crawls ( /api/v3/scan/crawl ), the call itself counts as 1 daily quota unit. For session-authenticated crawls, each scanned page counts as 1 unit (10 pages = 10 quota units). Discovery ( /api/v3/scan/crawl/discover) counts as 1 unit regardless of how many URLs it returns.
- These are frequency limits: how often a given IP or key may call an endpoint. A separate, optional setting can additionally bind a session or API key to the subnet it started on and end it on a mismatch. That is an identity check, off by default, documented on the Configuration page, not a rate limit.
- Every successful scan response includes rate-limit headers. A 429 response includes the same headers plus Retry-After.
- For session auth, the daily counter resets at 00:00 UTC. For API-key auth, the counter is a rolling 24-hour window anchored to the oldest usage in the current period. The same X-RateLimit-Reset header reflects whichever applies.
- When you exceed your quota, the API returns 429 with a structured body.

### Code examples
```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 150
X-RateLimit-Remaining: 147
X-RateLimit-Used: 3
X-RateLimit-Policy: daily
X-RateLimit-Reset: 2026-03-12T00:00:00.000Z
```

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 43200

{
  "error": "Daily scan limit reached. Resets at 2026-03-12T00:00:00Z.",
  "limit": 150,
  "used": 150,
  "remaining": 0,
  "resets_at": "2026-03-12T00:00:00Z"
}
```

```typescript
async function scanWithRetry(url: string, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch('<value>/api/v3/scan', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer YOUR_API_KEY',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    });

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('Retry-After') ?? '60');
      const wait = Math.min(retryAfter * 1000, 2 ** attempt * 1000);
      console.log(\`Rate limited. Waiting \<value>s before retry.\`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    return response.json();
  }
  throw new Error('Rate limit retries exceeded');
}
```

```python
import requests
import time

def scan_with_retry(url, max_retries=3):
    for attempt in range(max_retries):
        response = requests.post(
            '<value>/api/v3/scan',
            headers={'Authorization': 'Bearer YOUR_API_KEY'},
            json={'url': url},
        )
        if response.status_code == 429:
            retry_after = int(response.headers.get('Retry-After', 60))
            wait = min(retry_after, 2 ** attempt)
            print(f"Rate limited. Waiting {wait}s.")
            time.sleep(wait)
            continue
        return response.json()
    raise Exception('Rate limit retries exceeded')
```

## Architecture
Route: /docs/architecture

### Sections
- **Overview** (`#overview`)
- **Project Layout** (`#layout`)
- **Key Subsystems** (`#subsystems`)
- **Request Lifecycle** (`#lifecycle`)
- **CI/CD Pipeline** (`#cicd`)

### Callouts
> **INFO: Single source of truth**
> Almost every tunable lives in{" "}
lib/config/config-values.ts. The rest of the
config system is built from those constants. Edit there, not in random
files.

### Notes
- is a Next.js 15 App Router application with a single-process deployment. The runtime stack is deliberately small: one Next.js process + one PostgreSQL database. No Redis, no message broker, no separate API server. Everything you need to understand lives in this repository.
- See the Configuration page for full details. Flow:
- The detection engine is split across per-category files:
- Categories (lib/scanner/types.ts, 16 total): headers, ssl, tls, content, cookies, configuration, information-disclosure, dns, email, api, code, secrets-extended, vibe-code, client-side, supply-chain, host-validation. Severities: info, low, medium, high, critical.
- Service probes ( lib/scanner/protocols/banner.ts) open a bounded TCP socket to the target hostname on a well-known or user-supplied port, read the greeting, and report version disclosure and reachability. The 6 supported probes are ssh, smtp, imap, pop3, ftp, and mongodb. Probes are independent of the URL scheme: opt into "probes": ["ssh:2222"] from the dashboard without constructing ssh://host.
- REST v3 is the only API this build serves. There is no /api/v1 or /api/v2 route tree; the deprecation headers in lib/api/api-deprecation.ts are legacy from an earlier release and only matter to an instance still running that version. Each v3 route handler:
- Role hierarchy (defined in lib/config/client-constants.ts):
- All four checks (lint, typecheck, test, build) run on Node 22 LTS in CI. See .github/workflows/.

### Code examples
```text
vulnradar.dev/
├── app/                          # Next.js App Router
│   ├── (root pages)              # /, /landing, /pricing, /demo, /contact, /donate
│   ├── admin/                    # Admin dashboard (staff-gated)
│   ├── api/v3/                   # REST API v3 (and /api/security-txt, /api/version)
│   ├── dashboard/                # User dashboard (authenticated)
│   ├── docs/                     # This documentation site
│   ├── history/                  # Scan history (authenticated)
│   ├── legal/                    # Terms, privacy, etc.
│   ├── login, signup,            # Auth pages
│   ├── forgot-password,
│   │  reset-password,
│   │  verify-email
│   ├── pricing/                  # Pricing + Stripe checkout
│   ├── profile/                  # User profile
│   ├── shared/[token]/           # Public shared-scan viewer
│   ├── staff/                    # Public staff list
│   └── teams/                    # Team management
│
├── components/                   # React components (mostly client)
│   ├── admin/                    # Admin UI
│   ├── auth/                     # Auth forms
│   ├── badge/                    # Public badge widgets
│   ├── billing/                  # Stripe checkout UI
│   ├── docs/                     # Documentation site components
│   ├── landing/                  # Marketing landing
│   ├── scanner/                  # Scan UI (results, footer)
│   ├── shared/                   # Cross-cutting (notifications, logo)
│   └── ui/                       # shadcn/ui primitives
│
├── lib/                          # Server-side libraries (no React)
│   ├── api/                      # API helpers (Bearer validation, request utils)
│   ├── auth/                     # Sessions, 2FA, password hashing, device trust
│   ├── billing/                  # Stripe + plan catalog
│   ├── config/                   # Configuration system
│   ├── database/                 # PostgreSQL pool, query helpers, cleanup
│   ├── discord/                  # Discord OAuth helpers
│   ├── email/                    # Transactional email (SMTP)
│   ├── notifications/            # In-app + email notification preferences
│   ├── rate-limiting/            # Generic + plan-based rate limits
│   ├── reports/                  # PDF report generation
│   ├── scanner/                  # Detection engine
│   ├── types/                    # Shared TypeScript types
│   └── uploads/                  # Avatar validation
│
├── instrumentation.ts            # Next.js startup hooks (DB init, schema check)
├── middleware.ts                 # Auth + public-path middleware
│
├── public/                       # Static assets
├── scripts/                      # DB migration + audit scripts
│   ├── _lib/                     # Shared helpers
│   ├── create-fresh-db/          # Side-by-side DB clone
│   └── migrate/                  # Schema migrations
│
├── .github/                      # Workflows, dependabot, PR template
├── Dockerfile
├── docker-compose.yml
├── docker-compose.dev.yml
├── next.config.mjs
├── tsconfig.json
├── tailwind.config.ts
├── eslint.config.mjs
├── vitest.config.ts
└── package.json
```

```text
user (0) → support (1) → moderator (2) → admin (3)
```

```text
Browser / client
  │
  ▼
middleware.ts
  - Allow public paths (lib/config/public-paths.ts)
  - For /api/v3/* with Authorization: Bearer … → pass through
    (the route handler performs API-key validation)
  - Otherwise: parse session cookie → look up session row
    - Disabled / expired session → destroy cookie, redirect to /login
  - Inject Cross-Origin-* security headers
  │
  ▼
Route handler (app/api/v3/<resource>/route.ts)
  1. withErrorHandling wrapper
  2. Auth check (getSession OR validateApiKey)
  3. Rate limit check (lib/rate-limiting/rate-limit.ts)
  4. Daily quota check (lib/rate-limiting/daily-limits.ts, API-key + session)
  5. Input validation (Zod via Validate)
  6. Authorization (requireStaff / requireAdmin / verifyOwnership)
  7. Business logic
  8. Database query (lib/database/db.ts)
  9. ApiResponse.json(...)
  │
  ▼
instrumentation.ts (server startup only)
  - Initialize/verify DB schema on first boot
  - Read vulnradar_schema_meta; refuse to start if version < required
  - Add api_keys.key_locator column if missing (v2.3.x delta)
```

```text
On push to main / PR
  ├── Lint (ESLint 9, flat config in eslint.config.mjs)
  ├── Typecheck (tsc --noEmit, hard gate)
  ├── Test (vitest run)
  ├── Format check (prettier --check)
  └── Build (next build)

On tag v*
  └── Docker publish (ghcr.io/<value>/${`<repo>
```

## Developers
Route: /docs/developers

### Sections
- **Overview** (`#overview`)
- **Finding Types API** (`#finding-types`)
- **Building SDKs** (`#building-sdks`)
- **Development Guide** (`#development`)
- **Prerequisites** (`#prerequisites`)
- **Node Version Policy** (`#node-version-policy`)
- **Quick Start** (`#quick-start`)
- **Scripts** (`#scripts`)
- **Linting** (`#linting`)
- **Type Checking** (`#typecheck`)
- **Commit Conventions** (`#commits`)
- **Pull Request Process** (`#pull-requests`)
- **Project Structure** (`#structure`)
- **Common Pitfalls** (`#pitfalls`)
- **Debugging** (`#debugging`)
- **Contributing** (`#contributing`)

### Callouts
> **INFO: A Python SDK already exists**
> pip install vulnradar wraps this API with
typed response models and a proper exception hierarchy. Source and
usage docs:{" "}

github.com/VulnRadar/Python-SDK

. Building one in another language? Open an issue on GitHub with a
link and we will list it here. Requirements: GPL-3.0 compatible
license, 

> **WARNING: Node 22 is required, not just recommended**
> The engines field in{" "}
package.json is{" "}
{ "node": ">=22.0.0" }. There is no
fallback to Node 20: the Dockerfile builds and runs on{" "}
node:22.11.0-alpine, and CI runs the full
lint, typecheck, test, and build matrix on Node 22 only. Match that
locally.

> **WARNING: We will ask you to switch first**
> Bug reports filed against Node 20 or earlier get closed with a
request to reproduce on 22 before we look further. If a real bug
exists, it reproduces on 22 too, so open it there directly and save
a round trip.

### Headings
- SDK Checklist
- Open source
- Request
- Response
- Response fields
- 1. Authentication
- 2. Base URL
- 3. Core endpoints
- 4. Error handling

### Notes
- This page covers two audiences:
- Endpoints, request/response shapes, and rate-limit semantics live on the API Reference and Rate Limits pages. The rest of this page is the integration manual.
- The Finding Types endpoint returns the full catalogue of detection checks. Use it to display human-readable titles, categorize findings, or build SDKs that know every check ID ahead of time.
- Backed by lib/scanner/checks-data/*.json, one file per category, for the 652 legacy checks. Adding one of those means editing the JSON for its category and the matching detector in lib/scanner/checks/. The other 43 checks live on a newer PageCheck architecture under lib/scanner/checks/page-checks/ with metadata declared inline; see Architecture .
- When building an SDK for , follow these guidelines.
- All authenticated requests require a Bearer token. Keys are prefixed vr_live_:
- Full request/response shapes: see API Reference .
- Each non-2xx response includes a JSON body with at minimum an error string. Map HTTP status to typed exceptions (400 / 401 / 403 / 404 / 422 / 429 / 500). On 429, honour the Retry-After header and the X-RateLimit-Reset header.
- pip install vulnradar wraps this API with typed response models and a proper exception hierarchy. Source and usage docs: github.com/VulnRadar/Python-SDK . Building one in another language? Open an issue on GitHub with a link and we will list it here. Requirements: GPL-3.0 compatible license, type-safe models, real tests against a live instance.
- Setup for contributing to . Covers local dev, scripts, commit conventions, common pitfalls.

### Code examples
```bash
curl <value>/api/v3/finding-types
```

```json
{
  "success": true,
  "count": 695,
  "data": [
    {
      "id": "hsts-missing",
      "type": "header",
      "title": "HSTS Header Missing",
      "category": "headers",
      "severity": "medium",
      "description": "HTTP Strict Transport Security header is not set."
    },
    {
      "id": "csp-missing",
      "type": "header",
      "title": "Content Security Policy Header Missing",
      "category": "headers",
      "severity": "medium",
      "description": "Content Security Policy header is not set."
    }
  ]
}
```

```text
<value>/api/v3
```

```bash
# nvm / fnm / volta / asdf will all auto-pick this from the repo root
nvm use          # reads .nvmrc (which says 22)

# or install + use explicitly
nvm install 22
nvm use 22
node --version  # should print v22.x.x
```

```bash
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
```

```http
Authorization: Bearer vr_live_xxxxxxxxxxxxxxxxxxxxxxxx
```

```text
# 1. Clone
git clone https://github.com/<value>.git
cd vulnradar.dev

# 2. Install dependencies
npm ci

# 3. Set up environment
cp .env.example .env
# Edit .env: DATABASE_URL, API_KEY_ENCRYPTION_KEY, NEXT_PUBLIC_APP_URL

# 4. Start the dev server (schema auto-creates on first boot)
npm run dev
# → http://localhost:3000
```

```text
npm run lint        # check
npm run lint:fix    # auto-fix
```

---

## Extraction summary (for debugging)

| Page | Hero | Sections | Callouts | Code tabs | Code blocks | Endpoints | Features | Paragraphs | Headings |
|---|---|---|---|---|---|---|---|---|---|
| `/docs` | ✓ | 4 | 0 | 0 | 0 | 0 | 0 | 5 | 1 |
| `/docs/setup` | - | 12 | 5 | 0 | 22 | 0 | 0 | 28 | 30 |
| `/docs/self-hosting` | - | 15 | 3 | 0 | 11 | 0 | 0 | 14 | 2 |
| `/docs/config` | - | 9 | 3 | 0 | 2 | 0 | 0 | 23 | 0 |
| `/docs/api` | - | 7 | 2 | 0 | 3 | 22 | 0 | 6 | 6 |
| `/docs/webhooks` | ✓ | 6 | 0 | 0 | 3 | 0 | 0 | 5 | 5 |
| `/docs/rate-limits` | - | 6 | 5 | 0 | 4 | 0 | 0 | 10 | 3 |
| `/docs/architecture` | - | 5 | 1 | 0 | 4 | 0 | 0 | 8 | 0 |
| `/docs/developers` | - | 16 | 3 | 0 | 9 | 0 | 0 | 20 | 9 |
