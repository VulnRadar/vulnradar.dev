# scripts/

CLI scripts for the VulnRadar dev workflow. Run with `npm run <name>`.

Everything is grouped by what it is FOR, one directory per purpose. Three
scripts sit at the top level instead, and only because their path is pinned
from outside `scripts/`: `backup-db.mjs` is spawned by literal path from
`lib/backup/run-backup.ts` (the admin Backup button) and checked by path in the
CI image smoke test, `restore-db.mjs` is its pair, and
`vitest-completeness-reporter.mjs` is named in `vitest.config.ts`. Moving any of
them means editing those files in the same change.

## Layout

```
scripts/
├── _lib/                          # Shared helpers (27 files). Highlights:
│   ├── _lib.mjs                   # Barrel -- re-exports the rest
│   ├── _lib.output.mjs            # Colours, banner, section, log/info/success/warn/error
│   ├── _lib.prompts.mjs           # ask, askYesNo, askDanger, askExact
│   ├── _lib.db.mjs                # parseDbUrl, buildConnectionString, createPool, connect
│   ├── _lib.db-url.mjs            # DATABASE_URL parsing shared with the app
│   ├── _lib.env.mjs               # loadEnv, requireDatabaseUrl, ROOT
│   ├── _lib.schema.mjs            # getActualSchema, parseExpectedSchema, getDatabaseSummary
│   ├── _lib.schema-introspect.mjs # Live introspection of the connected database
│   ├── _lib.schema-parity.mjs     # Flattens lib/database/schema and parses the version
│   │                              # files, so the boot schema and the migration path
│   │                              # can be compared instead of trusted
│   ├── _lib.table-copy.mjs        # Which tables db:create copies, and in what FK order
│   ├── _lib.target.mjs            # listDatabases, chooseDatabase, formatDbTarget, formatDbHost
│   ├── _lib.meta.mjs              # getProjectMeta, formatBytes, formatDuration
│   ├── _lib.intro.mjs             # confirmIntro
│   ├── _lib.backup.mjs            # Dump/restore plumbing for backup-db + restore-db
│   ├── _lib.corruption-orchestrator.mjs  # Drives every check-*.mjs below
│   ├── _lib.check-*.mjs           # cross-column, encrypted-columns, enums, fk-orphans,
│   │                              # json-shape, timestamps
│   ├── _lib.2fa-diagnostics.mjs   # What db:diagnose-2fa / db:repair-2fa act on
│   ├── _lib.2fa-crypto-mirror.mjs # Mirrors lib/auth crypto so scripts stay dependency-free
│   ├── _lib.2fa-hash-mirror.mjs
│   ├── _lib.api-key-locator-mirror.mjs
│   ├── _lib.app-enums.mjs         # Enum values mirrored from the app
│   └── _lib.encrypted-columns.mjs # Which columns are expected to be encrypted
│
├── maintenance/                   # Diagnose, repair, one-off data migrations
│   ├── db-diagnose.mjs            # Report data corruption (read-only)
│   ├── db-repair.mjs              # Apply what db-diagnose found (dry run by default)
│   ├── db-diagnose-2fa.mjs        # Report inconsistent 2FA rows (read-only)
│   ├── db-repair-2fa.mjs          # Fix only the rows db-diagnose-2fa proved corrupt
│   ├── db-repair-sequences.mjs    # Reset identity sequences after a restore
│   ├── migrate-avatars-to-files.mjs  # One-off: base64 avatars in the DB -> files on disk
│   └── find-duplicate-ids.mjs     # Repo check: duplicate check IDs (run by hand)
│
├── knowledge/                     # Build the AI knowledge files (predev + prebuild)
│   ├── compile-docs-knowledge.mjs # app/docs/**  -> lib/ai/docs-knowledge.md
│   ├── compile-changelog-knowledge.mjs
│   ├── compile-checks-knowledge.mjs  # also writes lib/config/check-stats.generated.ts
│   └── compile-legal-knowledge.mjs
│
├── assets/
│   └── build-og-image.mjs         # Render the Open Graph image (run by hand)
│
├── backup-db.mjs                  # Full dump. Path pinned by lib/backup/run-backup.ts
├── restore-db.mjs                 # Restore a dump written by backup-db
├── vitest-completeness-reporter.mjs  # Vitest reporter, path pinned by vitest.config.ts
│
├── migrate/                       # Version-aware DB migration
│   ├── migrate.mjs                # CLI entry
│   ├── _meta.mjs                  # vulnradar_schema_meta read/write
│   ├── _detect.mjs                # Fingerprint detection (no meta row)
│   ├── _registry.mjs              # Known versions + transitions
│   ├── _planner.mjs               # Build the DDL plan from a transition chain
│   ├── _runner.mjs                # Execute the plan in a transaction
│   └── versions/                  # One file per version transition
│       ├── _snippets.mjs          # Shared DDL constants
│       ├── 1.0.0-to-2.0.0.mjs     # v1 -> v2 (adds billing + badges + broadcasts + ...)
│       ├── 2.0.0-to-1.0.0.mjs     # (down half of above)
│       └── 2.0.0-to-3.0.0.mjs     # v2 -> v3 (folds the 3.0.0-5.9.0 dev tail into one step)
│
├── audit/                         # AUDIT-NNN workflow CLI
│   ├── new.mjs                    # allocates next ID, scaffolds dir
│   ├── list.mjs                   # tabular view
│   ├── show.mjs                   # dump audit + findings
│   ├── add-finding.mjs            # append a finding
│   └── close.mjs                  # transition status (in-progress / closed / shipped)
│
├── create-fresh-db/               # Side-by-side DB copy
│   ├── create-fresh-db.mjs        # CLI entry
│   └── schemas/                   # FROZEN snapshots of older versions
│       ├── instrumentation-v1.ts  # v1 baseline (from git history)
│       └── instrumentation-v2.ts  # v2 baseline
│
└── storage/                       # JSON store behind the audit CLI
```

## Where the schema lives

Not here. `lib/database/schema/` is an ordered array of steps that both
`instrumentation.ts` (every boot) and `npm run db:create` EXECUTE, so the two
cannot build different databases.

That used to be untrue, and silently. The schema was ~4,400 lines of
`pool.query(\`...\`)`inside`instrumentation.ts`, and `db:create`rebuilt it by
reading that file as text. Text extraction cannot resolve a template literal
whose table name comes from a loop variable, and six statements were exactly
that, so a`db:create`d database had no ON DELETE SET NULL foreign keys, no
value-set CHECK constraints, no `updated_at`triggers and no redundant-index
drops.`scripts/_lib/_lib.schema-parity.mjs`still parses source text, but only
for the two frozen snapshots (which are historical files nothing else executes)
and for the three helper modules a schema step names via`moduleSource`.

## Available scripts

| Command                       | What it does                                                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run db:migrate`          | Detect current schema version, let you pick any target, run the migration.                                                                                                                                                     |
| `npm run db:migrate:dry-run`  | Same as above, but the SQL runs inside a rolled-back transaction (no persistent changes).                                                                                                                                      |
| `npm run db:create`           | Create a NEW database. Picks the schema version interactively.                                                                                                                                                                 |
| `npm run db:create:dry-run`   | Preview the create flow (no DB is created, no schema applied, no data copied).                                                                                                                                                 |
| `npm run db:diagnose`         | Introspect the live schema and report data corruption: FK orphans, encrypted columns that will not decrypt, malformed JSON shape, out-of-range enum values, inconsistent cross-column state, impossible timestamps. Read-only. |
| `npm run db:repair`           | Apply the fixes `db:diagnose` found. Dry run by default; real writes need `--apply --admin-id=<id>` and are recorded in `admin_audit_log`.                                                                                     |
| `npm run db:diagnose-2fa`     | Report accounts whose 2FA columns are internally inconsistent. Read-only.                                                                                                                                                      |
| `npm run db:repair-2fa`       | Fix only the rows `db:diagnose-2fa` proved corrupt. It cannot unlock a healthy account.                                                                                                                                        |
| `npm run db:repair-sequences` | Reset identity sequences, the cause of duplicate-key errors on insert after a restore.                                                                                                                                         |
| `npm run db:migrate-avatars`  | One-off backfill: base64 avatars stored in the database become files on disk.                                                                                                                                                  |
| `npm run db:backup`           | Write a full dump. Run this before any upgrade or repair.                                                                                                                                                                      |
| `npm run db:restore`          | Restore a dump written by `db:backup`.                                                                                                                                                                                         |
| `npm run build:knowledge`     | Regenerate every AI knowledge file. CI fails the PR if the committed output is stale.                                                                                                                                          |
| `npm run docs:compile`        | Regenerate `lib/ai/docs-knowledge.md` only.                                                                                                                                                                                    |
| `npm run changelog:compile`   | Regenerate the changelog knowledge file only.                                                                                                                                                                                  |
| `npm run checks:compile`      | Regenerate the checks knowledge file and `lib/config/check-stats.generated.ts`.                                                                                                                                                |
| `npm run legal:compile`       | Regenerate the legal knowledge file only.                                                                                                                                                                                      |
| `npm run audit:new`           | Allocate the next AUDIT-NNN id and scaffold the audit directory.                                                                                                                                                               |
| `npm run audit:list`          | Tabular listing of all audits.                                                                                                                                                                                                 |
| `npm run audit:show`          | Full manifest + findings table for one audit.                                                                                                                                                                                  |
| `npm run audit:add-finding`   | Append a finding to an audit.                                                                                                                                                                                                  |
| `npm run audit:close`         | Transition an audit's status (in-progress / closed / shipped).                                                                                                                                                                 |

`node scripts/maintenance/find-duplicate-ids.mjs` and `node scripts/assets/build-og-image.mjs`
have no npm alias and are run by hand. `find-duplicate-ids.mjs` is on the
pre-commit checklist in AGENTS.md, but no CI workflow runs it, so a duplicate
check ID will not fail a PR on its own. `build-og-image.mjs` rasterizes
`public/og-image.svg` into `public/og-image.png`, substituting `CONFIG_APP_NAME`
and the `CONFIG_APP_URL` hostname into the two `data-og` text nodes, so a
renamed instance regenerates its own social card rather than shipping ours. It
needs `sharp`, which this repo does not declare: install it for the run with
`npm i --no-save sharp`.

### Restoring a backup

`npm run db:restore -- --file=<path> --yes` refuses to run against a database
that still has tables in the `public` schema, because `db:backup` writes a
plain dump with no `DROP` statements and restoring it over an existing schema
fails on every statement. Restore into a fresh database, or pass `--force` when
you know the dump and the target are compatible. psql runs with
`ON_ERROR_STOP=1 --single-transaction`, so the first error aborts and rolls the
whole restore back, and the run finishes by printing the row counts of a few
core tables as positive evidence. An encrypted `.enc` backup is decrypted and
authenticated in full before a single byte reaches psql.

## When something is wrong with the database

Every `diagnose` command is read-only, and every `repair` command acts only
on what its matching diagnose flagged. The order is always the same: back up,
diagnose, read the output, then repair.

```bash
npm run db:backup       # first, always
npm run db:diagnose     # read-only, reports what is wrong
npm run db:repair       # dry run: prints what it WOULD change
```

`db:repair` and `db:repair-2fa` only write when you add
`--apply --admin-id=<id>`, and every real change lands in `admin_audit_log`.

Two special cases:

- **Duplicate-key errors on insert** after restoring a dump mean the identity
  sequences are behind the data. `npm run db:repair-sequences`.
- **Locked out by 2FA** is not a corruption case and `db:repair-2fa` will
  report nothing to do. The escape is a direct `UPDATE` on the account: see
  "Locked out of your own instance" in the
  [self-hosting docs](https://vulnradar.dev/docs/self-hosting#troubleshooting).

## One-off scripts (removed)

Earlier rounds of refactoring produced one-off scripts
(`bulk-add-checks`, `dedup-checks-data`, `split-checks-data`,
`strip-code-*`) that have done their job. The corresponding rewrite
helpers in `scripts/_lib/` (e.g. `rewrite-references.mjs`,
`scan-rewrite.mjs`) are also removed. If you need to re-run one of
those operations, recover it from the git history: they're
preserved as commits, not as files in the tree.

## Version-aware migration

The migrator tracks the database schema state (not the app release
version). Currently three schema versions are known:

| Schema version | Tables | Notes                                                                  |
| -------------- | -----: | ---------------------------------------------------------------------- |
| **1.0.0**      |     19 | Pre-MVP baseline.                                                      |
| **2.0.0**      |     34 | v2 production schema.                                                  |
| **3.0.0**      |     66 | Current production schema (the app is at 3.7.2; schema min is v3.0.0). |

The app's `package.json` is at 3.7.2, well past the schema's 3.0.0 baseline:
releases after a schema version only differ by columns the boot schema
auto-adds, so they are not tracked as separate schema versions.
`2.0.0-to-3.0.0.mjs` folds the whole 3.0.0-through-5.9.0 development tail (old
numbering) into one upgrade step.

If a future release makes a real schema change (new tables), see
"Adding a new schema version" below.

The migrator is driven by a tiny meta table (step zero of the boot schema, so
it is always present):

```sql
CREATE TABLE vulnradar_schema_meta (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  schema_version VARCHAR(20) NOT NULL,
  app_version   VARCHAR(20) NOT NULL,
  applied_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- On every run, the meta row is read first. If it's missing (first run
  on an existing database) or has an unknown version, the migrator
  fingerprint-detects the version by checking which tables are present,
  then writes the meta row so the next run is fast.
- After a successful migration, the meta row is updated to the new
  version.
- `db:create` writes the initial meta row after creating a new DB so
  the migrator sees it on the next run.
- All DDL runs inside a single transaction: if any step fails, the
  whole migration rolls back.

### Adding a new schema version

1. Bump `version` in `package.json` (e.g. `3.7.0` → `4.0.0`).
2. Add the new tables/columns as steps in `lib/database/schema/`. Both the
   boot path and `npm run db:create` execute that array, so there is nothing
   else to keep in step.
3. Add the new version to `scripts/migrate/_registry.mjs` (fingerprint).
4. Create `scripts/migrate/versions/<prev>-to-<new>.mjs` with `upgrade`
   and (if reversible) `downgrade` exports.
5. Run `npm run db:migrate:dry-run` to verify the plan.
6. Run `npm run db:migrate` for real.

### Downgrade support

Every transition file exports both `upgrade` and `downgrade` plans. The
runner picks the right one based on the direction of the migration.
The naming convention is symmetric: a file `1.0.0-to-2.0.0.mjs` handles
both `1.0.0 → 2.0.0` (upgrade) and `2.0.0 → 1.0.0` (downgrade).

Downgrades always require typing `yes-delete-data` to confirm because
they DROP tables and columns.
