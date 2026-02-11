# VulnRadar - Web Vulnerability Scanner

VulnRadar is a full-stack web vulnerability scanner built with Next.js 15, React 19, and PostgreSQL. Scan any public URL for **75+ security checks** covering HTTP headers, SSL/TLS configuration, content security policies, cookies, injection vulnerabilities, authentication issues, and more.

**Version 1.2.0** - Latest release with comprehensive OWASP Top 10 coverage and intelligent false-positive reduction.

---

## Features

**Scanning**
- **75+ automated security checks** including SQL injection, command injection, XXE, SSRF, path traversal, and more
- Framework-aware detection (Next.js, React, Vue, Angular) with intelligent false-positive filtering
- Severity ratings (Critical, High, Medium, Low, Info) with actionable fix guidance
- Safety rating indicator (Safe to View / View with Caution / Not Safe to View)
- Bulk scanning -- scan up to 10 URLs at once
- Scheduled scans on daily, weekly, or monthly intervals
- Scan comparison -- side-by-side diff of two scan results over time
- Self-scan demo -- try VulnRadar on itself with no account required

**Reporting**
- Export scan results as PDF reports or raw JSON
- Shareable scan links for client reports
- Scan history with search, filtering, and custom tags

**Authentication & Security**
- Email/password authentication with bcrypt hashing
- Two-factor authentication (TOTP) with backup codes
- Secure password reset flow with time-limited tokens
- Rate limiting on login, signup, scans, and API endpoints
- Session management with HTTP-only cookies

**Teams & Collaboration**
- Create teams with role-based access (owner, admin, viewer)
- Invite members via email with expiring invite tokens
- Shared scan history within teams

**API**
- REST API with API key authentication
- Generate and manage API keys with configurable daily rate limits
- Webhook integrations (Discord, Slack, generic HTTP)

**Admin**
- Admin dashboard with user management
- Audit logging for admin actions
- Session and API key revocation
- User enable/disable controls

**Other**
- Dark mode by default (with light mode toggle)
- Interactive onboarding tour for new users
- Full legal pages (Terms, Privacy, Acceptable Use, Disclaimer)
- Contact/support page
- Changelog

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Next.js 15](https://nextjs.org/) (App Router, Webpack) |
| Frontend | [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/) |
| Styling | [Tailwind CSS](https://tailwindcss.com/), [shadcn/ui](https://ui.shadcn.com/) |
| Database | [PostgreSQL](https://www.postgresql.org/) via [node-postgres (pg)](https://node-postgres.com/) |
| Charts | [Recharts](https://recharts.org/) |
| PDF Export | [jsPDF](https://github.com/parallax/jsPDF) + [jspdf-autotable](https://github.com/simonbengtsson/jsPDF-AutoTable) |
| Data Fetching | [SWR](https://swr.vercel.app/) |

---

## Prerequisites

- **Node.js** 18.17 or later
- **npm** 9 or later
- **PostgreSQL** 14 or later (local, Docker, or hosted)

---

## Getting Started

> **📋 Quick Setup:** See [SETUP.md](SETUP.md) for a step-by-step checklist with all required services and configurations.

### 1. Clone the repository

```bash
git clone https://github.com/your-username/vulnradar.git
cd vulnradar
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up PostgreSQL

You need a running PostgreSQL instance. A few options:

**Option A: Local PostgreSQL**

If you have PostgreSQL installed locally:
```bash
createdb vulnradar
```

**Option B: Docker**

```bash
docker run -d \
  --name vulnradar-db \
  -e POSTGRES_USER=vulnradar \
  -e POSTGRES_PASSWORD=yourpassword \
  -e POSTGRES_DB=vulnradar \
  -p 5432:5432 \
  postgres:16
```

**Option C: Hosted (Neon, Supabase, Railway, etc.)**

Use the connection string provided by your hosting provider.

### 4. Configure environment variables

Copy the example environment file and configure it:

```bash
cp .env.example .env.local
```

Then edit `.env.local` with your actual values:

```env
# Database
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
TURNSTILE_SECRET_KEY=your-turnstile-secret-key
```

| Variable | Required | Description |
|----------|----------|-------------|
| **Database** | | |
| `DATABASE_URL` | ✅ Yes | PostgreSQL connection string in format: `postgresql://user:password@host:port/database` |
| `DATABASE_SSL` | No | Set to `true` if your database requires SSL (e.g., hosted providers like Neon, Supabase). Defaults to `false`. |
| **Email (SMTP)** | | |
| `SMTP_HOST` | ✅ Yes | SMTP server hostname (e.g., `smtp.protonmail.ch`, `smtp.gmail.com`, `smtp.sendgrid.net`) |
| `SMTP_PORT` | No | SMTP port. Use `587` for TLS (recommended) or `465` for SSL. Defaults to `587`. |
| `SMTP_USER` | ✅ Yes | SMTP username/email for sending automated emails (password resets, team invites, alerts) |
| `SMTP_PASS` | ✅ Yes | SMTP password or app-specific token. For ProtonMail, use Bridge password or app password. |
| `SMTP_FROM` | ✅ Yes | Email address shown as sender for automated emails (e.g., `noreply@yourdomain.com`) |
| **Contact Form** | | |
| `CONTACT_EMAIL` | ✅ Yes | Email address where contact form submissions are sent (e.g., `support@yourdomain.com`) |
| **Cloudflare Turnstile** | | |
| `TURNSTILE_SITE_KEY` | ✅ Yes | Cloudflare Turnstile site key (public). Get from [Cloudflare Dashboard](https://dash.cloudflare.com/?to=/:account/turnstile) |
| `TURNSTILE_SECRET_KEY` | ✅ Yes | Cloudflare Turnstile secret key (private). Get from Cloudflare Dashboard. |
| **Optional** | | |
| `NEXT_PUBLIC_APP_URL` | No | Public URL of your app (e.g., `https://vulnradar.dev`). Used in email links. Defaults to production URL. |

### Email Configuration

VulnRadar sends emails for:
- **Password Resets** - Secure token-based password recovery
- **Team Invitations** - Invite users to join your team
- **Scan Alerts** - Scheduled scan notifications (future feature)

**Recommended SMTP Providers:**
- [ProtonMail](https://proton.me/mail) - Privacy-focused, requires Bridge or app password
- [SendGrid](https://sendgrid.com/) - Free tier: 100 emails/day
- [Mailgun](https://www.mailgun.com/) - Free tier: 5,000 emails/month
- [Gmail](https://mail.google.com/) - Use app passwords (2FA required)

### Cloudflare Turnstile Setup

Turnstile is Cloudflare's privacy-friendly CAPTCHA alternative, used on the contact form to prevent spam.

1. Go to [Cloudflare Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile)
2. Create a new site
3. Choose **"Managed"** challenge mode
4. Copy the **Site Key** → `TURNSTILE_SITE_KEY`
5. Copy the **Secret Key** → `TURNSTILE_SECRET_KEY`

**Free forever** - No credit card required.

> **Note:** The database schema is created automatically on first startup via the instrumentation hook. No manual migrations needed.

### 5. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 6. Create your first account

1. Go to `/signup` and create an account
2. To make yourself an admin, connect to your database and run:
   ```sql
   UPDATE users SET is_admin = true WHERE email = 'your@email.com';
   ```

---

## Project Structure

```
vulnradar/
├── app/
│   ├── api/                    # API routes
│   │   ├── auth/               # Authentication (login, signup, 2FA, password reset)
│   │   ├── admin/              # Admin dashboard API
│   │   ├── scan/               # Scan engine & bulk scanning
│   │   ├── history/            # Scan history & sharing
│   │   ├── keys/               # API key management
│   │   ├── teams/              # Teams & invitations
│   │   ├── webhooks/           # Webhook management
│   │   ├── schedules/          # Scheduled scans
│   │   └── compare/            # Scan comparison
│   ├── admin/                  # Admin dashboard page
│   ├── history/                # Scan history page
│   ├── teams/                  # Teams management pages
│   ├── profile/                # User profile & settings
│   ├── demo/                   # Self-scan demo (no auth required)
│   ├── docs/                   # API documentation
│   ├── changelog/              # Version changelog
│   ├── legal/                  # Terms, privacy, disclaimer, acceptable use
│   └── page.tsx                # Homepage / scanner
├── components/
│   ├── scanner/                # Scanner-specific components (header, footer, results)
│   └── ui/                     # shadcn/ui components
├── lib/
│   ├── scanner/                # Scan engine (75+ security checks)
│   │   ├── checks.ts           # All security check implementations
│   │   └── types.ts            # TypeScript types for scan results
│   ├── db.ts                   # PostgreSQL connection pool
│   ├── auth.ts                 # Session management utilities
│   ├── email.ts                # Email sending utility (nodemailer + templates)
│   └── rate-limit.ts           # Rate limiting utility
├── instrumentation.ts          # Auto-migration on startup
└── middleware.ts                # Auth protection & security headers
```

---

## Database

The database schema is **automatically created and migrated** when the server starts via `instrumentation.ts`. You do not need to run any migration scripts manually.

### Tables

| Table | Purpose |
|-------|---------|
| `users` | User accounts, passwords, 2FA settings, admin flag |
| `sessions` | Active login sessions with IP address and user agent tracking |
| `api_keys` | API keys for programmatic access |
| `api_usage` | API key usage tracking |
| `scan_history` | All scan results with findings |
| `scan_tags` | Custom tags on scans |
| `scheduled_scans` | Recurring scan configurations |
| `webhooks` | Webhook integrations per user |
| `teams` | Team/organization records |
| `team_members` | Team membership with roles |
| `team_invites` | Pending team invitations |
| `password_reset_tokens` | Password reset tokens |
| `rate_limits` | Rate limiting state |
| `data_requests` | GDPR data export requests |
| `admin_audit_log` | Admin action audit trail |

---

## API Usage

### Authentication

All API endpoints (except `/api/scan` with API key auth) require a session cookie obtained by logging in via `/api/auth/login`.

### API Key Authentication

For programmatic access, generate an API key from your profile page, then:

```bash
curl -X POST https://your-domain.com/api/scan \
  -H "Authorization: Bearer vr_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

---

## Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Import the repository on [Vercel](https://vercel.com)
3. Add environment variables in the Vercel dashboard:
   - `DATABASE_URL` -- your PostgreSQL connection string
   - `DATABASE_SSL` -- set to `true` for hosted databases
4. Deploy

### Self-Hosted

```bash
npm run build
npm start
```

The production server runs on port 3000 by default. Set the `PORT` environment variable to change it.

---

## Security Headers

VulnRadar ships with hardened security headers configured in both `next.config.mjs` and `middleware.ts`:

- Content-Security-Policy (with frame-ancestors 'none')
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy (camera, microphone, geolocation disabled)
- Strict-Transport-Security (HSTS with 2-year max-age)
- Cross-Origin-Opener-Policy / Cross-Origin-Resource-Policy
- X-Powered-By header removed

---

## Troubleshooting

### Database connection issues

**Problem:** Can't connect to PostgreSQL

**Solutions:**
- Verify your `DATABASE_URL` format: `postgresql://user:password@host:port/database`
- Check the database is running: `psql -U vulnradar -d vulnradar` (local) or test connection with your database client
- For hosted databases (Neon, Supabase, Railway), set `DATABASE_SSL=true`
- Check firewall rules allow connections from your IP address
- Verify the database user has sufficient permissions

**Problem:** "Database schema not initialized" 

**Solution:** The schema is auto-created on first startup. If it fails:
1. Check the logs for errors
2. Manually run the schema from `instrumentation.ts` or use a database client
3. Ensure the database user has `CREATE TABLE` permissions

### Email (SMTP) issues

**Problem:** Emails not sending / "Failed to send email"

**Solutions:**
- **ProtonMail:** Must use ProtonMail Bridge or generate an app-specific password
- **Gmail:** Enable "2-Step Verification" then create an [App Password](https://myaccount.google.com/apppasswords)
- **SMTP credentials:** Verify `SMTP_USER` and `SMTP_PASS` are correct
- **Port:** Use `587` (TLS) not `465` (SSL) for most providers
- **Firewall:** Some networks block port 587 - test with `telnet smtp.protonmail.ch 587`

**Problem:** Contact form submissions fail

**Solution:** Verify `CONTACT_EMAIL` is set to a valid email address where you want to receive messages

### Turnstile (CAPTCHA) issues

**Problem:** Turnstile widget doesn't appear on contact form

**Solutions:**
- Verify `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are set in `.env.local`
- Check Cloudflare Dashboard that the site key is for the correct domain
- For localhost testing, add `localhost` to allowed domains in Turnstile settings
- Clear browser cache and hard refresh (Ctrl+Shift+R / Cmd+Shift+R)

**Problem:** "Turnstile verification failed"

**Solutions:**
- Check `TURNSTILE_SECRET_KEY` matches the site in Cloudflare Dashboard
- Verify the domain in Turnstile settings matches your deployment URL
- Try switching challenge mode from "Managed" to "Non-Interactive" in Cloudflare

### Environment variables not loading

**Problem:** App can't find environment variables

**Solutions:**
- Ensure file is named `.env.local` (not `.env` or `.env.development`)
- Restart the dev server after changing `.env.local`
- Variables starting with `NEXT_PUBLIC_` are exposed to the browser; others are server-only
- For Vercel deployments, add variables in the dashboard (Settings → Environment Variables)

### Windows: Turbopack junction point error

Next.js 15 uses Webpack by default, so this shouldn't occur. If you see Turbopack errors:

```json
// package.json - ensure these scripts:
"dev": "next dev",
"build": "next build"
```

If you have corrupted symlinks from Next.js 16+:
```powershell
Remove-Item -Recurse -Force node_modules, .next
npm install
```

### `instrumentationHook` warning

If you see "Unrecognized key: instrumentationHook", remove it from `next.config.mjs`. Next.js 15.3+ auto-detects `instrumentation.ts` without this config key.

### Admin access

**Problem:** Can't access `/admin` dashboard

**Solution:** Connect to your database and run:
```sql
UPDATE users SET is_admin = true WHERE email = 'your@email.com';
```

Then log out and log back in.

### Build errors

**Problem:** TypeScript compilation errors

**Solutions:**
- Run `npm install` to ensure all dependencies are installed
- Delete `.next` folder and rebuild: `rm -rf .next && npm run build`
- Check Node.js version: `node --version` (must be 18.17+)

---

## License

MIT

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -m 'Add your feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request
