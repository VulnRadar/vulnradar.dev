# VulnRadar Public Docs — AI Knowledge

_Auto-compiled from `app/docs/*/page.tsx` on 2026-06-30._

This file is consumed by the AI system prompt at runtime so the
assistant can answer questions about every public docs page. Edit
the source pages; this file regenerates on `npm run build` and
`npm run dev`.

---

## Overview
Route: /docs

# Documentation
Complete guide to using for web vulnerability scanning. Integrate the API, self-host the platform, or extend the engine.

### Sections
- **Platform Features** (`#features`)
- **Quick Start** (`#quick-start`)
- **Documentation** (`#documentation`)
- **Support** (`#support`)

### Headings
- {section.title}
- Need help?

### Notes
- Reach out via the contact form or open an issue on GitHub.

## Setup
Route: /docs/setup

# Setup Guide
Install and configure locally or in production. Three deployment paths: local Node, Docker, or a generic Node host.

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
- instrumentation.ts runs CREATE TABLE IF NOT EXISTS for every table on first server boot. No manual migration is required for a fresh database. For databases upgraded from an older schema, see Schema Migration.
- Secrets and per-deployment overrides go in .env (or .env.local for local-only overrides; Next.js loads .env.local with higher precedence than .env ).
- Open .env and fill in at minimum:
- Optional: SMTP, Stripe, Discord, Turnstile. Full reference on the Configuration page.
- .env and .env.local are git-ignored by default. If you fork the repo, double-check .gitignore.
- Non-secret deployment tunables live in lib/config/config-values.ts. Edit that file before the first build. Restart the process to pick up changes.
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

# Self-Hosting
VulnRadar is GPL-3.0 and can be self-hosted with Docker. This guide walks through a production deployment end to end.

### Sections
- **Overview** (`#overview`)
- **Hardware Requirements** (`#hardware`)
- **Prerequisites** (`#prerequisites`)
- **Clone and Configure** (`#clone`)
- **Create .env** (`#env`)
- **docker-compose** (`#docker`)
- **Start the Stack** (`#start`)
- **First Admin User** (`#admin`)
- **TLS (Reverse Proxy)** (`#tls`)
- **Configure Stripe Webhook (If Billing)** (`#stripe`)
- **Backups** (`#backups`)
- **Updates** (`#updates`)
- **Troubleshooting** (`#troubleshooting`)
- **Security Checklist** (`#security`)

### Headings
- Option A: Stripe dashboard
- Option B: auto-setup endpoint

### Notes
- The fastest path to running VulnRadar yourself. Assumes a single Linux server with Docker. For Kubernetes, multi-region, or bare-metal setups, adapt accordingly.
- Edit lib/config/config-values.ts to set:
- If you don&apos;t want billing features, set:
- Full reference on the Configuration page.
- On boot, instrumentation.ts runs CREATE TABLE IF NOT EXISTS for every table. The meta row in vulnradar_schema_meta is written on the first successful migration. Look for Database schema verified successfully in the logs.
- VulnRadar does not terminate TLS itself. Put a reverse proxy in front. Minimal Caddy config:
- Caddy auto-provisions a Let&apos;s Encrypt certificate.
- For nginx, see the official nginx + Next.js guide .
- GET /api/v3/stripe/setup-webhook registers the webhook in Stripe and returns the signing secret — but only when the secret is not yet stored. After first run it returns with no secret. The endpoint requires an admin session unless the webhook is already configured.
- Automate with cron + docker compose exec, or use a managed Postgres with built-in automated backups.

### Code examples
```typescript
git clone https://github.com/VulnRadar/vulnradar.dev.git
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

## Configuration
Route: /docs/config

# Configuration
VulnRadar uses a two-layer config model: non-secret tunables live in TypeScript source, secrets live in your environment. Here

### Sections
- **Overview** (`#overview`)
- **Quick Reference** (`#quick-reference`)
- **Architecture** (`#architecture`)
- **Layer 1: Static App Config** (`#layer-1`)
- **Layer 2: Runtime Secrets** (`#layer-2`)
- **Self-Hosting Checklist** (`#checklist`)
- **Validation** (`#validation`)

### Notes
- VulnRadar has a two-layer configuration model designed to keep secrets out of source code while making non-secret deployment settings easy to customize for self-hosters.
- Single source of truth: lib/config/config-values.ts exports raw CONFIG_* constants. Everything else (types, derived objects, route maps) is built from those constants. Edit config-values.ts to customize your deployment.
- Edit lib/config/config-values.ts when self-hosting. These values are baked into the build at compile time. No runtime reload — restart the process to pick up changes.
- All values are per-IP unless noted. The window is in minutes. Internally lib/config/constants.ts multiplies by 60 for the per-second window.
- The /demo page lets unauthenticated visitors run scans. Rate-limited per IP.
- Disable demo mode entirely with CONFIG_FEATURE_DEMO_MODE = false.
- Plan catalogs (limits per plan) live in lib/billing/catalog.ts. The values below only configure the upper bounds and the retention window.
- All secrets live in .env (or in docker-compose.yml as the environment block). Runtime validation is performed by lib/config/env.ts using Zod and called from instrumentation.ts at server startup. A missing or malformed required variable crashes the process before it accepts any requests.
- Required for password reset, email verification, billing verify, and webhook lifecycle emails. Without SMTP configured, those flows fail silently.
- If Stripe keys are unset, billing endpoints return 503.

## API Reference
Route: /docs/api

# API Reference
Complete documentation for the REST API. Integrate automated vulnerability scanning into your applications, CI/CD pipelines, or custom security tools.

### Sections
- **Overview** (`#overview`)
- **Authentication** (`#authentication`)
- **Endpoints** (`#endpoints`)
- **Code Examples** (`#code-examples`)
- **Rate Limiting** (`#rate-limiting`)
- **Error Handling** (`#error-handling`)
- **Best Practices** (`#best-practices`)

### Headings
- Bearer token
- Getting an API key
- Create a scan
- List scan history
- Get scan details
- Daily quotas by plan
- Response headers
- 429 response
- {error.title}
- {practice.title}

### Notes
- All endpoints live under /api/v3/. Authentication is either a session cookie or a Bearer API key with the vr_live_ prefix (default CONFIG_API_KEY_PREFIX).
- Include your API key in the Authorization header:
- Never share API keys or commit them to version control. Each account is limited to 3 active API keys. Rotate via POST /api/v3/keys/[id]/rotate.
- Reference implementations in three languages.
- Per-API-key daily quota plus per-IP burst limits on auth endpoints. Full reference on the Rate Limits page.
- Session-cookie scans use a separate counter (per-user daily quota). API-key scans use a per-key counter. Both share the same X-RateLimit-* headers but the Reset semantics differ — see the Rate Limits page.
- Standard HTTP status codes. Error responses include a JSON body with at minimum an error string.

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
Receive real-time notifications when scans complete. auto-detects the platform type from the URL and formats the payload accordingly.

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
- Webhooks fire after every successful scan triggered by a session or an API key. Delivery is best-effort: one POST per webhook with a 10-second timeout. Failures are logged but not retried. The server enforces a per-user cap of 5 webhooks.
- detects the platform by matching the URL pattern. Override with the type body field if needed.
- Manage webhooks through these session-authenticated endpoints (the /api/v3/webhooks family requires a logged-in user; API keys are not accepted).
- Each platform receives a tailored payload. The summary object is the same in all three: critical, high, medium, low, info, total.
- Embed color: 0xef4444 (red, any critical), 0xf97316 (orange, any high), 0xeab308 (yellow, any medium), 0x22c55e (green, otherwise).
- Delivered with Content-Type: application/json and User-Agent: VulnRadar-Webhook/1.0.

### Code examples
```json
{
  "embeds": [
    {
      "title": "VulnRadar Scan Complete",
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
      "footer": { "text": "VulnRadar Security Scanner" },
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
        "text": "VulnRadar Scan Complete"
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
        { "type": "mrkdwn", "text": "Sent by VulnRadar Security Scanner" }
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

# Rate Limits
applies rate limits at two levels: per-IP limits on auth endpoints and per-user/per-key daily quotas on scan endpoints.

### Sections
- **Overview** (`#overview`)
- **Daily Quotas by Plan** (`#limits-by-plan`)
- **Per-IP Limits** (`#ip-rate-limits`)
- **Rate Limit Headers** (`#headers`)
- **Handling 429 Responses** (`#handling`)
- **Best Practices** (`#best-practices`)

### Headings
- 429 response
- Exponential backoff (TypeScript)
- Python
- {item.title}

### Notes
- Two separate limit systems protect the platform. They are enforced in different places and behave differently on overflow.
- Two separate counters: scans/day enforced for session-authenticated users, and API requests/day enforced for Bearer-authenticated API keys.
- Daily quotas are defined in lib/billing/catalog.ts (one entry per plan: dailyScans and apiRequestsPerDay). New API keys default to CONFIG_DEFAULT_API_KEY_DAILY_LIMIT = 50 ( lib/config/config-values.ts).
- Users with role admin, moderator, or support are exempt from daily quotas ( daily-limits.ts returns Infinity).
- IP-based rate limits are configured in lib/config/config-values.ts as CONFIG_RATE_LIMIT_*_ATTEMPTS + _WINDOW_MINUTES pairs. The window is converted to seconds at boot.
- For Bearer-authenticated deep crawls ( /api/v3/scan/crawl ), the call itself counts as 1 daily quota unit. For session-authenticated crawls, each scanned page counts as 1 unit (10 pages = 10 quota units). Discovery ( /api/v3/scan/crawl/discover) counts as 1 unit regardless of how many URLs it returns.
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

# Architecture
A tour of the VulnRadar codebase: how the pieces fit together, where config lives, and how a request flows from browser to database.

### Sections
- **Overview** (`#overview`)
- **Project Layout** (`#layout`)
- **Key Subsystems** (`#subsystems`)
- **Request Lifecycle** (`#lifecycle`)
- **CI/CD Pipeline** (`#cicd`)

### Notes
- VulnRadar is a Next.js 15 App Router application with a single-process deployment. The runtime stack is deliberately small: one Next.js process + one PostgreSQL database. No Redis, no message broker, no separate API server. Everything you need to understand lives in this repository.
- See the Configuration page for full details. Flow:
- The detection engine is split across per-category files:
- Categories (lib/scanner/types.ts, 12 total): headers, ssl, tls, content, cookies, configuration, information-disclosure, dns, email, api, code, secrets-extended. Severities: info, low, medium, high, critical.
- Service probes (lib/scanner/protocols/banner.ts) open a bounded TCP socket to the target hostname on a well-known or user-supplied port, read the greeting, and report version disclosure + reachability. The 6 supported probes are: ssh, smtp, imap, pop3, ftp, mongodb. Probes are independent of the URL scheme — opt into "probes": ["ssh:2222"] from the dashboard without constructing ssh://host.
- REST v2 is the current API. v1 is deprecated with sunset 2026-12-01 (see lib/api/api-deprecation.ts). Each route handler:
- Role hierarchy (defined in lib/config/client-constants.ts):
- All four checks (lint, typecheck, test, build) run on Node 22 LTS in CI. See .github/workflows/.

### Code examples
```text
vulnradar.dev/
├── app/                          # Next.js App Router
│   ├── (root pages)              # /, /landing, /pricing, /demo, /contact, /donate
│   ├── admin/                    # Admin dashboard (staff-gated)
│   ├── api/v2/                   # REST API v2 (and /api/security-txt, /api/version)
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
│   ├── features/                 # Feature gating (beta, etc.)
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

## Developers
Route: /docs/developers

# Developer Documentation
Build SDKs, integrations, and tools for . Everything you need to programmatically interact with the security scanning platform.

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
- Backed by lib/scanner/checks-data.json. Source of truth for finding metadata; update that file when adding a new check.
- When building an SDK for , follow these guidelines.
- All authenticated requests require a Bearer token. Keys are prefixed vr_live_:
- Full request/response shapes: see API Reference.
- Each non-2xx response includes a JSON body with at minimum an error string. Map HTTP status to typed exceptions (400 / 401 / 403 / 404 / 422 / 429 / 500). On 429, honour the Retry-After header and the X-RateLimit-Reset header.
- No official SDKs are published at this time. A community SDK in any language is welcome — open an issue on GitHub with a link and we will list it here. Requirements: GPL-3.0 compatible license, type-safe models, real tests against a live instance.
- Setup for contributing to VulnRadar. Covers local dev, scripts, commit conventions, common pitfalls.

### Code examples
```bash
curl <value>/api/v3/finding-types
```

```json
{
  "success": true,
  "count": 709,
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
<value>/api/v2
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
