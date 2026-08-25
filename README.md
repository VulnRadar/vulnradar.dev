# VulnRadar

Open-source web vulnerability scanner. Paste a URL, get a structured security
report in under 3 seconds. No agent to install.

**795+ deterministic checks across 18 categories** covering security headers,
TLS and certificates, cookies, DNS and email records, exposed secrets, server
misconfiguration, information disclosure, client-side risks, supply chain
exposure, and common AI-generated code antipatterns.

[![Secured by VulnRadar](https://vulnradar.dev/api/v3/badge/9e5fb4e1fe33513bf6799a588fe9831b844f1cfbdedde844e5fafdd379f6a51c)](https://vulnradar.dev/shared/9e5fb4e1fe33513bf6799a588fe9831b844f1cfbdedde844e5fafdd379f6a51c)

## Quick Links

- **[Documentation](https://vulnradar.dev/docs)** - setup, API reference, and guides
- **[GitHub](https://github.com/VulnRadar/vulnradar.dev)** - source and contribution guidelines
- **[Report a Bug](https://github.com/VulnRadar/vulnradar.dev/issues)** - help us improve
- **[Security Advisories](https://github.com/VulnRadar/vulnradar.dev/security/advisories/new)** - privately report a vulnerability
- **[Support VulnRadar](https://vulnradar.dev/donate)** - pays for hosting the public instance and the time spent chasing false positives out of the detection engine

## Features

- 795+ checks across 18 categories, run in parallel
- Stable finding IDs, so results can be diffed between runs and gated in CI
- Scan history, comparison between two scans, and shareable report links
- Self-updating embed badge: generate it once, it always shows the latest scan
- Scheduled scans, bulk scanning, and webhooks
- REST API with token authentication, plus an interactive API playground with code samples in 8 languages
- Command-line tool to run a scan and gate CI builds on the findings
- GitHub repository scanning with AI-assisted code review
- AI assistant for triage and remediation questions, with optional bring-your-own-key
- Two-factor authentication (TOTP or email) with backup codes
- Teams with role-based access
- CVSS 3.1 base scores computed for every finding
- Admin password resets go out as an emailed link; admins never see a user's password
- Admin email delivery log, with links/tokens/codes redacted before display
- Export to PDF, JSON, SARIF, Markdown, or a compliance crosswalk
- Browser extension for Chrome and Firefox
- Self-hostable under GPL-3.0

## Embeddable Badge

The badge above is generated once and updates on its own: scan your site
again and the image changes with it, no new embed code to paste in. Pick a
scan at [/badge](https://vulnradar.dev/badge), copy the HTML or Markdown
snippet, and the badge always reflects that URL's most recent completed
scan, not the scan you happened to pick when you made it.

## Getting Started (Hosted)

1. **Try it without an account** at [/demo](https://vulnradar.dev/demo)
2. **Sign up** at [vulnradar.dev/signup](https://vulnradar.dev/signup) for 25 scans a day, free
3. **Read the docs** at [/docs](https://vulnradar.dev/docs) for the API and advanced features

## Self-Hosting

VulnRadar is GPL-3.0 and can be self-hosted. See the
[Self-Hosting Guide](https://vulnradar.dev/docs/self-hosting) for full
instructions.

```bash
# 1. Clone
git clone https://github.com/VulnRadar/vulnradar.dev.git
cd vulnradar.dev

# 2. Configure
cp .env.example .env
# Set DATABASE_URL and API_KEY_ENCRYPTION_KEY in .env, then edit
# lib/config/config-values.ts for app name, URL, emails, and feature flags.

# 3. Build and run
docker compose up -d

# 4. Initialize the database
docker compose exec app npm run db:create
```

`API_KEY_ENCRYPTION_KEY` is required. Without it the app refuses to store TOTP
secrets rather than falling back to plaintext.

## Configuration

VulnRadar has **two configuration layers** (see the
[Config Reference](https://vulnradar.dev/docs/config) for every value):

| Layer                 | File                                 | Purpose                                                                                           |
| --------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| **Static app config** | `lib/config/config-values.ts`        | App name, URL, emails, SEO metadata, rate limits, feature flags, billing plans. Edit and rebuild. |
| **Runtime secrets**   | `.env` (or `docker-compose.yml` env) | `DATABASE_URL`, `API_KEY_ENCRYPTION_KEY`, `STRIPE_SECRET_KEY`, SMTP credentials, Discord OAuth.   |

**Single source of truth:** `lib/config/config-values.ts` exports the raw
`CONFIG_*` constants. `lib/types/config.ts` derives the typed `DEFAULT_CONFIG`
from them, and `lib/config/constants.ts` re-exports them under the conventional
names (`APP_NAME`, `ROUTES`, `API`, `ERROR_MESSAGES`) used throughout the app.
Self-hosters edit `config-values.ts` and nothing else.

Values that differ per deployment rather than per fork, such as search engine
verification tokens, read from environment variables first. See the SEO section
of `.env.example`.

## Architecture

See [docs/architecture](https://vulnradar.dev/docs/architecture) for:

- Project structure (`app/`, `lib/`, `components/`, `hooks/`, `tests/`)
- Configuration system (above)
- Database layer (PostgreSQL via the `pg` driver)
- Authentication flow (sessions, 2FA, API keys)
- Scanner engine and how to add a check category
- REST API (v3)
- CI/CD pipeline (GitHub Actions + Dependabot)

## Development

Prerequisites: **Node 22 LTS** (the `engines` field requires Node `>=22`; odd
releases such as 21 and 23 are unsupported by `vitest@4`, see `.nvmrc`) and
PostgreSQL 14+.

```bash
npm install
cp .env.example .env
npm run dev
```

| Script                  | Purpose                                         |
| ----------------------- | ----------------------------------------------- |
| `npm run dev`           | Development server                              |
| `npm run build`         | Production build                                |
| `npm run typecheck`     | `tsc --noEmit`                                  |
| `npm run lint`          | ESLint, including type-aware rules on auth code |
| `npm run format`        | Prettier                                        |
| `npm test`              | Vitest suite                                    |
| `npm run test:coverage` | Vitest with per-file coverage thresholds        |
| `npm run db:migrate`    | Apply schema migrations                         |
| `npm run db:create`     | Create a fresh database                         |

Tests live in `tests/`, mirroring the source tree. See
[tests/README.md](tests/README.md) for the layout and conventions.

See [CONTRIBUTING.md](CONTRIBUTING.md) for commit conventions and the pull
request process.

## Tech Stack

- **Framework:** Next.js 15.5 (App Router)
- **UI:** React 19, TypeScript 6, Tailwind CSS 4, Radix UI primitives
- **Database:** PostgreSQL via the `pg` driver
- **Auth:** HTTP-only session cookies, scrypt password hashing (N=2^17, params
  stored per hash so the cost can be raised without invalidating old hashes),
  custom TOTP (RFC 6238), bcrypt for API key hashing
- **Payments:** Stripe (Elements)
- **Scanner:** Custom TypeScript engine over HTTP/HTTPS/WebSocket/FTP
- **Testing:** Vitest
- **CI:** GitHub Actions + Dependabot

## Security

- [Security Policy](SECURITY.md)
- [security.txt](https://vulnradar.dev/.well-known/security.txt)
- [Dependency Scanning](https://github.com/VulnRadar/vulnradar.dev/network/dependencies)

To report a vulnerability, email **security@vulnradar.dev**. Please do not open
a public issue.

## License

GPL-3.0. See [LICENSE](LICENSE) for the full text.
