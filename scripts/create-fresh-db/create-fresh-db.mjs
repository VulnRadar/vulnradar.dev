#!/usr/bin/env node

/**
 * VulnRadar — Safe Database Migration (Side-by-Side)
 *
 * Creates a NEW database at a chosen schema version, then optionally copies
 * data from the original database. The original database is never modified.
 *
 *   1. Lets you pick which schema version to start with (v1, v2, or v3).
 *   2. Lets you pick which database to copy FROM (or skip the copy).
 *   3. Asks for a name for the NEW database.
 *   4. Creates the target database via the admin connection.
 *   5. Applies the schema for the chosen version.
 *   6. Seeds default badges (v2 only).
 *   7. Optionally copies user data table-by-table. The set is derived from
 *      what the two databases actually contain, not from a list in this
 *      file: everything the source and the target both have is copied, in
 *      foreign-key order, and anything skipped is named on screen with a
 *      reason (transient data, or a table the target schema lacks).
 *   8. Writes the meta row so the migrator sees the new schema version.
 *
 * Usage:
 *   npm run db:create              # interactive (full flow)
 *   npm run db:create:dry-run      # preview only, no DB changes
 *
 * Requires DATABASE_URL in .env.local or as an environment variable.
 */

import { resolve } from "node:path";
import pg from "pg";
import {
  c,
  log,
  info,
  success,
  warn,
  error,
  banner,
  section,
  loadEnv,
  ask,
  askYesNo,
  getProjectMeta,
  createPool,
  connect,
  parseDbUrl,
  formatDbHost,
  buildConnectionString,
  chooseDatabase,
  getDatabaseSummary,
  confirmIntro,
  requireDatabaseUrl,
} from "../_lib/_lib.mjs";
import { repairAllSequences } from "../migrate/_runner.mjs";
import {
  readSchemaStatements,
  bootSchemaStatements,
  moduleStepStatements,
} from "../_lib/_lib.schema-parity.mjs";
import { getForeignKeys } from "../_lib/_lib.schema-introspect.mjs";
import { planTableCopy } from "../_lib/_lib.table-copy.mjs";
import {
  applySchema,
  META_TABLE_SQL,
} from "../../lib/database/schema/index.mjs";
import { DEFAULT_BADGES_SQL } from "../../lib/database/schema/seeds.mjs";

const SCHEMAS_DIR = resolve(import.meta.dirname, "schemas");

// Only two flags: --dry-run (preview) and --help. The schema version is
// always picked interactively.
let DRY_RUN = false;

// Where each known schema version comes from.
//
// Older versions are frozen snapshots in schemas/, read as text and replayed
// statement by statement. They are historical artefacts; nothing executes
// them but this script.
//
// The NEWEST version has no file: it is lib/database/schema, the same ordered
// step array instrumentation.ts's register() runs at boot, executed here
// through the same applySchema(). That is the whole point. This script used to
// rebuild the newest schema by reading instrumentation.ts as TEXT, which
// cannot resolve a template literal whose table name comes from a loop
// variable, so a database built here was silently missing four ON DELETE SET
// NULL foreign keys, six CHECK constraints and seven updated_at triggers, and
// nothing compared the two results.
//
// When a new schema version ships: freeze the current schema into
// schemas/instrumentation-v<old>.ts, then add the previous "newest" entry
// here pointing at that snapshot.
const SCHEMA_SOURCES = {
  "1.0.0": { snapshot: resolve(SCHEMAS_DIR, "instrumentation-v1.ts") },
  "2.0.0": { snapshot: resolve(SCHEMAS_DIR, "instrumentation-v2.ts") },
  "3.0.0": { snapshot: null },
};
const KNOWN_VERSIONS = Object.keys(SCHEMA_SOURCES);
const LATEST_VERSION = KNOWN_VERSIONS[KNOWN_VERSIONS.length - 1];

/** What to show an operator as the source of a version's schema. */
function schemaSourceLabel(version) {
  const snapshot = SCHEMA_SOURCES[version]?.snapshot;
  return snapshot ? snapshot.split(/[\\/]/).pop() : "lib/database/schema";
}

// AUDIT-013 migrate-02: there used to be a hardcoded 30-entry
// MIGRATE_TABLES list here, and it drove BOTH the copy loop and the plan
// shown to the operator. 33 of the 63 app tables were not in it, so they
// were never copied and never mentioned: cloning production silently lost
// system_settings, access_rules, webhooks, host_badges, support_tickets
// and thirty more. The copy set is now derived (source tables that the
// target also has) by scripts/_lib/_lib.table-copy.mjs, ordered from the
// target's real foreign keys, and everything skipped is named on screen.
// The only list left is TRANSIENT_TABLES, in that module.

// Hard-coded defaults for v1 -> v2 columns that are NOT NULL but missing in source.
const COLUMN_DEFAULTS = {
  scan_history: {
    summary: "'{}'::jsonb",
    findings: "'[]'::jsonb",
    findings_count: "0",
    duration: "0",
    source: "'web'",
  },
};

// v1 -> v2 column rename hints (old -> new).
const COLUMN_RENAMES = {
  scan_history: {
    results: "findings",
    scan_results: "findings",
    result: "findings",
  },
};

// JSON columns that v1 might store as text.
const JSON_COLUMNS = {
  scan_history: [
    "summary",
    "findings",
    "metadata",
    "results",
    "scan_results",
    "result",
  ],
};

// ── Step 2: apply schema to the new database ────────────────────────────────

/**
 * Count and announce what a batch of executed statements produced. Shared by
 * the two paths below so the operator sees the same summary either way.
 */
function tallyStatements(statements, tally) {
  for (const stmt of statements) {
    const upper = stmt.toUpperCase();
    if (upper.includes("CREATE TABLE")) {
      const m = stmt.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i);
      if (m) {
        success(`  Created table: ${m[1]}`);
        tally.tables++;
        tally.tableNames.push(m[1]);
      }
    } else if (/CREATE\s+(?:UNIQUE\s+)?INDEX/.test(upper)) {
      // A CREATE UNIQUE INDEX statement's uppercased text doesn't contain the
      // literal substring "CREATE INDEX" (UNIQUE sits in between), so a plain
      // .includes() check here silently undercounts the summary.
      tally.indexes++;
    }
  }
}

async function applySchemaToNewPool(newPool, version) {
  const source = SCHEMA_SOURCES[version];
  if (!source) {
    error(`No schema source registered for version ${version}.`);
    return { tables: 0, indexes: 0, tableNames: [] };
  }
  const tally = { tables: 0, indexes: 0, tableNames: [] };

  if (source.snapshot === null) {
    // The live schema. Same module, same ordered steps, same guards
    // instrumentation.ts's register() runs at boot, so a database created
    // here and a database created by `docker compose up` cannot disagree:
    // there is only one list, and both execute it.
    await applySchema(newPool, {
      onApplied: (_step, queries) => tallyStatements(queries, tally),
      // Three steps' DDL is owned by a TypeScript helper module (see
      // moduleStepStatements). This script is plain Node and cannot import
      // TypeScript, so it runs the same statements read out of the same file.
      runModuleStep: async (step) => {
        const statements = moduleStepStatements(step);
        for (const stmt of statements) await newPool.query(stmt);
        return statements;
      },
      onWarn: (step, err) => {
        warn(`  ${step.id}: ${String(err.message ?? err).slice(0, 80)}`);
      },
    });
    log(`  ${c.dim}${tally.indexes} index(es) created${c.reset}`);
    return tally;
  }

  // A frozen snapshot of an older version: text, replayed exactly as frozen.
  let statements;
  try {
    statements = readSchemaStatements(source.snapshot);
  } catch (err) {
    error(
      `Failed to read the v${version} snapshot (${source.snapshot}): ${err.message}`,
    );
    return tally;
  }

  // A snapshot also carries the read-only `pool.query` calls its boot path
  // made (the startup schema-version check, a couple of one-off integrity
  // checks, the sequence-repair introspection). None are schema-mutating,
  // none make sense run out of order against a database with no rows yet, and
  // running them only produces noisy, confusing warnings. Applying a schema
  // means CREATE/ALTER/DROP/INSERT; a bare SELECT never is.
  for (const stmt of statements.filter((s) => !/^\s*SELECT\b/i.test(s))) {
    try {
      await newPool.query(stmt);
      tallyStatements([stmt], tally);
    } catch (err) {
      if (!err.message.includes("already exists")) {
        warn(`  ${err.message.slice(0, 80)}`);
      }
    }
  }
  log(`  ${c.dim}${tally.indexes} index(es) created${c.reset}`);
  return tally;
}

/**
 * Write the initial meta row so the migrator sees the new database at
 * the chosen schema version. Replaces any existing row (idempotent).
 */
async function writeInitialMetaRow(newPool, schemaVersion, appVersion) {
  try {
    // Same DDL the boot path uses, imported rather than retyped: this table
    // used to be written out by hand in three separate places.
    await newPool.query(META_TABLE_SQL);
    await newPool.query(
      `INSERT INTO vulnradar_schema_meta (id, schema_version, app_version, applied_at)
       VALUES (1, $1, $2, NOW())
       ON CONFLICT (id) DO UPDATE
         SET schema_version = EXCLUDED.schema_version,
             app_version     = EXCLUDED.app_version,
             applied_at      = EXCLUDED.applied_at`,
      [schemaVersion, appVersion],
    );
    success(
      `  Wrote meta row: schema_version=${schemaVersion}, app_version=${appVersion}`,
    );
  } catch (err) {
    warn(`  Could not write meta row: ${err.message}`);
  }
}

async function seedDefaultBadges(newPool) {
  info("Seeding default badges...");
  try {
    // Imported, not retyped. This function used to carry its own six-badge
    // list while the boot path seeded eight, and the four names they shared
    // disagreed on icon, colour and priority: a cloned database rendered
    // different badges than the same database booted.
    await newPool.query(DEFAULT_BADGES_SQL);
    success("  Seeded default badges");
  } catch (err) {
    warn(`  Could not seed badges: ${err.message}`);
  }
}

// ── Step 3: copy data from source to target ────────────────────────────────
async function copyTableData(originalPool, newPool, table, rowCount) {
  // Get source columns
  const colRes = await originalPool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = $1 AND table_schema = 'public' ORDER BY ordinal_position`,
    [table],
  );
  const sourceCols = colRes.rows.map((r) => r.column_name);

  // Get target columns + nullability + default expression
  const newColRes = await newPool.query(
    `SELECT column_name, is_nullable, data_type, column_default FROM information_schema.columns
     WHERE table_name = $1 AND table_schema = 'public'`,
    [table],
  );
  const targetInfo = new Map(newColRes.rows.map((r) => [r.column_name, r]));
  const targetCols = new Set(newColRes.rows.map((r) => r.column_name));

  // Build column mapping (source -> target), applying renames.
  const renames = COLUMN_RENAMES[table] || {};
  const mapping = new Map();
  for (const old of sourceCols) {
    if (targetCols.has(old)) mapping.set(old, old);
    else if (renames[old] && targetCols.has(renames[old]))
      mapping.set(old, renames[old]);
  }
  const targetNames = [...mapping.values()];

  // Find NOT NULL columns in target that aren't covered by mapping or defaults.
  const defaults = COLUMN_DEFAULTS[table] || {};
  const extraCols = [];
  const extraVals = [];
  for (const [name, targetColumnInfo] of targetInfo) {
    if (mapping.has(name)) continue;
    if (defaults[name] !== undefined) {
      extraCols.push(name);
      extraVals.push(defaults[name]);
    } else if (
      targetColumnInfo.is_nullable === "NO" &&
      !targetColumnInfo.column_default
    ) {
      warn(
        `  ${table}.${name} is NOT NULL with no default — skipping data copy.`,
      );
      return false;
    }
  }

  // Read all rows from source
  const rows = await originalPool.query(`SELECT * FROM "${table}"`);
  if (rows.rows.length === 0) return true;

  // Build INSERT
  const allCols = [...targetNames, ...extraCols];
  const placeholders = allCols.map((_, i) => `$${i + 1}`).join(", ");
  const colList = allCols.map((c) => `"${c}"`).join(", ");
  const jsonCols = new Set(JSON_COLUMNS[table] || []);

  let inserted = 0;
  let skipped = 0;
  for (const row of rows.rows) {
    const values = [
      ...targetNames.map((t) => {
        const v = row[mappingReverseGet(mapping, t)];
        if (v == null) return null;
        if (jsonCols.has(t)) {
          // Always normalize to a JSON string so pg can cast to JSONB.
          // Handles both TEXT source (parse + re-stringify) and JSONB source
          // (already an object, just stringify). If anything is unserializable
          // (NaN, circular refs, malformed text), set to null and warn.
          try {
            if (typeof v === "string") {
              return JSON.stringify(JSON.parse(v));
            }
            return JSON.stringify(v);
          } catch (err) {
            warn(
              `  Invalid JSON in ${table}.${t}: ${err.message.slice(0, 80)}`,
            );
            return null;
          }
        }
        return v;
      }),
      ...extraVals,
    ];
    try {
      // ON CONFLICT DO NOTHING handles conflicts on ANY unique constraint
      // (PK, name, etc.) by silently skipping. The count below reflects
      // actual inserts, not attempts, so the user sees the real result.
      await newPool.query(
        `INSERT INTO "${table}" (${colList}) VALUES (${placeholders})
         ON CONFLICT DO NOTHING`,
        values,
      );
      inserted++;
    } catch (err) {
      // FK violation: source has orphaned references (e.g. user_badges
      // pointing at a badge_id that no longer exists). Log the row and skip.
      skipped++;
      const msg = err.message || "";
      if (msg.includes("foreign key")) {
        const fkMatch = msg.match(/"([^"]+)"/g);
        const fkHint = fkMatch ? ` (${fkMatch.join(", ")})` : "";
        warn(
          `  Skipped ${table} row (FK violation${fkHint}): ${JSON.stringify(row).slice(0, 120)}`,
        );
      } else {
        warn(`  Row insert failed in ${table}: ${msg}`);
      }
    }
  }
  if (skipped > 0) {
    success(
      `  ${table}: ${inserted}/${rowCount} rows copied (${skipped} skipped due to source data issues)`,
    );
  } else if (inserted < rowCount) {
    success(
      `  ${table}: ${inserted}/${rowCount} rows copied (${rowCount - inserted} skipped — target already has rows with conflicting keys)`,
    );
  } else {
    success(`  ${table}: ${inserted}/${rowCount} rows copied`);
  }
  return true;
}

function mappingReverseGet(mapping, targetName) {
  for (const [src, tgt] of mapping) {
    if (tgt === targetName) return src;
  }
  return targetName;
}

/**
 * Read the target database's foreign keys so the copy inserts parents
 * before children. The TARGET's constraints are the ones that matter: that
 * is where the rows land. Best-effort -- if introspection fails the copy
 * still runs, just in alphabetical order, and any resulting FK violation
 * is reported per row by copyTableData.
 */
async function readTargetForeignKeys(newPool) {
  try {
    return await getForeignKeys(newPool);
  } catch (err) {
    warn(
      `Could not read foreign keys from the target (copy order will be alphabetical): ${err.message}`,
    );
    return [];
  }
}

async function migrateData(originalPool, newPool, plan) {
  info(`Transferring data from source to target...`);
  log("");

  const copied = [];
  const refused = [];
  for (const { table, count } of plan.copy) {
    const ok = await copyTableData(originalPool, newPool, table, count);
    if (ok) copied.push({ table, count });
    else refused.push({ table, count });
  }

  // AUDIT-013 migrate-02: the old version reported nothing about what it
  // had not copied, so 33 tables' worth of loss was invisible both before
  // and after. Every skipped table is named here with the reason.
  if (refused.length > 0) {
    log("");
    for (const { table, count } of refused) {
      warn(
        `  ${c.red}!${c.reset} ${c.bold}${table}${c.reset} ${c.dim}(${count} source rows)${c.reset} — ${c.red}NOT copied: the target has a NOT NULL column with no default that the source cannot supply${c.reset}`,
      );
    }
  }
  if (plan.transient.length > 0) {
    log("");
    info("Deliberately not copied (transient data):");
    for (const { table, count, reason } of plan.transient) {
      log(
        `    ${c.dim}-${c.reset} ${c.bold}${table}${c.reset} ${c.dim}(${count} source rows): ${reason}${c.reset}`,
      );
    }
  }
  if (plan.missingInTarget.length > 0) {
    log("");
    for (const { table, count } of plan.missingInTarget) {
      warn(
        `  ${c.red}!${c.reset} ${c.bold}${table}${c.reset} ${c.dim}(${count} source rows)${c.reset} — ${c.red}table does not exist in target schema, NOT copied${c.reset}`,
      );
    }
  }

  log("");
  success("Data migration complete.");
  return { copied, refused };
}

/**
 * Compare row counts after the copy and shout about any table that lost
 * rows without saying so. copyTableData already reports per-table skips,
 * but only this check can catch a table that was silently short.
 *
 * Returns the list of shortfalls so the caller can set the exit code.
 */
async function verifyCopiedCounts(newPool, copied) {
  const shortfalls = [];
  for (const { table, count } of copied) {
    try {
      const res = await newPool.query(
        `SELECT COUNT(*)::int AS n FROM "${table}"`,
      );
      const got = res.rows[0].n;
      if (got < count) shortfalls.push({ table, expected: count, got });
    } catch (err) {
      shortfalls.push({ table, expected: count, got: `error: ${err.message}` });
    }
  }
  return shortfalls;
}

/**
 * Show a clear data-migration plan before the operator approves it: what
 * transfers, what is deliberately skipped and why, and what cannot be
 * transferred at all.
 */
function showDataMigrationPlan(plan) {
  log("");
  log(`  ${c.bold}Data migration plan:${c.reset}`);
  log("");
  if (
    plan.copy.length === 0 &&
    plan.transient.length === 0 &&
    plan.missingInTarget.length === 0
  ) {
    log(`    ${c.dim}(no data to migrate)${c.reset}`);
    log("");
    return;
  }
  for (const { table, count } of plan.copy) {
    log(
      `    ${c.green}✓${c.reset} ${c.bold}${table}${c.reset}  ${c.dim}(${count} row${count === 1 ? "" : "s"})${c.reset}`,
    );
  }
  for (const { table, count, reason } of plan.transient) {
    log(
      `    ${c.dim}-${c.reset} ${c.bold}${table}${c.reset}  ${c.dim}(${count} row${count === 1 ? "" : "s"})  skipped: ${reason}${c.reset}`,
    );
  }
  for (const { table, count } of plan.missingInTarget) {
    log(
      `    ${c.red}✗${c.reset} ${c.bold}${table}${c.reset}  ${c.dim}(${count} row${count === 1 ? "" : "s"})${c.reset}  ${c.red}— table not in target schema${c.reset}`,
    );
  }
  if (plan.cycles.length > 0) {
    log("");
    warn(
      `  Foreign keys form a cycle between ${plan.cycles.join(", ")}; those are copied last and individual rows may be skipped on a FK violation.`,
    );
  }
  if (plan.unaccounted.length > 0) {
    log("");
    error(
      `  ${plan.unaccounted.length} source table(s) could not be classified and would be silently dropped: ${plan.unaccounted.join(", ")}. This is a bug in scripts/_lib/_lib.table-copy.mjs; do not proceed.`,
    );
  }
  log("");
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const meta = getProjectMeta();

  // Args — only two flags: --dry-run and --help. The version is always
  // picked interactively (no --version flag on purpose; the user wanted
  // a simple command surface).
  const args = process.argv.slice(2);
  let targetVersion = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run" || a === "-n") {
      DRY_RUN = true;
    } else if (a === "--help" || a === "-h") {
      log(`
VulnRadar — Safe Database Migration (Side-by-Side)

Usage:
  npm run db:create                        # interactive (full flow)
  npm run db:create:dry-run                # preview only, no DB changes

The script will ask which schema version to start at (1.0.0, 2.0.0, or 3.0.0).
`);
      process.exit(0);
    } else {
      error(`Unknown flag: ${a}. Only --dry-run and --help are supported.`);
      process.exit(1);
    }
  }

  loadEnv();
  requireDatabaseUrl();

  const sourceParsed = parseDbUrl(process.env.DATABASE_URL);
  if (!sourceParsed) {
    error(
      "Could not parse DATABASE_URL. Make sure it's a valid PostgreSQL connection string.",
    );
    process.exit(1);
  }

  // ── Dry-run short-circuit (before any interactive prompts) ──────────────
  if (DRY_RUN) {
    banner(
      `VulnRadar ${meta.version} — Create New Database [DRY-RUN]`,
      "Preview only. No database will be created, no schema applied, no data copied.",
    );

    // No --version flag exists (by design — see the arg-parsing loop
    // above), so targetVersion is always unset here: default to the
    // latest known schema.
    targetVersion = LATEST_VERSION;
    const dryRunSource = sourceParsed.database;
    const dryRunTarget = `${dryRunSource}_v${targetVersion.split(".")[0]}_dryrun`;
    log(`  ${c.dim}Would create:${c.reset} ${c.bold}${dryRunTarget}${c.reset}`);
    log(
      `  ${c.dim}Would apply schema:${c.reset} ${c.bold}v${targetVersion}${c.reset} ${c.dim}(${schemaSourceLabel(targetVersion)})${c.reset}`,
    );
    log(
      `  ${c.dim}Source database:${c.reset} ${c.bold}${dryRunSource}${c.reset} ${c.dim}(from DATABASE_URL)${c.reset}`,
    );
    log("");

    info("Connecting to source database for plan preview...");
    const sourcePool = createPool();
    if (!(await connect(sourcePool))) {
      await sourcePool.end();
      process.exit(1);
    }
    const source = await getDatabaseSummary(sourcePool);

    // The same statement list the real run executes, so the preview cannot
    // promise a different set of tables than the run creates.
    const targetTables = new Set();
    const previewStatements =
      SCHEMA_SOURCES[targetVersion].snapshot === null
        ? bootSchemaStatements()
        : readSchemaStatements(SCHEMA_SOURCES[targetVersion].snapshot);
    for (const stmt of previewStatements) {
      const m = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/i.exec(
        stmt,
      );
      if (m) targetTables.add(m[1]);
    }

    // No target database exists yet, so there are no foreign keys to read:
    // the preview lists tables alphabetically. The real run orders them
    // parents-first from the target's own constraints.
    const plan = planTableCopy({
      sourceTables: source.tables,
      targetTables: [...targetTables],
      counts: source.counts,
    });

    log(`  ${c.bold}Schema plan (v${targetVersion}):${c.reset}`);
    log(
      `    ${c.cyan}•${c.reset} ${c.bold}${targetTables.size}${c.reset} tables would be created`,
    );
    log(
      `    ${c.cyan}•${c.reset} vulnradar_schema_meta would be created (with row schema_version=v${targetVersion}, app_version=v${meta.version})`,
    );
    log("");

    log(
      `    ${c.dim}Source: ${dryRunSource} (${source.tables.length} tables, ${source.totalRows} total rows)${c.reset}`,
    );
    showDataMigrationPlan(plan);

    success(
      "[DRY-RUN] No changes were made. Run `npm run db:create` to apply.",
    );
    await sourcePool.end();
    return;
  }

  // Ask which target version to use. There is no --version flag (see the
  // arg-parsing loop above), so targetVersion is always unset by this point
  // and this prompt always runs — it always was; the previous `if
  // (!targetVersion)` guard around it was a no-op.
  {
    const KNOWN = KNOWN_VERSIONS;
    const LATEST = LATEST_VERSION;
    const LABELS = {
      "1.0.0": "v1 baseline (19 tables, pre-MVP)",
      "2.0.0": "v2 / production schema (34 tables)",
      "3.0.0": "v3.0 / production schema (46 tables)",
    };
    log("");
    log(
      `  ${c.bold}Which schema version should the NEW database start at?${c.reset}`,
    );
    log("");
    KNOWN.forEach((v, i) => {
      const marker =
        v === LATEST
          ? `  ${c.cyan}← recommended for app v${meta.version}${c.reset}`
          : "";
      log(
        `    ${c.bold}${i + 1}.${c.reset} ${c.bold}${v}${c.reset}  ${c.dim}${LABELS[v] || ""}${c.reset}${marker}`,
      );
    });
    log(`      ${c.dim}n. Cancel${c.reset}`);
    log("");
    while (true) {
      const answer = (
        await ask(
          `Pick schema version [1-${KNOWN.length}, or name; default = ${LATEST}]`,
          LATEST,
        )
      ).trim();
      if (answer.toLowerCase() === "n" || answer.toLowerCase() === "cancel") {
        info("Cancelled.");
        process.exit(0);
      }
      if (KNOWN.includes(answer)) {
        targetVersion = answer;
        break;
      }
      const n = Number(answer);
      if (Number.isInteger(n) && n >= 1 && n <= KNOWN.length) {
        targetVersion = KNOWN[n - 1];
        break;
      }
      warn(`Unknown version: '${answer}'. Try again.`);
    }
  }

  const ok = await confirmIntro({
    title: `VulnRadar ${meta.version} — Create New Database`,
    tagline: `Creates a NEW database at schema v${targetVersion}, leaves the original untouched.`,
    target: formatDbHost(sourceParsed),
    steps: [
      "Let you pick which database to copy FROM (or skip)",
      `Ask for a name for the NEW database (default ends in _v${targetVersion.split(".")[0]})`,
      "Create the target database via the admin connection",
      `Apply the ${targetVersion} schema (${schemaSourceLabel(targetVersion)})`,
      targetVersion !== "1.0.0"
        ? "Seed default badges"
        : "(no badges seed for v1)",
      "Optionally copy user data table-by-table",
      "Write the initial meta row (vulnradar_schema_meta)",
    ],
    warnings: [
      "The source database is never modified.",
      "If the target name already exists you'll be asked before dropping it.",
      "Data copy is best-effort — column mismatches are skipped with a warning.",
    ],
  });
  if (!ok) {
    info("Cancelled.");
    return;
  }

  // Let the user pick which database to copy FROM
  const chosenSource = await chooseDatabase(sourceParsed, {
    currentDb: sourceParsed.database,
    prompt: "Which database to copy FROM",
  });
  if (chosenSource === null) {
    info("Cancelled.");
    return;
  }
  if (chosenSource !== sourceParsed.database) {
    process.env.DATABASE_URL = buildConnectionString(
      sourceParsed,
      chosenSource,
    );
  }
  success(
    `Source: ${c.bold}${chosenSource}${c.reset} on ${c.cyan}${sourceParsed.host}:${sourceParsed.port}${c.reset}`,
  );
  log("");

  info("Connecting to source database...");
  const sourcePool = createPool();
  if (!(await connect(sourcePool))) {
    await sourcePool.end();
    process.exit(1);
  }
  success("Connected.");

  log("");
  const source = await getDatabaseSummary(sourcePool);
  info(
    `Source has ${source.tables.length} tables, ${source.totalRows} total rows.`,
  );
  for (const t of source.tables) {
    const count = source.counts[t];
    const countStr =
      count > 0
        ? `${c.green}${count} rows${c.reset}`
        : `${c.dim}empty${c.reset}`;
    log(`  - ${t} (${countStr})`);
  }
  log("");

  const defaultNewName = `${chosenSource}_v${targetVersion.split(".")[0]}`;
  const newDbName = await ask(
    "Enter name for the NEW database",
    defaultNewName,
  );
  if (newDbName === chosenSource) {
    error("New database name cannot be the same as the source.");
    await sourcePool.end();
    process.exit(1);
  }

  section("Safe Migration Plan");
  log(
    `    ${c.green}1.${c.reset} Create new database: ${c.bold}${newDbName}${c.reset}`,
  );
  log(`    ${c.green}2.${c.reset} Create all tables with fresh schema`);
  log(`    ${c.green}3.${c.reset} Optionally migrate data from source`);
  log(
    `    ${c.green}4.${c.reset} Source database ${c.bold}${chosenSource}${c.reset} is ${c.green}NEVER modified${c.reset}`,
  );
  log("");

  if (!(await askYesNo("Proceed with creating the new database?", true))) {
    info("Cancelled.");
    await sourcePool.end();
    return;
  }

  // (The dry-run short-circuit is at the top of main(), before any
  // interactive prompts. See the block starting at the // ── Dry-run
  // short-circuit comment, right after the DATABASE_URL parse.)

  // ── Create target database ────────────────────────────────────────────────
  // We connect to the source database (not the 'postgres' admin DB) because
  // many managed Postgres providers (Neon, Supabase, RDS) don't expose a
  // 'postgres' database. CREATE DATABASE works from any existing connection.
  section("Step 1: Creating New Database");
  const adminPool = new pg.Pool({
    connectionString: buildConnectionString(sourceParsed, chosenSource),
    connectionTimeoutMillis: 10000,
  });

  try {
    const existsRes = await adminPool.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [newDbName],
    );

    if (existsRes.rows.length > 0) {
      warn(`Database '${newDbName}' already exists.`);
      if (await askYesNo(`Drop and recreate '${newDbName}'?`, false)) {
        await adminPool.query(
          `SELECT pg_terminate_backend(pg_stat_activity.pid)
           FROM pg_stat_activity
           WHERE pg_stat_activity.datname = $1 AND pid <> pg_backend_pid()`,
          [newDbName],
        );
        await adminPool.query(`DROP DATABASE "${newDbName}"`);
        success(`Dropped existing database '${newDbName}'`);
      } else {
        info("Using existing database.");
      }
    }

    const existsAgain = await adminPool.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [newDbName],
    );
    if (existsAgain.rows.length === 0) {
      await adminPool.query(`CREATE DATABASE "${newDbName}"`);
      success(`Created database: ${newDbName}`);
    }
  } catch (err) {
    error(`Failed to create database: ${err.message}`);
    await adminPool.end();
    await sourcePool.end();
    process.exit(1);
  }
  await adminPool.end();

  // ── Connect to new database ───────────────────────────────────────────────
  const newUrl = process.env.DATABASE_URL.replace(
    `/${chosenSource}`,
    `/${newDbName}`,
  );
  const newPool = new pg.Pool({
    connectionString: newUrl,
    connectionTimeoutMillis: 10000,
  });
  try {
    await newPool.query("SELECT 1");
    success(`Connected to new database: ${newDbName}`);
  } catch (err) {
    error(`Failed to connect to new database: ${err.message}`);
    await newPool.end();
    await sourcePool.end();
    process.exit(1);
  }

  // ── Step 2: apply schema ─────────────────────────────────────────────────
  section(`Step 2: Creating Schema (v${targetVersion})`);
  const { tables, tableNames } = await applySchemaToNewPool(
    newPool,
    targetVersion,
  );
  log("");
  success(
    `Created ${tables} table(s) + 1 meta table in ${c.bold}${newDbName}${c.reset}.`,
  );
  // Add the meta table to the in-memory list (it's created in Step 4 below,
  // but we want the data-migration plan to know it exists).
  const newDbTables = [...tableNames, "vulnradar_schema_meta"];

  // ── Step 3: optionally migrate data ───────────────────────────────────────
  // The plan is derived from what the two databases actually contain, not
  // from a list in this file (AUDIT-013 migrate-02). Foreign keys come from
  // the TARGET, since that is where the inserts land.
  const plan = planTableCopy({
    sourceTables: source.tables,
    targetTables: newDbTables,
    counts: source.counts,
    fkEdges: await readTargetForeignKeys(newPool),
  });
  const hasSourceData =
    plan.copy.length > 0 ||
    plan.transient.length > 0 ||
    plan.missingInTarget.length > 0;

  if (plan.unaccounted.length > 0) {
    error(
      `Aborting: ${plan.unaccounted.length} source table(s) with rows could not be classified as copy, skip or missing (${plan.unaccounted.join(", ")}). Copying anyway would drop them silently, which is the exact defect this planner exists to prevent.`,
    );
    await newPool.end();
    await sourcePool.end();
    process.exit(1);
  }

  const willMigrate =
    plan.copy.length > 0 &&
    (await askYesNo("Migrate data from source database?", true));

  // Seed defaults ONLY if we're not bringing our own badges. Otherwise the
  // source user_badges rows would reference source badge IDs that don't match
  // the freshly-seeded ones. v1 doesn't have badges at all.
  const hasBadgesTable = targetVersion !== "1.0.0";
  if (
    hasBadgesTable &&
    (!willMigrate || !plan.copy.some((t) => t.table === "badges"))
  ) {
    await seedDefaultBadges(newPool);
  } else if (!hasBadgesTable) {
    info("(skipping default badges — v1 schema has no badges table)");
  } else {
    info("Skipping default badge seed (will copy from source).");
  }

  let copied = [];
  let refused = [];
  let shortfalls = [];
  if (!hasSourceData) {
    log("");
    info("No data to migrate from source database.");
  } else if (willMigrate) {
    section("Step 3: Data Migration");
    showDataMigrationPlan(plan);
    ({ copied, refused } = await migrateData(sourcePool, newPool, plan));
    // Count-for-count check. copyTableData reports its own per-table skips,
    // but only this catches a table that came up short without saying so.
    shortfalls = await verifyCopiedCounts(newPool, copied);
    if (shortfalls.length > 0) {
      log("");
      error(
        `${shortfalls.length} table(s) have fewer rows in the new database than in the source:`,
      );
      for (const s of shortfalls) {
        log(
          `    ${c.red}!${c.reset} ${c.bold}${s.table}${c.reset}  ${c.dim}source ${s.expected}, target ${s.got}${c.reset}`,
        );
      }
      log("");
      warn(
        "Do NOT cut over to this database until you understand why. The source database is untouched.",
      );
    }
  } else {
    log("");
    info("Skipped data migration.");
    showDataMigrationPlan(plan);
  }

  log("");
  success("Done.");

  // ── Step 3b: repair sequences after any data copy or seed ────────────────
  // Rows inserted with explicit IDs (from the source DB or badge seeds) leave
  // sequences behind the actual MAX(id). Reset them all now so the first
  // INSERT from the app doesn't hit a duplicate-key error.
  {
    const seqClient = await newPool.connect();
    try {
      await repairAllSequences(seqClient);
    } finally {
      seqClient.release();
    }
  }

  // ── Step 4: write the meta row so the migrator sees the new schema version
  section("Step 4: Schema metadata");
  await writeInitialMetaRow(newPool, targetVersion, meta.version);

  // ── Summary ─────────────────────────────────────────────────────────────
  log("");
  log(`  ${c.bold}Summary:${c.reset}`);
  log(
    `    ${c.cyan}•${c.reset} Created ${c.bold}${newDbName}${c.reset} (${tables} tables, v${targetVersion} schema)`,
  );
  if (willMigrate) {
    log(
      `    ${c.cyan}•${c.reset} Copied ${c.bold}${copied.length}${c.reset} of ${plan.copy.length} table(s) from source`,
    );
    if (plan.transient.length > 0) {
      log(
        `    ${c.cyan}•${c.reset} ${c.dim}Skipped ${plan.transient.length} transient table(s) on purpose${c.reset}`,
      );
    }
    if (plan.missingInTarget.length > 0) {
      log(
        `    ${c.cyan}•${c.reset} ${c.red}Skipped ${plan.missingInTarget.length} table(s)${c.reset} ${c.dim}(not in v${targetVersion})${c.reset}`,
      );
    }
    if (refused.length > 0) {
      log(
        `    ${c.cyan}•${c.reset} ${c.red}${refused.length} table(s) could not be copied${c.reset} ${c.dim}(NOT NULL column with no default)${c.reset}`,
      );
    }
    if (shortfalls.length > 0) {
      log(
        `    ${c.cyan}•${c.reset} ${c.red}${shortfalls.length} table(s) came up short -- see above${c.reset}`,
      );
    }
  } else if (hasSourceData) {
    log(`    ${c.cyan}•${c.reset} ${c.dim}Skipped data migration${c.reset}`);
  }
  log(
    `    ${c.cyan}•${c.reset} Wrote meta row: schema_version=v${targetVersion}, app_version=v${meta.version}`,
  );
  log("");
  log(`  ${c.bold}Next steps:${c.reset}`);
  log(
    `    1. Update ${c.bold}.env.local${c.reset} DATABASE_URL to point to ${c.bold}${newDbName}${c.reset}`,
  );
  log(
    `    2. Run ${c.bold}npm run db:migrate${c.reset} to verify the migrator recognises the new schema`,
  );
  log(
    `    3. Run ${c.bold}npm run dev${c.reset} to verify the app starts cleanly`,
  );
  log(`    4. If everything looks good, drop the old database manually`);
  log("");

  await newPool.end();
  await sourcePool.end();

  // A clone that lost rows must not exit 0. The new database is left in
  // place (dropping it would destroy the evidence) but the exit code says
  // the copy is not trustworthy, so a script wrapping this command stops.
  if (shortfalls.length > 0 || refused.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  error(err.message);
  process.exit(1);
});
