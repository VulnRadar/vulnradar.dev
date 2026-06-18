# Configuration

VulnRadar has a two-layer configuration model designed to keep secrets out of source code while making non-secret deployment settings easy to customize for self-hosters.

## Quick Reference

| What you want to change | Where |
|---|---|
| App name, URL, emails, branding | `lib/config/config-values.ts` |
| Rate limits, feature flags, billing plans | `lib/config/config-values.ts` |
| Database URL, API encryption key, Stripe keys | `.env` (or `docker-compose.yml` env) |
| SMTP credentials, Discord OAuth | `.env` |
| Client-side public values (Turnstile site key, app URL) | `.env` as `NEXT_PUBLIC_*` |

## Architecture

```
lib/config/
├── config-values.ts        ← SOURCE OF TRUTH (raw `CONFIG_*` constants)
├── constants.ts            ← Re-exports + derived route/error maps (most app code uses this)
├── client-constants.ts     ← Client-safe subset (no server-only values)
├── config.ts               ← Loader with cache; reads DEFAULT_CONFIG from types/config.ts
└── public-paths.ts         ← Middleware public-path allowlist

lib/types/
└── config.ts                ← Type definitions + DEFAULT_CONFIG (DERIVED from config-values.ts)
```

**Single source of truth:** `lib/config/config-values.ts` exports raw `CONFIG_*` constants. Everything else (types, derived objects, route maps) is built from those constants. Edit `config-values.ts` to customize your deployment.

## Layer 1: Static App Config (`config-values.ts`)

Edit this file when self-hosting. It controls:

### App metadata
- `CONFIG_APP_NAME` — Display name (default: `"VulnRadar"`)
- `CONFIG_APP_SLUG` — URL-safe slug (default: `"vulnradar"`)
- `CONFIG_APP_VERSION` — Public version string
- `CONFIG_APP_URL` — Public URL (default: `"https://vulnradar.dev"`)
- `CONFIG_APP_REPO` — GitHub `owner/repo` (default: `"VulnRadar/vulnradar.dev"`)
- `CONFIG_DISCORD_INVITE_URL` — Discord invite (optional)

### Emails
- `CONFIG_SUPPORT_EMAIL`
- `CONFIG_LEGAL_EMAIL`
- `CONFIG_SECURITY_EMAIL`
- `CONFIG_ENTERPRISE_EMAIL`
- `CONFIG_NOREPLY_EMAIL`

### Branding
- `CONFIG_LOGO_URL` — Path to logo (default: `/favicon-dark.svg`)
- `CONFIG_PRIMARY_COLOR` — Hex color (default: `#6366f1`)
- `CONFIG_FOOTER_TEXT`

### Cookies
- `CONFIG_SESSION_COOKIE_NAME`, `CONFIG_SESSION_MAX_AGE_DAYS`
- `CONFIG_VERSION_COOKIE_NAME`, `CONFIG_VERSION_COOKIE_MAX_AGE_DAYS`
- `CONFIG_DEVICE_TRUST_COOKIE_NAME`, `CONFIG_DEVICE_TRUST_MAX_AGE_DAYS`
- `CONFIG_2FA_PENDING_COOKIE_NAME`, `CONFIG_2FA_PENDING_MAX_AGE_SECONDS`

### Authentication timeouts
- `CONFIG_SESSION_TIMEOUT_DAYS` (7)
- `CONFIG_PASSWORD_RESET_HOURS` (1)
- `CONFIG_EMAIL_VERIFICATION_HOURS` (24)
- `CONFIG_DEVICE_TRUST_DAYS` (30)
- `CONFIG_TOTP_VALIDITY_SECONDS` (30)
- `CONFIG_CLEANUP_INTERVAL_MS` (24h)

### Rate limits
- `CONFIG_RATE_LIMIT_LOGIN_ATTEMPTS` / `_WINDOW_MINUTES`
- `CONFIG_RATE_LIMIT_SIGNUP_ATTEMPTS` / `_WINDOW_MINUTES`
- `CONFIG_RATE_LIMIT_FORGOT_PASSWORD_ATTEMPTS` / `_WINDOW_MINUTES`
- `CONFIG_RATE_LIMIT_API_REQUESTS` / `_WINDOW_MINUTES`
- `CONFIG_RATE_LIMIT_SCAN_REQUESTS` / `_WINDOW_MINUTES`
- `CONFIG_RATE_LIMIT_BULK_SCAN_REQUESTS` / `_WINDOW_MINUTES`

### Scanning
- `CONFIG_MAX_URL_LENGTH` (2048)
- `CONFIG_MAX_URLS_BULK` (100)
- `CONFIG_SCAN_TIMEOUT_SECONDS` (300)
- `CONFIG_BULK_SCAN_TIMEOUT_SECONDS` (1800)
- `CONFIG_DEFAULT_SEVERITY_THRESHOLD` (`"low"`)

### API
- `CONFIG_API_KEY_PREFIX` (`"vr_live_"`)
- `CONFIG_DEFAULT_API_KEY_DAILY_LIMIT` (50)
- `CONFIG_API_CURRENT_VERSION` (`"v2"`)
- `CONFIG_API_SUPPORTED_VERSIONS` (`["v1", "v2"]`)

### Demo mode
- `CONFIG_DEMO_SCAN_LIMIT` (5)
- `CONFIG_DEMO_WINDOW_HOURS` (12)

### Database constraints
- `CONFIG_MAX_EMAIL_LENGTH` (255)
- `CONFIG_MAX_NAME_LENGTH` (255)
- `CONFIG_MAX_DESCRIPTION_LENGTH` (1000)
- `CONFIG_MAX_TEAM_NAME_LENGTH` (255)
- `CONFIG_MAX_TAGS_PER_SCAN` (10)

### Pagination
- `CONFIG_PAGINATION_DEFAULT_PAGE_SIZE` (20)
- `CONFIG_PAGINATION_MAX_PAGE_SIZE` (100)
- `CONFIG_PAGINATION_DEFAULT_PAGE` (1)

### Beta mode
- `CONFIG_BETA_ENABLED` (false)
- `CONFIG_BETA_BANNER_MESSAGE`

### Feature flags
- `CONFIG_FEATURE_DEMO_MODE` (true)
- `CONFIG_FEATURE_TEAMS` (true)
- `CONFIG_FEATURE_API_KEYS` (true)
- `CONFIG_FEATURE_WEBHOOKS` (true)
- `CONFIG_FEATURE_SCHEDULED_SCANS` (true)
- `CONFIG_FEATURE_BULK_SCANS` (true)
- `CONFIG_FEATURE_PDF_REPORTS` (true)
- `CONFIG_FEATURE_EMAIL_NOTIFICATIONS` (true)

### Billing / premium
- `CONFIG_BILLING_ENABLED` (true) — set to `false` to disable all billing features and give all users unlimited access
- `CONFIG_BILLING_FREE_LIMIT` (25) — daily scans on the free plan
- `CONFIG_BILLING_CORE_SUPPORTER_LIMIT` (100)
- `CONFIG_BILLING_PRO_SUPPORTER_LIMIT` (150)
- `CONFIG_BILLING_ELITE_SUPPORTER_LIMIT` (500)
- `CONFIG_BILLING_*_RETENTION` — history retention in days; `-1` = unlimited
- `CONFIG_BILLING_UNLIMITED_MODE_LIMIT` (-1) — used when `CONFIG_BILLING_ENABLED` is `false`

## Layer 2: Runtime Secrets (`.env`)

These MUST NOT be committed. Use `.env` (local dev) or `docker-compose.yml` `environment:` (production).

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | `postgresql://user:pass@host:5432/db` |
| `DATABASE_SSL` | No | `true` / `false` (default `false`) |
| `API_KEY_ENCRYPTION_KEY` | Yes | 64-char hex (32 bytes). Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `NEXT_PUBLIC_APP_URL` | Yes | Public URL (used in emails, OAuth redirects) |
| `STRIPE_SECRET_KEY` | If billing | `sk_test_...` or `sk_live_...` |
| `STRIPE_PUBLISHABLE_KEY` | If billing | `pk_test_...` or `pk_live_...` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | If billing | Same as `STRIPE_PUBLISHABLE_KEY` |
| `STRIPE_WEBHOOK_SECRET` | If billing | Get via `GET /api/v2/stripe/setup-webhook` or manually in Stripe dashboard |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | If email | For transactional email |
| `CONTACT_EMAIL` | If contact form | Where to send contact submissions |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | If Discord OAuth | From Discord Developer Portal |
| `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID` | If auto-join | For auto-joining users to your server |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | If captcha | Cloudflare Turnstile public key |
| `TURNSTILE_SECRET_KEY` | If captcha | Cloudflare Turnstile secret |

The `Dockerfile` provides **dummy placeholders** for all of the above at build time so `npm run build` succeeds without real secrets. Real values are injected at runtime via `docker-compose.yml` or `docker run -e`.

## How the two layers connect

```
┌─────────────────────────────────┐     ┌──────────────────────────┐
│ config-values.ts                │     │ .env (docker secrets)    │
│   CONFIG_BILLING_ENABLED = true │     │   STRIPE_SECRET_KEY=...  │
│   CONFIG_APP_NAME = "AcmeScan" │     │   DATABASE_URL=...        │
│   ...                           │     │                          │
└──────────┬──────────────────────┘     └──────────┬───────────────┘
           │                                       │
           ▼                                       ▼
   ┌───────────────┐                       ┌───────────────┐
   │  types/config │                       │  process.env  │
   │  DEFAULT_CONFIG (typed)              │  (Next.js)    │
   └───────┬───────┘                       └───────┬───────┘
           │                                       │
           └──────────────────┬────────────────────┘
                              ▼
                     ┌──────────────────┐
                     │  constants.ts     │
                     │  APP_NAME, ROUTES │
                     │  API, ERROR_MSGS  │
                     └────────┬─────────┘
                              ▼
                  application code
```

## Self-Hosting Checklist

1. Clone the repo
2. Copy `.env.example` to `.env` and fill in real secrets
3. Edit `lib/config/config-values.ts`:
   - Set `CONFIG_APP_NAME`, `CONFIG_APP_URL`, `CONFIG_APP_REPO` to your deployment
   - Set all `*_EMAIL` constants
   - Set `CONFIG_BILLING_ENABLED = false` (unless you're running the full Stripe flow)
   - Adjust rate limits to suit your load
4. `docker compose up -d`
5. `docker compose exec app node scripts/create-fresh-db.mjs` to initialize the schema
6. (Optional) Create the first admin user, then promote via SQL:
   ```sql
   UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
   ```

## Validation

The `DEFAULT_CONFIG` is constructed at module load time. If a required constant is missing or has the wrong type, the build will fail with a TypeScript error pointing to `lib/types/config.ts`. There is **no runtime fallback** — misconfiguration is caught at build time, not in production.

## Migration from `config.yaml` (deprecated)

Earlier versions read a YAML file at runtime. This was replaced with the build-time TypeScript module in commit `7cf918f` ("feat: rewrite config system to use build-time env injection") to:

- Eliminate YAML parsing fragility
- Provide full TypeScript type-safety
- Allow tree-shaking of unused config
- Make config values visible to the type checker

If you were self-hosting with a `config.yaml`, migrate by copying those values into `lib/config/config-values.ts`.

## See also

- [ARCHITECTURE.md](ARCHITECTURE.md) — overall system architecture
- [DEVELOPMENT.md](DEVELOPMENT.md) — local dev setup
- [SELF_HOSTING.md](SELF_HOSTING.md) — Docker deployment walkthrough
