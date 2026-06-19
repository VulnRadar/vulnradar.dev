# Development

Setup for contributing to VulnRadar.

## Prerequisites

- **Node.js 20.x** (matches `Dockerfile` and CI; LTS recommended)
- **npm 10+** (or `pnpm` / `yarn` if you adapt the lockfile)
- **PostgreSQL 14+** (local install or via Docker)
- **Git**

## Quick Start

```bash
# 1. Clone
git clone https://github.com/VulnRadar/vulnradar.dev.git
cd vulnradar.dev

# 2. Install dependencies
npm ci

# 3. Set up environment
cp .env.example .env
# Edit .env with your DATABASE_URL, API_KEY_ENCRYPTION_KEY, etc.

# 4. Create the database schema
node scripts/create-fresh-db.mjs

# 5. Start the dev server
npm run dev
# → http://localhost:3000
```

The first run auto-initializes the schema. You'll see `Database initialized` in the
console. To create an admin user, sign up normally, then promote via SQL:

```sql
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
```

## Scripts

| Script              | What it does                                     |
| ------------------- | ------------------------------------------------ |
| `npm run dev`       | Start Next.js dev server (HMR) on port 3000      |
| `npm run build`     | Production build (runs `next build`)             |
| `npm run start`     | Run the production build                         |
| `npm run lint`      | Run ESLint over the repo (no `--fix`)            |
| `npm run lint:fix`  | Run ESLint with `--fix` (auto-fixes where safe)  |
| `npm run typecheck` | Run `tsc --noEmit` (build-time typecheck)        |
| `npm run db:migrate` | Run `scripts/migrate.mjs` (ad-hoc DB migrations) |
| `npm run db:create`  | Drop and recreate the database schema            |

## Linting

ESLint 9 with flat config (`.eslint.config.mjs`). The config wraps `next/core-web-vitals`
for React/Next/TS rules. Warnings are non-blocking; CI fails only on errors.

```bash
npm run lint        # check
npm run lint:fix    # auto-fix
```

Common rule overrides:

- `@typescript-eslint/no-unused-vars` → `warn` (with `^_` underscore convention)
- `@typescript-eslint/no-explicit-any` → `warn`
- `@next/next/no-html-link-for-pages` → off (we use `<Link>` exclusively)
- `react/no-unescaped-entities` → off (too noisy for our content)

## Type Checking

`tsc --noEmit` runs in CI but is **non-blocking** (legacy `next.config.mjs` has
`typescript.ignoreBuildErrors: true`). The build is green either way. New code
should still type-check cleanly.

## Commit Conventions

We follow Conventional Commits:

```
<type>(<scope>): <subject>

<body>

<footer>
```

| Type       | Used for                                              |
| ---------- | ----------------------------------------------------- |
| `feat`     | New user-facing feature                               |
| `fix`      | Bug fix                                               |
| `chore`    | Maintenance, deps, tooling, no production code change |
| `refactor` | Code change with no behavior change                   |
| `docs`     | Documentation only                                    |
| `style`    | Formatting only (no logic change)                     |
| `test`     | Adding/updating tests                                 |
| `perf`     | Performance improvement                               |
| `ci`       | CI/CD changes                                         |

Examples:

- `feat(scan): add WebSocket CSWSH check`
- `fix(auth): correct TOTP clock skew handling`
- `chore(deps): bump next to 15.5.18`
- `docs: add CONFIG.md and ARCHITECTURE.md`

## Pull Request Process

1. Branch off `main` (`git switch -c fix/short-name`)
2. Make focused commits (one logical change per commit)
3. Run `npm run lint`, `npm run typecheck`, `npm run build` locally
4. Use the [PR template](../.github/pull_request_template.md)
5. Wait for CI (lint + typecheck + build + auto-applied labels)
6. Request review from CODEOWNERS (security/critical paths)
7. After 1+ approval, squash-merge

## Project Structure (Quick Map)

- `app/` — Next.js App Router (file-system routing)
- `components/` — React components
- `lib/` — Server-side libraries
- `hooks/` — Custom React hooks
- `public/` — Static assets
- `scripts/` — Admin / DB scripts
- `docs/` — Project documentation
- `instrumentation.ts` — Next.js startup hooks
- `middleware.ts` — Auth middleware

## Common Pitfalls

1. **Editing `lib/types/config.ts` defaults** — they are derived from `config-values.ts`.
   Edit `config-values.ts` instead.
2. **Adding a new API route** — copy an existing one in `app/api/v2/.../route.ts`;
   wrap with `withErrorHandling`, use `parseBody` + `Validate` for input.
3. **Adding a database table** — add the `CREATE TABLE` to `scripts/create-fresh-db.mjs`
   (idempotent) and run `npm run db:create` to test.
4. **Adding a new icon** — import from `lucide-react`. Don't bundle from a different lib.
5. **Adding a constant** — if it's a value (not a path or URL), add it to
   `config-values.ts` rather than a magic number in the code.

## Debugging

- Server logs: visible in `npm run dev` output
- Database queries: add `console.log` in `lib/database/db.ts` (temporarily)
- Auth issues: check the session cookie with browser devtools
- Build issues: `next.config.mjs` has `output: "standalone"` for Docker

## See also

- [ARCHITECTURE.md](ARCHITECTURE.md) — system architecture
- [CONFIG.md](CONFIG.md) — configuration system
- [SELF_HOSTING.md](SELF_HOSTING.md) — deployment
