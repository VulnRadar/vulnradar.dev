<div align="center">

<img src="https://raw.githubusercontent.com/VulnRadar/vulnradar.dev/main/public/favicon.png" width="96" height="96" alt="VulnRadar logo" />

# VulnRadar

Open-source web vulnerability scanner. Paste a URL and get 795+ deterministic
checks back, each with the response evidence behind it, a finding ID that does
not change between runs, and the config line that fixes it. No agent to
install. GPL-3.0 and self-hostable.

**[Scan a URL with no account](https://vulnradar.dev/demo)** ·
**[Docs](https://vulnradar.dev/docs)** ·
**[Self-host](https://vulnradar.dev/docs/self-hosting)** ·
**[Changelog](https://vulnradar.dev/changelog)**

[![Secured by VulnRadar](https://vulnradar.dev/api/v3/badge/9e5fb4e1fe33513bf6799a588fe9831b844f1cfbdedde844e5fafdd379f6a51c)](https://vulnradar.dev/shared/9e5fb4e1fe33513bf6799a588fe9831b844f1cfbdedde844e5fafdd379f6a51c)
[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)
[![CI](https://github.com/VulnRadar/vulnradar.dev/actions/workflows/ci.yml/badge.svg)](https://github.com/VulnRadar/vulnradar.dev/actions/workflows/ci.yml)

</div>

## What it does

- **Stable finding IDs**, so two runs can be diffed and a CI job can fail on
  exactly the finding you care about instead of a severity count
- **Evidence with every finding**: the header, the certificate field, or the
  response body fragment that triggered it, not just a rule name
- **18 categories** covering security headers, TLS and certificates, cookies,
  DNS and email records, exposed secrets, server misconfiguration, information
  disclosure, client-side risks, supply chain exposure, and common
  AI-generated code antipatterns
- **A CLI and a GitHub Action** that poll a scan to completion and exit
  non-zero when findings cross a threshold you set
- **A self-updating embed badge**: generate it once and it always shows that
  URL's most recent completed scan, with no new embed code to paste
- **Scan diffing and shareable report links**, so a fix can be shown to have
  landed rather than asserted
- **Scheduled scans, bulk scanning, and signed webhooks** that fire when a
  background scan actually finishes, not when the API call returned
- **Exports** to PDF, JSON, SARIF, Markdown, or a compliance crosswalk, so
  findings go into the tool your team already uses
- **A browser extension** for Chrome and Firefox that scans the tab you are on
- **Runs on your own hardware** under GPL-3.0, with no telemetry. The only
  outbound call it makes on its own behalf is the admin-triggered update check
  against the GitHub releases API

Auth, teams, billing, the admin panel and the AI triage assistant are all
covered in the [docs](https://vulnradar.dev/docs).

## Quick Links

- **[Documentation](https://vulnradar.dev/docs)** - setup, API reference, and guides
- **[GitHub](https://github.com/VulnRadar/vulnradar.dev)** - source and contribution guidelines
- **[Report a Bug](https://github.com/VulnRadar/vulnradar.dev/issues)** - help us improve
- **[Security Advisories](https://github.com/VulnRadar/vulnradar.dev/security/advisories/new)** - privately report a vulnerability
- **[Support VulnRadar](https://vulnradar.dev/donate)** - pays for hosting the public instance and the time spent chasing false positives out of the detection engine

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
# Set DATABASE_URL and API_KEY_ENCRYPTION_KEY in .env. App name, URL, emails
# and branding are build-tier: edit lib/config/config-values.ts and rebuild.
# Rate limits, feature flags and billing limits are runtime-tier: change them
# in Admin -> Settings after the first sign-in, no rebuild needed.

# 3. Build and run
docker compose up -d

# 4. Initialize the database
docker compose exec app npm run db:create
```

`API_KEY_ENCRYPTION_KEY` is required. Without it the app refuses to store TOTP
secrets rather than falling back to plaintext.

## Configuration

Every setting resolves as **database ?? environment ?? shipped default** (see
the [Config Reference](https://vulnradar.dev/docs/config) for every value):

| Layer               | Where                                | Purpose                                                                                                                         |
| ------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| **Database**        | Admin -> Settings                    | Wins over everything else. No restart, no rebuild: a change reaches every running instance within the 30 second resolver cache. |
| **Environment**     | `.env` (or `docker-compose.yml` env) | A variable named exactly like the registry key pins a value without a database write. Also where secrets live.                  |
| **Shipped default** | `lib/config/config-values.ts`        | The `CONFIG_*` constant the repo ships with. Edit and rebuild.                                                                  |

Of the 268 settings in `lib/config/registry.ts`, 239 are runtime tier and take
effect as soon as they are saved. The remaining 29 are build tier (app name,
branding, SEO metadata) and are baked into statically generated pages, so those
need a rebuild before the change is visible.

Secrets are environment-only and have no admin control: `DATABASE_URL`,
`API_KEY_ENCRYPTION_KEY`, `STRIPE_SECRET_KEY`, SMTP credentials, Discord OAuth.

**How a value gets read:** `lib/config/config-values.ts` exports the raw
`CONFIG_*` constants. `lib/config/registry.ts` classifies each one into
`SETTINGS_REGISTRY` (type, bounds, admin tab, tier).
`lib/config/runtime-config.ts` resolves it in the order above, and
`lib/config/constants.ts` / `client-constants.ts` re-export the results under
the conventional names (`APP_NAME`, `ROUTES`, `API`, `ERROR_MESSAGES`) used
throughout the app. `lib/config/env.ts` validates the required environment
variables with Zod at boot.

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
npm ci
cp .env.example .env
npm run dev
```

Use `npm ci`, not `npm install`. Regenerating `package-lock.json` on Windows
or macOS drops the Linux native bindings and breaks CI and the Docker build.
See [CONTRIBUTING.md](CONTRIBUTING.md).

| Script                    | Purpose                                                      |
| ------------------------- | ------------------------------------------------------------ |
| `npm run dev`             | Development server                                           |
| `npm run build`           | Production build                                             |
| `npm run typecheck`       | `tsc --noEmit`                                               |
| `npm run lint`            | ESLint, including type-aware rules on auth code              |
| `npm run format`          | Prettier                                                     |
| `npm run format:check`    | Prettier in check mode. CI gates on this                     |
| `npm test`                | Vitest suite                                                 |
| `npm run test:coverage`   | Vitest with per-file coverage thresholds                     |
| `npm run build:knowledge` | Regenerate `lib/ai/` from the docs, changelog, checks, legal |
| `npm run db:migrate`      | Apply schema migrations                                      |
| `npm run db:create`       | Create a fresh database                                      |
| `npm run db:diagnose`     | Read-only database corruption report. `db:repair` fixes      |
| `npm run db:backup`       | Full dump. `db:restore` puts one back                        |

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
