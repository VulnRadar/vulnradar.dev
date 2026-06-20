# scripts/

CLI scripts for the VulnRadar dev workflow. Run with `npm run <name>`.

## Layout

```
scripts/
├── _lib/                         # Shared helpers (split by concern)
│   ├── _lib.mjs                  # Barrel — re-exports everything below
│   ├── _lib.output.mjs           # Colours, banner, section, log/info/success/warn/error
│   ├── _lib.prompts.mjs          # ask, askYesNo, askDanger, askExact
│   ├── _lib.db.mjs               # parseDbUrl, buildConnectionString, createPool, connect
│   ├── _lib.env.mjs              # loadEnv, requireDatabaseUrl, ROOT
│   ├── _lib.schema.mjs           # getActualSchema, parseExpectedSchema, getDatabaseSummary
│   ├── _lib.target.mjs           # listDatabases, chooseDatabase, formatDbTarget, formatDbHost
│   ├── _lib.meta.mjs             # getProjectMeta, formatBytes, formatDuration
│   └── _lib.intro.mjs            # confirmIntro
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
│       └── 2.0.0-to-1.0.0.mjs    # (down half of above)
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

Both scripts accept only `--dry-run` and `--help` — there are no `--version` / `--to` flags. Versions are always picked interactively. The `db:create:dry-run` and `db:migrate:dry-run` wrappers are dedicated npm scripts so you can use them without the extra `--` separator that npm needs for custom flags.

## Version-aware migration

The migrator tracks the database schema state (not the app release
version). Currently two schema versions are known:

| Schema version | Tables | Notes                                                       |
| -------------- | -----: | ----------------------------------------------------------- |
| **1.0.0**      |     19 | Pre-MVP baseline.                                           |
| **2.0.0**      |     34 | Current production schema. Same as the app's 2.3.0 release. |

The app's `package.json` is currently at 2.3.0 but the schema is the
same as v2 — the only difference is `api_keys.key_locator`, which
`instrumentation.ts` auto-adds on app boot. So we don't track v2.3.0 as
a separate version in the framework.

If your app moves to a release with a real schema change (e.g. v3.0.0
adds new tables), see "Adding a new schema version" below.

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
- All DDL runs inside a single transaction — if any step fails, the
  whole migration rolls back.

### Adding a new schema version

1. Bump `version` in `package.json` (e.g. `2.3.0` → `3.0.0`).
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
