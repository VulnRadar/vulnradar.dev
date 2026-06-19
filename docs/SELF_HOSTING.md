# Self-Hosting

VulnRadar is GPL-3.0 and can be self-hosted with Docker. This guide walks through a
production deployment.

## Hardware Requirements

| Workload                 | CPU     | RAM   | Disk    |
| ------------------------ | ------- | ----- | ------- |
| Demo / personal use      | 1 vCPU  | 1 GB  | 20 GB   |
| Small team (10 users)    | 2 vCPU  | 2 GB  | 50 GB   |
| Public SaaS (100s users) | 4+ vCPU | 8+ GB | 200+ GB |

A managed PostgreSQL (Neon, Supabase, RDS) is recommended over running your own DB.

## 1. Prerequisites

- Linux server (Ubuntu 22.04 LTS recommended) or any host with Docker
- Docker 24+ and Docker Compose v2
- A domain name with DNS pointing to the server
- (Production) A reverse proxy: Caddy, Traefik, or nginx with TLS

## 2. Clone and Configure

```bash
git clone https://github.com/VulnRadar/vulnradar.dev.git
cd vulnradar.dev

# Generate a 32-byte API encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# → paste into API_KEY_ENCRYPTION_KEY
```

Edit **`lib/config/config-values.ts`** to set:

```ts
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

If you don't want billing features, set:

```ts
export const CONFIG_BILLING_ENABLED = false;
```

## 3. Create `.env`

```bash
cp .env.example .env
```

Fill in real values:

```bash
# Required
DATABASE_URL=postgresql://vulnradar:STRONG_PASSWORD@postgres:5432/vulnradar
DATABASE_SSL=false
API_KEY_ENCRYPTION_KEY=<paste your 64-char hex from step 2>
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

# Optional: Cloudflare Turnstile captcha
NEXT_PUBLIC_TURNSTILE_SITE_KEY=...
TURNSTILE_SECRET_KEY=...

# Optional: Stripe billing (only if CONFIG_BILLING_ENABLED=true)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

## 4. Configure `docker-compose.yml`

The default `docker-compose.yml` works out of the box. The app reads `.env` from the
host (via `env_file`). For production, set secrets via Docker secrets or your secret
manager instead of a `.env` file on disk.

## 5. Start the Stack

```bash
docker compose up -d
docker compose logs -f app   # watch startup
```

Look for:

```
✓ Database initialized
✓ Listening on http://0.0.0.0:3000
```

## 6. Initialize the Schema

```bash
docker compose exec app node scripts/create-fresh-db.mjs
```

This is idempotent (CREATE TABLE IF NOT EXISTS).

## 7. Create the First Admin User

1. Visit `https://scanner.yourdomain.com/signup` and create an account
2. From your DB client, promote the user:
   ```sql
   UPDATE users
   SET role = 'admin'
   WHERE email = 'you@yourdomain.com';
   ```
3. Sign out and back in. The `/admin` route is now accessible.

## 8. Set Up TLS (Reverse Proxy)

VulnRadar does not terminate TLS itself. Put a reverse proxy in front. Minimal
Caddy config:

```caddyfile
scanner.yourdomain.com {
    reverse_proxy localhost:3000
    encode zstd gzip
}
```

Caddy auto-provisions a Let's Encrypt cert.

For nginx, see the [official nginx + Next.js guide](https://nextjs.org/docs/app/building-your-application/deploying#nginx).

## 9. Configure Stripe Webhook (If Billing)

If you set `CONFIG_BILLING_ENABLED = true`:

1. In your Stripe dashboard, create a webhook:
   - URL: `https://scanner.yourdomain.com/api/v2/webhooks/stripe`
   - Events: `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`,
     `invoice.payment_succeeded`, `invoice.payment_failed`
2. Copy the signing secret into `STRIPE_WEBHOOK_SECRET` in `.env`
3. Restart: `docker compose restart app`

Alternatively, use the auto-setup endpoint:

```bash
curl https://scanner.yourdomain.com/api/v2/stripe/setup-webhook
# returns the webhookSecret to paste into .env
```

## 10. Backups

```bash
# Database
docker compose exec postgres pg_dump -U vulnradar vulnradar > backup-$(date +%F).sql

# Restore
cat backup-2026-06-18.sql | docker compose exec -T postgres psql -U vulnradar vulnradar
```

Automate with cron + `docker compose exec`. Or use a managed Postgres with
automated backups.

## 11. Updates

```bash
cd vulnradar.dev
git pull
docker compose build app
docker compose up -d
```

Watch logs for migrations or new env vars.

## Troubleshooting

| Symptom                                            | Cause                             | Fix                                                |
| -------------------------------------------------- | --------------------------------- | -------------------------------------------------- |
| `Database initialized` then crash                  | DB not reachable                  | Check `DATABASE_URL` and `DATABASE_SSL`            |
| Build fails with "API_KEY_ENCRYPTION_KEY required" | Missing env var at build          | Dockerfile provides placeholder; check runtime env |
| `Config validation failed at runtime`              | Misconfigured `config-values.ts`  | Check TypeScript errors: `npm run typecheck`       |
| 502 from reverse proxy                             | App not listening on 0.0.0.0:3000 | Check `APP_PORT` env var (default 3000)            |
| Stripe webhook 400s                                | Wrong signing secret              | Re-copy from Stripe dashboard, restart app         |

## Security Checklist

- [ ] TLS via reverse proxy (Caddy/Traefik/nginx)
- [ ] Strong `API_KEY_ENCRYPTION_KEY` (32 random bytes)
- [ ] Strong `POSTGRES_PASSWORD`
- [ ] SMTP credentials use app-specific password (not account password)
- [ ] Stripe restricted keys (only needed permissions)
- [ ] Discord OAuth uses HTTPS redirect URI
- [ ] Backups automated daily
- [ ] `CONFIG_BILLING_ENABLED = false` if you don't want paid tiers
- [ ] `https://yourdomain.com/.well-known/security.txt` reachable
- [ ] Cloudflare Turnstile enabled to prevent signup abuse

## See also

- [CONFIG.md](CONFIG.md) — full config reference
- [ARCHITECTURE.md](ARCHITECTURE.md) — system architecture
- [DEVELOPMENT.md](DEVELOPMENT.md) — local development
- [SECURITY.md](../SECURITY.md) — security policy
