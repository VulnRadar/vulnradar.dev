# VulnRadar - Web Vulnerability Scanner

VulnRadar is a full-stack web vulnerability scanner built with Next.js 15, React 19, and PostgreSQL. Scan any public URL for 65+ security checks covering HTTP headers, SSL/TLS configuration, content security policies, cookies, server disclosure, DNS, and more.

---

## Features

**Scanning**
- 65+ automated security checks across headers, SSL, CSP, cookies, DNS, and more
- Severity ratings (Critical, High, Medium, Low, Info) with actionable fix guidance
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

Create a `.env.local` file in the project root:

```env
DATABASE_URL=postgresql://vulnradar:yourpassword@localhost:5432/vulnradar
DATABASE_SSL=false
```

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `DATABASE_SSL` | No | Set to `true` if your database requires SSL (e.g., most hosted providers). Defaults to `false`. |
| `SMTP_HOST` | Yes | SMTP server hostname (e.g., `smtp.protonmail.ch`) |
| `SMTP_PORT` | No | SMTP port. Defaults to `587`. |
| `SMTP_USER` | Yes | SMTP username for the noreply account |
| `SMTP_PASS` | Yes | SMTP password / app token for the noreply account |
| `SMTP_FROM` | No | Sender address. Defaults to `SMTP_USER`. (e.g., `noreply@vulnradar.dev`) |
| `SMTP_SUPPORT_USER` | No | SMTP username for support email (used for future contact form) |
| `SMTP_SUPPORT_PASS` | No | SMTP password / app token for the support account |
| `SMTP_SUPPORT_FROM` | No | Support sender address. Defaults to `SMTP_SUPPORT_USER`. |
| `NEXT_PUBLIC_APP_URL` | No | Public URL of your app. Defaults to `https://vulnradar.dev`. Used in email links. |

### Email Addresses

VulnRadar uses the following email addresses:

| Address | Purpose |
|---------|---------|
| `noreply@vulnradar.dev` | Automated emails (password resets, team invites, scan alerts) |
| `support@vulnradar.dev` | User support and general inquiries |
| `security@vulnradar.dev` | Security vulnerability reports (referenced in `security.txt`) |
| `legal@vulnradar.dev` | Legal inquiries (referenced on legal pages) |

Only `noreply@` and `support@` need SMTP credentials. The others are receive-only.

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
│   ├── scanner/                # Scan engine (65+ security checks)
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
| `sessions` | Active login sessions |
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

### Windows: Turbopack junction point error

Next.js 15 uses Webpack by default, so this shouldn't occur. If you see Turbopack errors, ensure your `package.json` scripts are:
```json
"dev": "next dev",
"build": "next build"
```

If you previously ran Next.js 16 with Turbopack and have corrupted symlinks, delete `node_modules`, `.next`, and any broken files, then reinstall:
```powershell
Remove-Item -Recurse -Force node_modules, .next
npm install
```

### Database connection issues

- Verify your `DATABASE_URL` is correct and the database is running
- For hosted databases, set `DATABASE_SSL=true`
- Check that your IP is allowed in the database firewall rules

### `instrumentationHook` warning

If you see "Unrecognized key: instrumentationHook", remove it from `next.config.mjs`. Next.js 15.3+ auto-detects `instrumentation.ts` without this config key.

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
