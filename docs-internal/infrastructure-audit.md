# Infrastructure audit: VulnRadar 3.0.0

Date: 2026-08-04. Scope: database, Docker, CI, runtime health, migrations,
build performance. File and line references are relative to the repo root
and were current at the time of writing; several other agents were editing
this checkout concurrently (scanner learning, authenticated scanning), so a
few line numbers may have shifted slightly by the time this is read. The
surrounding context should still make each finding easy to relocate.

## Headline: the three things most likely to bite a self-hoster

1. **The container healthcheck couldn't see the database.** Docker's
   `HEALTHCHECK` and docker-compose's readiness probe both hit
   `/api/version`, which only calls out to GitHub's releases API and never
   touches Postgres. A self-hoster whose database connection dies (wrong
   password after a `.env` edit, Postgres OOM-killed, network hiccup to a
   managed DB) would see every real request 500, while Docker kept reporting
   the container "healthy" and never restarted it. Fixed: new
   `/api/v3/health` endpoint that actually queries the database and checks
   the schema version, wired into the Dockerfile `HEALTHCHECK` and both
   compose files.
2. **`api_usage`, `scan_history`, and `admin_audit_log` had no composite
   indexes for their actual query shapes**, only single-column ones. The
   worst of these, `api_usage(api_key_id, used_at)`, backs the daily
   rate-limit check that runs on **every single API-key-authenticated
   request** (`checkRateLimit()` in `lib/api/api-keys.ts:330-334,369-373`).
   On a fresh install this is invisible; on a self-hoster's database a year
   in, with `api_usage` holding 90 days of rows for every API user, this is
   the query that quietly turns every API call sluggish. Fixed as a
   migration (see below).
3. **The fresh-install schema (`instrumentation.ts`, what `docker compose
   up` actually creates) and the migration chain (`scripts/migrate/`) had
   drifted apart**, and nothing was checking that they hadn't. Two features
   landed schema changes in this same checkout while this audit was in
   progress; one of them (`scan_finding_feedback`, the scanner-learning
   table) was added to the migration chain but never mirrored into
   `instrumentation.ts`, so a brand-new `docker compose up` would be missing
   a table that `npm run db:migrate` assumes exists. This is exactly the
   class of bug `npm run audit:v2-tables` exists to catch for the v2 table
   set, but that script doesn't cover v3+. Fixed by mirroring the missing
   table and completing the registry chain (details below); the
   `audit:v2-tables`-style check not being generalized to v3+ is noted as a
   gap, not fixed (see "What I skipped").

---

## 1. Database

### Connection pool

`lib/database/db.ts` (pre-audit) hardcoded `max: 10`, `idleTimeoutMillis:
30000`, `connectionTimeoutMillis: 5000`, `statement_timeout: 30_000`,
`query_timeout: 30_000`. Sensible defaults for a single-box self-hosted
deployment, but not overridable without editing source and rebuilding, so
the product owner's "everything must be configurable" requirement wasn't
met here. **Fixed**: values now read from `lib/config/config-values.ts`
(`CONFIG_DB_POOL_MAX`, `CONFIG_DB_POOL_MIN`, `CONFIG_DB_IDLE_TIMEOUT_MS`,
`CONFIG_DB_CONNECTION_TIMEOUT_MS`, `CONFIG_DB_STATEMENT_TIMEOUT_MS`,
`CONFIG_DB_QUERY_TIMEOUT_MS`) with the same numeric defaults as before
(behavior-preserving), and each is additionally overridable per-deployment
via `DATABASE_POOL_MAX` / `DATABASE_POOL_MIN` / `DATABASE_IDLE_TIMEOUT_MS` /
`DATABASE_CONNECTION_TIMEOUT_MS` / `DATABASE_STATEMENT_TIMEOUT_MS` /
`DATABASE_QUERY_TIMEOUT_MS` env vars (a malformed value throws at import
time with a clear message rather than silently coercing to `NaN`). Also
added `getPoolStats()`, exposing `pool.totalCount` / `idleCount` /
`waitingCount`, used by the new health endpoint; `waiting > 0` sustained is
the actual "the pool is too small" signal an operator needs.

Under load: 10 connections is the ceiling per app process. Postgres'
stock `max_connections` is 100, so a single self-hosted app container has
10x headroom before hitting the server's own limit, fine as shipped. If
someone scales to multiple app replicas without raising `DATABASE_POOL_MAX`
proportionally down or `max_connections` up, they'll hit it; that's now at
least a config change instead of a rebuild.

### Missing indexes on hot paths

Read the actual query shapes in `lib/auth/`, `lib/api/api-keys.ts`,
`lib/rate-limiting/`, `app/api/v3/history/`, `app/api/v3/admin/route.ts`.
Cross-referenced against every index in `instrumentation.ts`. Several hot
queries were already well covered by `UNIQUE` constraints that
double as composite indexes (Postgres creates one automatically):

- `device_trust` lookup (`lib/auth/device-trust.ts:19-25`, `WHERE user_id =
  $1 AND device_fingerprint = $2`): covered by `UNIQUE(user_id,
  device_fingerprint)`.
- `team_members` role check (`lib/auth/authorization.ts:183,259`, `WHERE
  team_id = $1 AND user_id = $2`, run on every team-scoped request):
  covered by `UNIQUE(team_id, user_id)`.
- `rate_limits` window lookup (`lib/rate-limiting/daily-limits.ts:94-96`,
  `WHERE key = $1 AND window_start >= CURRENT_DATE`): covered by
  `UNIQUE(key, window_start)`.
- `api_keys` lookup by `key_locator` (`lib/api/api-keys.ts:167-176`):
  already has a dedicated index plus a partial backfill index for legacy
  rows without a locator. Already O(1); no change needed.
- Session read (`lib/auth/auth.ts:76-82`, `WHERE s.id = $1`): primary key,
  already indexed.

Four query shapes were **not** covered and only had single-column indexes
to fall back on, forcing Postgres to pick one column and sort/filter the
rest in memory: cheap on a fresh table, increasingly expensive as the
table grows.

| Table | Query shape | Call site | Frequency |
|---|---|---|---|
| `api_usage` | `WHERE api_key_id = $1 AND used_at > NOW() - INTERVAL '24 hours'`, plus `ORDER BY used_at ASC LIMIT 1` on the same predicate | `lib/api/api-keys.ts:330-334,369-373` (`checkRateLimit`) | Every API-key-authenticated request |
| `scan_history` | `WHERE user_id = $1 ORDER BY scanned_at DESC [LIMIT n]` | `app/api/v3/history/route.ts:86-95`, `app/api/v3/admin/route.ts:129,1059` (dashboard, admin user detail, GDPR export) | Every history-page load |
| `admin_audit_log` | `WHERE admin_id = $1 AND created_at > NOW() - INTERVAL 'Nh'`, plus `ORDER BY created_at DESC LIMIT 1` on `admin_id` | `app/api/v3/admin/route.ts:230-242` (admin activity panel, 5 subqueries per admin row) | Admin dashboard load |
| `admin_audit_log` | `WHERE target_user_id = $1` (no index at all, not even single-column) | `app/api/v3/admin/route.ts:1802` (account self-delete / GDPR erasure cascade) | Every account deletion |

**Fixed** as migration `5.0.0` to `5.1.0` (see "Migrations" below for why
that version number) and mirrored into `instrumentation.ts` for fresh
installs:

```sql
CREATE INDEX idx_scan_history_user_scanned  ON scan_history(user_id, scanned_at DESC);
CREATE INDEX idx_api_usage_key_used         ON api_usage(api_key_id, used_at);
CREATE INDEX idx_admin_audit_admin_created  ON admin_audit_log(admin_id, created_at DESC);
CREATE INDEX idx_admin_audit_target_user    ON admin_audit_log(target_user_id) WHERE target_user_id IS NOT NULL;
```

All four are additive: the existing single-column indexes are left in
place for query shapes that only filter on one of the two columns (e.g.
the admin dashboard's global `scans_24h` count filters `scan_history` by
`scanned_at` alone, with no `user_id`).

Considered and **not** added: a composite on `billing_history(user_id,
created_at)`. It's queried the same way (`WHERE user_id = $1 ORDER BY
created_at DESC`, `app/api/v3/data-request/route.ts:206`), but only from
the GDPR export and admin detail view, not a per-request hot path. Left
as a single-column index; revisit if it shows up in a slow-query log.

### Unbounded `SELECT`s

One found: `app/api/v3/admin/route.ts:1059`, `SELECT url, findings_count,
source, scanned_at FROM scan_history WHERE user_id = $1 ORDER BY scanned_at
DESC` with no `LIMIT`, used by the admin "export a user's data" /
GDPR-request path. This is arguably correct as written (a data export has
to be complete), so I did not add a `LIMIT`, which would silently truncate
someone's export. Flagged here because a user with tens of thousands of
scans (a heavy API user over several years) will make this a genuinely
large single query; if that becomes a real problem the right fix is
streaming/pagination in the export path, not a cap, and that's an
application-layer change outside the files I own.

No N+1 patterns (per-row query loops in application code) were found in
the areas reviewed. The closest thing, the `scan_tags` correlated
subquery in the history listing (`json_agg` inside the main `SELECT`,
`app/api/v3/history/route.ts`), is a single SQL statement Postgres
executes once, not a loop.

### Is `cleanup.ts` actually scheduled?

Yes, and there was a real bug in how. `instrumentation.ts` called
`schedulePeriodicCleanup(5 * 60 * 1000)` intending a 5-minute cadence (the
log message even said `"(5min interval)"`), but the old
`schedulePeriodicCleanup` in `lib/database/cleanup.ts` **ignored its
parameter entirely** and always used a hardcoded `24 * 60 * 60 * 1000`. The
periodic cleanup pass was actually running once a day, not every 5 minutes,
silently contradicting its own log line. Given the shortest TTL it cleans
up (`email_2fa_codes`, 10 minutes) this meant stale rows could sit for up
to 24 hours instead of the intended ~10-15 minutes. Not a security hole
(those tables are all already scoped/expired-checked on read), but a
real, silent discrepancy between documented and actual behavior.

**Fixed**: the parameter is now honored, defaults to the new
`CONFIG_DB_CLEANUP_INTERVAL_MS` (5 minutes, matching what was always
intended), and the timer is `.unref()`'d so a pending cleanup can never
block process shutdown on SIGTERM. The `instrumentation.ts` call site no
longer hardcodes `5 * 60 * 1000`; it reads the same config constant.

---

## 2. Docker

### Before

- `Dockerfile`: multi-stage build, Node 22.11.0-alpine pinned, non-root
  `nextjs` user, `tini` as PID 1 for signal forwarding, `HEALTHCHECK`
  present. Already solid on most axes.
- `docker-compose.yml`: Postgres `healthcheck` (`pg_isready`) and app
  `depends_on: condition: service_healthy` were **already present**. The
  classic "app starts before Postgres is ready" self-hoster crash-loop this
  audit was specifically asked to check for was already fixed before I
  started. Confirmed working as intended; no change needed there.
- `node_modules` was copied into the runtime image as-is after `npm ci`
  (without `--omit=dev`, since devDependencies are needed for `npm run
  build`), meaning `typescript`, `eslint`, `tailwindcss`, `prettier`,
  `vitest`, and their transitive trees all shipped in the production
  image despite nothing at runtime importing them.
- `docker-publish.yml` (release workflow) set up `docker buildx` but then
  called plain `docker build`: the buildx builder was installed and never
  used, no build cache across releases.
- The container `HEALTHCHECK` and compose healthcheck both hit
  `/api/version` (see headline #1).
- `docker-compose.yml`'s own header comment and three other places in the
  docs (`app/docs/architecture`, `app/changelog`) reference
  `docker-compose.dev.yml` for local development with custom Turnstile
  keys; the file didn't exist.

### Fixed

- `Dockerfile`: added `RUN npm prune --omit=dev --ignore-scripts` after
  `npm run build`, before the runtime stage copies `node_modules`. Next.js
  has already compiled everything it needs from the dev toolchain by that
  point; nothing at runtime imports `typescript` or `eslint`. This is a
  pure size reduction with no behavior change. I could not measure the
  before/after image size myself (no Docker daemon available in this
  environment; see "What I could not verify" below), but pruning
  devDependencies from a Next.js + Radix + Tailwind stack this size is
  reliably tens of megabytes.
- `.dockerignore`: excluded `graphify-out` (29 MB), `docs-internal`,
  `tests`, `coverage`, `scripts/storage`, `.github`, `*.log`. None of these
  are needed to build or run the image; excluding them shrinks the build
  context and, more usefully, stops edits to them from invalidating the
  `COPY . .` Docker layer cache on every commit.
- `Dockerfile` `HEALTHCHECK` and both `docker-compose*.yml` files: switched
  from `/api/version` to the new `/api/v3/health` (see "Runtime health").
- `.github/workflows/docker-publish.yml`: the build step now uses `docker
  buildx build --cache-from=type=gha --cache-to=type=gha,mode=max --push`
  instead of plain `docker build` plus two `docker push` calls, actually
  using the buildx builder that was already being set up. This should
  meaningfully speed up releases where only application code changed and
  the dependency-install layer is unchanged.
- `.github/workflows/ci.yml`: added a `docker` job that builds the
  Dockerfile (not pushed) on every PR with the same GHA cache backend. The
  only place the Dockerfile was previously validated was
  `docker-publish.yml`, which only runs on a `v*` tag, i.e. *after* a
  release is already cut. A broken Dockerfile would have gone unnoticed
  until someone tried to build the tagged release. Now it's a normal PR
  check, running in parallel with lint/typecheck/test/build so it doesn't
  add to the critical path.
- Created `docker-compose.dev.yml`: builds the app from the local
  `Dockerfile` (instead of pulling the published `ghcr.io` image) so local
  source changes are actually reflected, matching what the existing
  comments and docs already promised. Same healthcheck/depends_on pattern
  as the production compose file.

### What I could not verify

I could not run `docker build` or `docker compose config` myself: the
Docker CLI is not installed in this environment (`docker: command not
found`). I validated the compose YAML changes with `js-yaml` (all four
touched/added YAML files parse correctly) and syntax-checked the Dockerfile
changes by reading them carefully against the existing multi-stage
structure, but the orchestrator or CI should do a real `docker build .`
before this ships. I'm reasonably but not completely confident in the
`npm prune` step working exactly as intended on the first try.

---

## 3. CI

Read every workflow in `.github/workflows/`. Overall this was already in
good shape:

- **Actions are already pinned by commit SHA** (with a version comment),
  not by mutable tag, across all six workflows.
- **Permissions are already scoped**: `ci.yml` has a top-level `permissions:
  contents: read`; `docker-publish.yml`, `release.yml`,
  `dependabot-auto-merge.yml`, `label.yml`, `stale.yml` each declare only
  what their single job needs (`packages: write` plus `id-token: write` for
  the cosign-signing publish job, `contents: write` for the release-asset
  job, etc). No workflow grants broader `write` access than it uses.
- **Caching was already configured**: every Node job uses
  `actions/setup-node` with `cache: "npm"`.
- **Node version is consistent** with `.nvmrc` (`22`) and
  `package.json#engines` (`>=22.0.0`) across every workflow.
- **No secret-leak or script-injection risk found**: grepped every workflow
  for `${{ github.event.* }}` interpolated directly into a `run:` shell
  block (the classic GitHub Actions injection class); the two matches
  (`dependabot-auto-merge.yml`, `release.yml`) both pass the value through
  an `env:` var first, never inline-expand it into the shell script.
- **What's gated on a PR vs. only after merge**: `lint`, `typecheck` (plus
  `npm audit --audit-level=high --omit=dev`), `test`, and `build` all run
  on every PR via `ci.yml`. The Docker image itself was only built on a
  release tag (`docker-publish.yml`), fixed, see below.
- **Branch protection is not configured** on `main` (`gh api
  repos/.../branches/main/protection` returns `404 Branch not protected`).
  This means none of the passing CI jobs are actually *required* before a
  merge: they run and report status, but nothing stops a merge on red.
  This isn't a file I can fix (it's a GitHub repo setting, not something
  version-controlled in this checkout). **Flagging for the orchestrator**:
  turn on branch protection for `main` requiring the `lint`, `typecheck`,
  `test`, `build`, and new `docker` jobs to pass.

### Fixed

- Added the `docker` build-validation job to `ci.yml` (see "Docker"
  above).
- Switched `docker-publish.yml` to `buildx build` with GHA layer caching
  (see "Docker" above). This is the "is the cache configured so CI is
  fast" fix on the publish side; the PR-facing jobs were already cached.

### Considered and not changed

- `test` and `build` both declare `needs: [lint, typecheck]`, so they run
  serially after those two rather than in parallel with them. This is
  intentional (see the existing "Phase 8C Commit 1" comment): it avoids
  burning CI minutes running the full test suite and a Next.js build on a
  PR that fails lint or typecheck in the first 30 seconds. Given lint and
  typecheck are both fast, the wall-clock cost of this gate is small and
  the compute savings are real; I left it as designed.
- The `API_KEY_ENCRYPTION_KEY` placeholder in `ci.yml`'s `build` job env is
  a 68-character string of zeros (the required length is exactly 64); it
  passes `validateEnv()`'s Zod schema fine since that only checks length,
  not content, but I noticed the digit count doesn't match the 64-hex-char
  requirement's own name. Not a bug (build succeeds), just an odd literal;
  left alone since touching it has no functional effect and isn't worth
  the diff.

---

## 4. Runtime health

### Before

No readiness endpoint existed that checked anything beyond "is the Node
process answering HTTP." `/api/version` (checked by the Dockerfile
`HEALTHCHECK`, the compose healthcheck, and nothing else) makes an outbound
call to `api.github.com` and reports the app's own version; it never
touches the database. A self-hosted deployment with a fully dead database
connection would report "healthy" to Docker/Kubernetes/a load balancer
indefinitely while returning 500s to every real user.

`instrumentation.ts` does real, useful work at startup: validates required
env vars and fails fast (`validateEnv()`, refuses to start without
`API_KEY_ENCRYPTION_KEY`, confirmed still intact, did not touch this
guard), checks the connected database's schema version against
`MIN_SCHEMA_VERSION` and refuses to start with a clear, actionable error
box if it's behind, runs a one-time plaintext-secret backfill migration,
does self-healing FK/column additions for legacy databases, seeds default
badges, runs an initial cleanup pass, schedules the periodic one, and
repairs any SERIAL sequences that fell behind `MAX(id)`. This is all
genuinely useful and none of it needed fixing.

### Fixed

Added `app/api/v3/health/route.ts` (`GET /api/v3/health`, registered as a
public path in `lib/config/public-paths.ts` so it's reachable without a
session cookie; otherwise the middleware would 307-redirect the container
healthcheck to `/login` and it would never see a 200). Returns:

```json
{
  "status": "ok" | "degraded",
  "version": "3.0.0",
  "uptime_s": 1234,
  "database": {
    "connected": true,
    "latency_ms": 4,
    "schema_version": "3.0.0",
    "schema_required": "3.0.0",
    "schema_ok": true,
    "pool": { "total": 2, "idle": 1, "waiting": 0, "max": 10 }
  }
}
```

200 when the database is reachable and its schema is at least
`MIN_SCHEMA_VERSION`; 503 otherwise (connection failure, timeout, or a
schema behind what the running app requires). The probe itself is bounded
by `CONFIG_DB_HEALTHCHECK_TIMEOUT_MS` (3s default, configurable); a health
check that can hang is worse than one that fails fast. Deliberately
terse in what it reveals on failure: connection strings, hostnames, and
raw driver error text stay in `console.error`, never in the response body.

Error reporting: production errors do not vanish silently, every
catch block in the hot paths I read (`lib/database/`, `instrumentation.ts`,
route handlers) logs via `console.error` with enough context to grep for.
There's no structured error-reporting service (Sentry or similar) wired up
anywhere in the codebase; that's a real gap for a hosted SaaS operator
wanting alerting, but adding one means picking a vendor/dependency and
that's a product decision outside this audit's remit. **Flagging for the
orchestrator**, not fixing.

---

## 5. Migrations

### Can a 2.x self-hoster reach 3.0.0 cleanly?

Yes. `scripts/migrate/migrate.mjs` detects the current schema (via the
`vulnradar_schema_meta` table, or fingerprint-detection against actual
tables/columns if that's missing), builds a transition chain through
`scripts/migrate/_registry.mjs`, renders the plan for approval before
running anything, and executes it in a single transaction. The 2.0.0 to
3.0.0 path (`scripts/migrate/versions/2.0.0-to-3.0.0.mjs`) is complete and
reversible. `README.md`'s self-hosting section documents `npm run
db:migrate` as the upgrade path. I did not find anything broken here.

### Fresh-install vs. migration-chain convergence: the real gap

This is where I found and fixed a genuine problem, made worse by the fact
that two other features (scanner learning's `scan_finding_feedback`,
authenticated scanning's `scan_credentials`) landed schema changes in this
same checkout while I was auditing it:

- `scan_finding_feedback` was added as a migration
  (`scripts/migrate/versions/3.0.0-to-4.0.0.mjs`) but **never mirrored into
  `instrumentation.ts`**. Every other v3+ table (`ai_conversations`,
  `browser_sessions`, `scan_credentials`) follows a dual path: an
  idempotent `CREATE TABLE IF NOT EXISTS` block in `instrumentation.ts` for
  a fresh `docker compose up`, plus an explicit migration file for someone
  upgrading an existing database. `scan_finding_feedback` only had the
  second half. A brand-new self-hosted install would boot fine, but
  `POST /api/v3/scan/feedback` would 503 with "table not yet migrated"
  (there's a specific error handler for this in
  `app/api/v3/scan/feedback/route.ts:59-65`, so at least it fails with a
  clear message rather than a raw 500) until someone thought to run `npm
  run db:migrate` on a database that was never on an older version to
  begin with. **Fixed**: mirrored the exact same DDL from the migration
  file into `instrumentation.ts`.
- `scripts/migrate/_registry.mjs` only had entries for schema versions
  1.0.0 through 3.0.0. Migration files existed on disk for `3.0.0` to
  `4.0.0` and `4.0.0` to `5.0.0`, but neither was registered, meaning `npm
  run db:migrate` had no way to plan a chain through them at all (the
  registry's `transitions()` walks an ordered array by index; an
  unregistered version breaks the chain, it doesn't get skipped). **Fixed**:
  added registry entries for `4.0.0` and `5.0.0`, built from what those
  migration files already declare, plus my own `5.1.0` (see below).
- `scripts/create-fresh-db/create-fresh-db.mjs`'s `SCHEMA_FILES` map had
  `"3.0.0": resolve(ROOT, "instrumentation.ts")`, i.e. `npm run db:create`
  targeting "3.0.0" pointed at the **live, currently-newest** file, which
  is exactly the kind of pointer that silently goes stale the moment a
  newer schema version lands (which is precisely what happened during this
  audit). **Fixed**: froze the schema as it stood at each version into
  `scripts/create-fresh-db/schemas/instrumentation-v3.ts`,
  `instrumentation-v4.ts`, and `instrumentation-v5.ts` (same pattern
  already used for v1 and v2), and repointed `SCHEMA_FILES` so only the
  newest entry (`5.1.0`) points at the live `instrumentation.ts`. Also
  updated the interactive version picker to build its menu from
  `Object.keys(SCHEMA_FILES)` instead of a second hardcoded list that
  would have drifted from the first one immediately.
- `MIGRATE_TABLES` in the same file (the list of tables `db:create`'s
  data-copy step knows how to carry over) was missing `browser_sessions`,
  `scan_finding_feedback`, and `scan_credentials`. Added, in FK-safe order.

### My migration: version 5.1.0

Added `scripts/migrate/versions/5.0.0-to-5.1.0.mjs` for the four indexes
described in "Database" above. **Version number used: `5.1.0`.** At the
time I started, `3.0.0` was the latest registered version; while working,
two concurrent agents' migration files appeared on disk:
`3.0.0-to-4.0.0.mjs` (scanner learning) and `4.0.0-to-5.0.0.mjs`
(authenticated scanning), claiming `4.0.0` and `5.0.0`. I checked
`scripts/migrate/versions/` immediately before creating my file to confirm
`5.0.0` was the latest claimed version, and used `5.1.0` (a minor bump,
since an index-only change is additive/non-breaking, unlike the three
major bumps before it which each added tables). **If another agent also
lands a migration around the same version number, that's a real collision
risk the orchestrator should reconcile.** I did not coordinate with those
agents directly, only observed their file timestamps.

Index-only migrations exposed a real gap in the migration framework
itself: `scripts/migrate/_planner.mjs`'s `expandPlan()` only knew how to
turn `addTables` / `dropTables` / `addColumns` / `dropColumns` /
`addIndexes` into plan steps; there was no `dropIndexes`, so a downgrade
that only needs to remove indexes (nothing to `DROP TABLE ... CASCADE` or
`DROP COLUMN` to take the index with it) had no way to express itself.
**Fixed**: added `dropIndexes` support to the planner (`DROP INDEX IF
EXISTS`, marked non-destructive since removing an index is never a
data-loss operation, unlike table/column drops). My `5.1.0` downgrade uses
it and actually works, rather than being a silent no-op with a comment
telling the user to run SQL by hand.

### Does anything check fresh-install and migration converge?

`npm run audit:v2-tables`
(`scripts/_lib/audit-v2-tables.mjs`) does this, but **only for the 15 v2
tables**: it cross-checks column lists between `instrumentation.ts` and
`scripts/migrate/versions/_snippets.mjs` for that specific table set. It
was never extended to cover v3+ tables, which is exactly the gap that let
`scan_finding_feedback` drift silently. **Not fixed.** Generalizing that
script to walk the full `_registry.mjs` version list and diff every
version's declared tables/columns against `instrumentation.ts` is a
reasonable follow-up, but it's a nontrivial rewrite of a script I'd want a
second pass to get right rather than bolting on under audit-time pressure.
Flagging as a concrete, scoped follow-up rather than doing it partially.

---

## 6. Build performance

I could not run `npm run build` myself (explicitly out of scope, the
`.next` directory is shared with other active agents). What I could do:
read the `.next/trace` and manifest files already on disk from the most
recent build.

**Caveat: this build predates the concurrent schema/feature work described
above**, so the numbers below are a lower bound, not a current
measurement. `.next/BUILD_ID` and `.next/trace` are both timestamped
2026-08-03 22:55.

- Wall-clock span from the trace file: **~72.6s**.
- Routes: 44 statically prerendered pages, 13 dynamic route segments
  (`.next/routes-manifest.json`). Of the app-router page routes
  specifically, 41 of 44 total pages were prerendered; the three that
  weren't, `/browser/[id]`, `/checkout/[productId]`, `/shared/[token]`,
  all depend on runtime data (a live BrowserBase session, a Stripe
  checkout session, a shared-scan token) that cannot be known at build
  time. That's correct, not a bug.
- `export const dynamic = "force-dynamic"` appears exactly once in the
  codebase, on `app/api/v3/stripe/setup-webhook/route.ts`, a one-time
  setup endpoint that has to run at request time. `force-static` appears
  three times, all on `app/manifest.ts`, `app/robots.ts`, `app/sitemap.ts`,
  exactly where you'd want it. **Nothing is forcing dynamic rendering
  that doesn't need it.**

I don't have a load-bearing number to compare against the orchestrator's
"124 static pages" figure. The build artifact on disk shows 44, and I
can't tell whether "124" refers to a different (more current) build, counts
something else (e.g. every static asset including chunks, not just page
routes), or reflects work landed by concurrent agents since this build ran.
**Flagging for the orchestrator**: run a fresh `npm run build` once all
agents have finished and compare against these numbers; I'd expect the
route count to have grown somewhat (new admin/scanning UI) but not the
per-page build time.

---

## What I fixed (summary)

- `lib/database/db.ts`: pool tuning moved to `lib/config/config-values.ts`
  (`CONFIG_DB_POOL_MAX/MIN`, `CONFIG_DB_IDLE_TIMEOUT_MS`,
  `CONFIG_DB_CONNECTION_TIMEOUT_MS`, `CONFIG_DB_STATEMENT_TIMEOUT_MS`,
  `CONFIG_DB_QUERY_TIMEOUT_MS`), each additionally overridable via env vars
  (`DATABASE_POOL_MAX`, etc). Added `getPoolStats()`.
- `lib/database/cleanup.ts`: fixed `schedulePeriodicCleanup()` silently
  ignoring its interval argument (was always 24h regardless of what was
  passed; now honors the argument, defaulting to the new
  `CONFIG_DB_CLEANUP_INTERVAL_MS`). Timer is now `.unref()`'d.
- `instrumentation.ts`: uses the new `DB_CLEANUP_INTERVAL` constant
  instead of a hardcoded `5 * 60 * 1000`; mirrored the missing
  `scan_finding_feedback` table for fresh-install parity; added the four
  new performance indexes (mirrors the 5.1.0 migration).
- `app/api/v3/health/route.ts` (new): DB- and schema-aware readiness
  endpoint. Registered as public in `lib/config/public-paths.ts`.
- `Dockerfile`: `npm prune --omit=dev` after build (smaller image);
  `HEALTHCHECK` now targets `/api/v3/health`.
- `.dockerignore`: excludes `graphify-out`, `docs-internal`, `tests`,
  `coverage`, `scripts/storage`, `.github`, `*.log`.
- `docker-compose.yml`: app healthcheck now targets `/api/v3/health`.
  (Postgres healthcheck plus `depends_on: condition: service_healthy` were
  already correct, confirmed, not changed.)
- `docker-compose.dev.yml` (new): builds from local `Dockerfile`, referenced
  by existing docs/comments but never created.
- `.github/workflows/ci.yml`: new `docker` job validates the Dockerfile
  builds on every PR (was previously only checked at release-tag time),
  with GHA layer caching.
- `.github/workflows/docker-publish.yml`: switched to `docker buildx build`
  with GHA cache (buildx was being set up but never used).
- `scripts/migrate/_planner.mjs`: added `dropIndexes` plan-step support
  (was missing; needed for a correct index-only downgrade).
- `scripts/migrate/_registry.mjs`: added the missing `4.0.0` and `5.0.0`
  entries (registering what the concurrent agents' migration files already
  declared) plus my own `5.1.0`.
- `scripts/migrate/versions/5.0.0-to-5.1.0.mjs` (new): the four performance
  indexes, with a working downgrade.
- `scripts/create-fresh-db/`: froze `instrumentation-v3.ts` / `-v4.ts` /
  `-v5.ts` snapshots, repointed `SCHEMA_FILES` so only the newest version
  reads the live `instrumentation.ts`, generalized the interactive version
  picker off `SCHEMA_FILES` instead of a second hardcoded list, added the
  three new tables to `MIGRATE_TABLES`.

## What I skipped, and why

- **Generalizing `audit:v2-tables` to cover v3+.** Real gap (see section
  5), but a correct rewrite deserves its own pass rather than a rushed
  addition under audit-time pressure, especially with schema versions still
  actively landing from other agents.
- **A `billing_history(user_id, created_at)` composite index.** Same query
  shape as the ones I did fix, but only hit from GDPR export / admin detail
  view, not a per-request hot path. Not worth a migration on its own;
  revisit if it shows up as slow in practice.
- **Streaming/pagination for the unbounded GDPR export query.** Correct
  behavior as written (a data export must be complete); the real fix if it
  becomes a problem is an application-layer change in a file I don't own.
- **A structured error-reporting/alerting service (Sentry or similar).**
  Real gap for the hosted SaaS operator, but picking a vendor and adding a
  dependency is a product decision, not an infrastructure-audit fix.
- **Multi-arch (arm64) Docker builds.** Not requested, adds real CI time,
  and nothing in the audit suggested self-hosters are blocked on it.
- **`next.config.mjs`.** Read it in full; found nothing wrong.
  CSP/COOP/CORP/Permissions-Policy headers, `DISABLE_CSP` production
  guard, and source-map suppression are all already correct and were left
  untouched per the hard constraint.

## Needs orchestrator attention

1. **Branch protection is not configured on `main`.** None of the CI
   checks (including the new `docker` job) actually block a merge. This is
   a GitHub repository setting, not a file in this checkout.
2. **Version-number collision risk on `scripts/migrate/versions/` and
   `scripts/migrate/_registry.mjs`.** I used `5.1.0` for the index
   migration, following `4.0.0` (scanner learning) and `5.0.0`
   (authenticated scanning) that appeared during this session. If those
   features' final version numbers end up different from what's currently
   on disk, the registry entries I added for `4.0.0`/`5.0.0` (built from
   reading their migration files) and my `5.1.0` all need to be
   reconciled against whatever those agents finalize.
3. **`CONFIG_APP_VERSION` / `CONFIG_MIN_SCHEMA_VERSION`** in
   `lib/config/config-values.ts` are still `"3.0.0"`, but
   `instrumentation.ts` now creates a schema that's really "5.1.0" shaped
   (scan_finding_feedback plus scan_credentials plus the new indexes). I
   did not bump these; I was told to touch `config-values.ts` only to add
   tuning values, but whoever finalizes the 3.0.0 release needs to decide
   the real version number and update both constants plus the registry to
   match.
4. **A fresh `npm run build` and `docker build .`** should be run once all
   concurrent agents are done, to get real build-time and image-size
   numbers (I could do neither myself, see constraints above) and to
   confirm the `npm prune --omit=dev` step in the Dockerfile doesn't strip
   anything actually needed at runtime.
