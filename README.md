# VulnRadar

Professional web vulnerability scanner. Completely free, forever.

**310+ security checks** for SQL injection, XSS, CSRF, authentication issues, and more. Scan any public URL in seconds.

[![Secured by VulnRadar](https://vulnradar.dev/api/v2/badge/9fd91d32fb141abc2a71475b8e880cd550e8f613c5134c26519f066c4cd5fdb9)](https://vulnradar.dev/shared/9fd91d32fb141abc2a71475b8e880cd550e8f613c5134c26519f066c4cd5fdb9)

## Quick Links

- **[Documentation](https://vulnradar.dev/docs)** - API reference, setup guide, and guides
- **[GitHub](https://github.com/VulnRadar/vulnradar.dev)** - Source code and contribution guidelines
- **[Report a Bug](https://github.com/VulnRadar/vulnradar.dev/issues)** - Help us improve
- **[Security Advisories](https://github.com/VulnRadar/vulnradar.dev/security/advisories/new)** - Privately report a vulnerability

## Features

- 310+ automated security checks with minimal false positives
- Real-time scanning with detailed reports
- Export to PDF or JSON
- Scheduled scans and webhooks
- Two-factor authentication (TOTP + email)
- Team collaboration with role-based access
- REST API with API key authentication
- Dark mode by default
- Self-hostable (GPL-3.0)

## Getting Started (Hosted)

1. **Sign up** at [vulnradar.dev](https://vulnradar.dev/signup) - it's free
2. **Scan a URL** to see real-time vulnerability detection
3. **View the docs** at [/docs](https://vulnradar.dev/docs) for API integration and advanced features

## Self-Hosting

VulnRadar is GPL-3.0 and can be self-hosted with Docker. See the [Self-Hosting Guide](docs/SELF_HOSTING.md) for full instructions.

Quick start:

```bash
# 1. Clone
git clone https://github.com/VulnRadar/vulnradar.dev.git
cd vulnradar.dev

# 2. Configure (edit values for your deployment)
cp .env.example .env
# Edit lib/config/config-values.ts to set your app name, URL, emails, etc.

# 3. Build & run
docker compose up -d

# 4. Initialize database
docker compose exec app node scripts/create-fresh-db.mjs
```

## Configuration

VulnRadar has **two configuration layers** (see [docs/CONFIG.md](docs/CONFIG.md) for the full reference):

| Layer                 | File                                 | Purpose                                                                                         |
| --------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| **Static app config** | `lib/config/config-values.ts`        | App name, URL, emails, rate limits, feature flags, billing plans. Edit and rebuild.             |
| **Runtime secrets**   | `.env` (or `docker-compose.yml` env) | `DATABASE_URL`, `API_KEY_ENCRYPTION_KEY`, `STRIPE_SECRET_KEY`, SMTP credentials, Discord OAuth. |

**Single source of truth:** `lib/config/config-values.ts` exports the raw `CONFIG_*` constants. `lib/types/config.ts` derives the `DEFAULT_CONFIG` typed object from those constants, and `lib/config/constants.ts` re-exports them as the conventional `APP_NAME`, `ROUTES`, `API`, `ERROR_MESSAGES`, `SUCCESS_MESSAGES`, etc. used throughout the app. Self-hosters edit `config-values.ts` to customize their deployment.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for:

- Project structure (`app/`, `lib/`, `components/`, `hooks/`)
- Configuration system (above)
- Database layer (PostgreSQL via `@neondatabase/serverless`)
- Authentication flow (sessions, 2FA, API keys)
- Scanner engine (310+ security checks)
- API layer (REST v1 + v2)
- CI/CD pipeline (GitHub Actions + CodeQL + Dependabot)

## Development

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for:

- Prerequisites (Node 20+, PostgreSQL 14+)
- Local setup (`npm install`, `.env`, `npm run dev`)
- Scripts (`dev`, `build`, `lint`, `lint:fix`, `typecheck`, `migrate`, `new-db`)
- Linting & formatting (ESLint 9 + flat config)
- Commit conventions
- Pull request process

## Tech Stack

- **Framework:** Next.js 15.5 (App Router)
- **UI:** React 19, TypeScript 6, Tailwind CSS 3, Radix UI primitives
- **Database:** PostgreSQL via `@neondatabase/serverless` driver
- **Auth:** iron-session, bcrypt, TOTP (otplib)
- **Payments:** Stripe
- **Scanner:** Custom TypeScript engine with HTTP/HTTPS/WebSocket/FTP checks
- **CI:** GitHub Actions + CodeQL + Dependabot

## Security

- [Security Policy](SECURITY.md)
- [Security.txt](public/.well-known/security.txt)
- [CodeQL Analysis](https://github.com/VulnRadar/vulnradar.dev/security/code-scanning)
- [Dependency Scanning](https://github.com/VulnRadar/vulnradar.dev/network/dependencies)
- [Secret Scanning with Push Protection](https://docs.github.com/en/code-security/secret-scanning/about-secret-scanning)

To report a vulnerability, email **security@vulnradar.dev** (do NOT open a public issue).

## License

GPL-3.0 - See [LICENSE](LICENSE) for full text.
