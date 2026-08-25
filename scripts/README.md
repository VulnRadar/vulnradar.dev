# scripts/

CLI scripts for the VulnRadar dev workflow. Run with `npm run <name>`.

## Layout

```
scripts/
├── _lib/                         # Shared helpers (used by migrate/ + create-fresh-db/)
│   ├── _lib.mjs                  # Barrel -- re-exports everything below
│   ├── _lib.output.mjs           # Colours, banner, section, log/info/success/warn/error
│   ├── _lib.prompts.mjs          # ask, askYesNo, askDanger, askExact
│   ├── _lib.db.mjs               # parseDbUrl, buildConnectionString, createPool, connect
│   ├── _lib.env.mjs              # loadEnv, requireDatabaseUrl, ROOT
│   ├── _lib.schema.mjs           # getActualSchema, parseExpectedSchema, getDatabaseSummary
│   ├── _lib.target.mjs           # listDatabases, chooseDatabase, formatDbTarget, formatDbHost
│   ├── _lib.meta.mjs             # getProjectMeta, formatBytes, formatDuration
│   └── _lib.intro.mjs            # confirmIntro
│
├── find-duplicate-ids.mjs         # Diagnostic: list duplicate check IDs (CI gate)
│
├── migrate/                      # Version-aware DB migration
│   ├── migrate.mjs               # CLI entry
│   ├── _meta.mjs                 # vulnradar_schema_meta read/write
│   ├── _detect.mjs               # Fingerprint detection (no meta row)
│   ├── _registry.mjs             # Known versions + transitions
│   ├── _planner.mjs              # Build the DDL plan from a transition chain
│   ├── _runner.mjs               # Execute the plan in a transaction
│   └── versions/                 # One file per version transition
│       ├── _snippets.mjs         # Shared DDL constants
│       ├── _legacy-original.mjs  # Archived pre-refactor migrate.mjs
│       ├── 1.0.0-to-2.0.0.mjs    # v1 ↔ v2 (adds billing + badges + broadcasts + ...)
│       ├── 2.0.0-to-1.0.0.mjs    # (down half of above)
│       └── 2.0.0-to-3.0.0.mjs    # v2 → v3 (folds the 3.0.0-5.9.0 dev tail into one step)
│
├── audit/                        # AUDIT-NNN workflow CLI
│   ├── new.mjs                   # create-audit.mjs → allocates next ID, scaffolds dir
│   ├── list.mjs                  # tabular view
│   ├── show.mjs                  # dump audit + findings
│   ├── add-finding.mjs           # append a finding
│   └── close.mjs                 # transition status (in-progress / closed / shipped)
│
└── create-fresh-db/              # Side-by-side DB copy
    ├── create-fresh-db.mjs       # CLI entry
    └── schemas/                  # SQL sources for each version
        └── instrumentation-v1.ts  # v1 baseline (from git history)
```

## Available scripts

| Command                      | What it does                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| `npm run db:migrate`         | Detect current schema version, let you pick any target, run the migration.                |
| `npm run db:migrate:dry-run` | Same as above, but the SQL runs inside a rolled-back transaction (no persistent changes). |
| `npm run db:create`          | Create a NEW database. Picks the schema version interactively.                            |
| `npm run db:create:dry-run`  | Preview the create flow (no DB is created, no schema applied, no data copied).            |
| `npm run audit:new`          | Allocate the next AUDIT-NNN id and scaffold the audit directory.                          |
| `npm run audit:list`         | Tabular listing of all audits.                                                            |
| `npm run audit:show`         | Full manifest + findings table for one audit.                                             |
| `npm run audit:add-finding`  | Append a finding to an audit.                                                              |
| `npm run audit:close`        | Transition an audit's status (in-progress / closed / shipped).                            |

The CI gate `node scripts/find-duplicate-ids.mjs` is also part of the
pre-commit checklist (see AGENTS.md).

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

| Schema version | Tables | Notes                                                                    |
| -------------- | -----: | ------------------------------------------------------------------------ |
| **1.0.0**      |     19 | Pre-MVP baseline.                                                        |
| **2.0.0**      |     34 | v2 production schema.                                                     |
| **3.0.0**      |     47 | Current production schema (the app is at 3.7.0; schema min is v3.0.0).    |

The app's `package.json` is at 3.7.0, well past the schema's 3.0.0
baseline: releases after a schema version only differ by columns that
`instrumentation.ts` auto-adds on boot, so they are not tracked as
separate schema versions. `2.0.0-to-3.0.0.mjs` folds the whole
3.0.0-through-5.9.0 development tail (old numbering) into one upgrade step.

If a future release makes a real schema change (new tables), see
"Adding a new schema version" below.

The migrator is driven by a tiny meta table (also created by
`instrumentation.ts` on every app boot, so it's always present):

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
2. Edit `instrumentation.ts` with the new tables/columns.
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
