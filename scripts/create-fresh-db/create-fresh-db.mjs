#!/usr/bin/env node

/**
 * VulnRadar — Safe Database Migration (Side-by-Side)
 *
 * Creates a NEW database at a chosen schema version, then optionally copies
 * data from the original database. The original database is never modified.
 *
 *   1. Lets you pick which schema version to start with (v1 or v2).
 *   2. Lets you pick which database to copy FROM (or skip the copy).
 *   3. Asks for a name for the NEW database.
 *   4. Creates the target database via the admin connection.
 *   5. Applies the schema for the chosen version.
 *   6. Seeds default badges (v2 only).
 *   7. Optionally copies user data table-by-table (filtered to the
 *      target schema; v2-only tables are flagged in red, not copied).
 *   8. Writes the meta row so the migrator sees the new schema version.
 *
 * Usage:
 *   npm run db:create              # interactive (full flow)
 *   npm run db:create:dry-run      # preview only, no DB changes
 *
 * Requires DATABASE_URL in .env.local or as an environment variable.
 */

import { readFileSync } from "node:fs";
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
  askDanger,
  getProjectMeta,
  createPool,
  connect,
  parseDbUrl,
  formatDbTarget,
  formatDbHost,
  buildConnectionString,
  chooseDatabase,
  getDatabaseSummary,
  confirmIntro,
  requireDatabaseUrl,
} from "../_lib/_lib.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
const SCHEMAS_DIR = resolve(import.meta.dirname, "schemas");

// Only two flags: --dry-run (preview) and --help. The schema version is
// always picked interactively.
let DRY_RUN = false;

// Schema files for each known version. v2.3.0 isn't a separate version —
// it has the same schema as v2 (only api_keys.key_locator differs, and
// instrumentation.ts auto-adds that on app boot). So v2 is the latest.
const SCHEMA_FILES = {
  "1.0.0": resolve(SCHEMAS_DIR, "instrumentation-v1.ts"),
  "2.0.0": resolve(ROOT, "instrumentation.ts"),
};

// Tables that contain user data worth migrating (in FK-safe order).
// Names match the actual schema: `admin_audit_log` (not `audit_log`),
// `scheduled_scans` (not `scan_schedules`). At runtime, the script
// filters this list against the target DB's actual tables — anything
// not in the target is flagged in red, not attempted.
const MIGRATE_TABLES = [
  // v1 baseline
  "users",
  "sessions",
  "password_reset_tokens",
  "api_keys",
  "scan_history",
  "scan_tags",
  "scheduled_scans",
  "teams",
  "team_members",
  "team_invites",
  "admin_audit_log",
  // v2-only
  "billing_history",
  "badges", // before user_badges (FK)
  "user_badges",
  "gifted_subscriptions",
  "admin_notifications",
];

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
async function applySchemaToNewPool(newPool, version) {
  const instrPath = SCHEMA_FILES[version];
  if (!instrPath) {
    error(`No schema file registered for version ${version}.`);
    return { tables: 0, indexes: 0, tableNames: [] };
  }
  let content;
  try {
    content = readFileSync(instrPath, "utf-8");
  } catch (err) {
    error(
      `Failed to read schema file for ${version} (${instrPath}): ${err.message}`,
    );
    return { tables: 0, indexes: 0, tableNames: [] };
  }

  // Pull every await pool.query(`...`) template literal out of the file and
  // split on ';' to get individual statements.
  const sqlBlockRegex = /await pool\.query\(`([\s\S]*?)`\)/g;
  const statements = [];
  let match;
  while ((match = sqlBlockRegex.exec(content)) !== null) {
    const sql = match[1].trim();
    for (const part of sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)) {
      statements.push(part);
    }
  }

  let created = 0;
  let indexes = 0;
  const tableNames = [];
  for (const stmt of statements) {
    try {
      await newPool.query(stmt);
      const upper = stmt.toUpperCase();
      if (upper.includes("CREATE TABLE")) {
        const m = stmt.match(
          /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i,
        );
        if (m) {
          success(`  Created table: ${m[1]}`);
          created++;
          tableNames.push(m[1]);
        }
      } else if (upper.includes("CREATE INDEX")) {
        indexes++;
      }
    } catch (err) {
      if (!err.message.includes("already exists")) {
        warn(`  ${err.message.slice(0, 80)}`);
      }
    }
  }
  log(`  ${c.dim}${indexes} index(es) created${c.reset}`);
  return { tables: created, indexes, tableNames };
}

/**
 * Write the initial meta row so the migrator sees the new database at
 * the chosen schema version. Replaces any existing row (idempotent).
 */
async function writeInitialMetaRow(newPool, schemaVersion, appVersion) {
  try {
    await newPool.query(`
      CREATE TABLE IF NOT EXISTS vulnradar_schema_meta (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        schema_version VARCHAR(20) NOT NULL,
        app_version     VARCHAR(20) NOT NULL,
        applied_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
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
    await newPool.query(`
      INSERT INTO badges (name, display_name, description, color, icon, priority) VALUES
        ('beta_tester', 'Beta Tester', 'Helped test VulnRadar before release', '#8b5cf6', 'flask', 10),
        ('bug_hunter', 'Bug Hunter', 'Reported bugs or security issues', '#ef4444', 'bug', 7),
        ('contributor', 'Contributor', 'Contributed to VulnRadar development', '#10b981', 'code', 8),
        ('premium', 'Premium', 'Premium subscription member', '#fbbf24', 'star', 6),
        ('verified', 'Verified', 'Verified identity', '#06b6d4', 'check-circle', 5),
        ('founder', 'Founder', 'Original founding member', '#f59e0b', 'crown', 20)
      ON CONFLICT (name) DO NOTHING
    `);
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

  // Get target columns + nullability
  const newColRes = await newPool.query(
    `SELECT column_name, is_nullable, data_type FROM information_schema.columns
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

async function migrateData(originalPool, newPool, tablesWithData, newDbTables) {
  section("Step 3: Data Migration");
  info(`Transferring data from source to target...`);
  log("");

  // Filter MIGRATE_TABLES against what's actually in the new DB. Tables
  // not in the target (e.g. v2-only tables when copying to a v1 target)
  // can't be transferred and are skipped with a warning.
  const targetSet = new Set(newDbTables);
  const canCopy = MIGRATE_TABLES.filter((t) => targetSet.has(t));
  const cannotCopy = MIGRATE_TABLES.filter((t) => !targetSet.has(t));

  for (const table of canCopy) {
    const meta = tablesWithData.find((t) => t.name === table);
    if (!meta || meta.count === 0) continue;
    await copyTableData(originalPool, newPool, table, meta.count);
  }

  if (cannotCopy.length > 0) {
    log("");
    for (const table of cannotCopy) {
      const srcCount = tablesWithData.find((t) => t.name === table)?.count ?? 0;
      if (srcCount > 0) {
        warn(
          `  ${c.red}!${c.reset} ${c.bold}${table}${c.reset} ${c.dim}(${srcCount} source rows)${c.reset} — ${c.red}table does not exist in target schema${c.reset}`,
        );
      }
    }
  }
  log("");
  success("Data migration complete.");
}

/**
 * Show a clear data-migration plan: which tables WILL transfer (green)
 * and which CANNOT (red). Helps the user understand what they're about
 * to do before approving.
 */
function showDataMigrationPlan(tablesWithData, newDbTables) {
  const targetSet = new Set(newDbTables);
  const canCopy = [];
  const cannotCopy = [];
  for (const table of MIGRATE_TABLES) {
    const src = tablesWithData.find((t) => t.name === table);
    if (!src || src.count === 0) continue;
    if (targetSet.has(table)) {
      canCopy.push({ table, count: src.count });
    } else {
      cannotCopy.push({ table, count: src.count });
    }
  }
  log("");
  log(`  ${c.bold}Data migration plan:${c.reset}`);
  log("");
  if (canCopy.length === 0 && cannotCopy.length === 0) {
    log(`    ${c.dim}(no data to migrate)${c.reset}`);
  } else {
    for (const { table, count } of canCopy) {
      log(
        `    ${c.green}✓${c.reset} ${c.bold}${table}${c.reset}  ${c.dim}(${count} row${count === 1 ? "" : "s"})${c.reset}`,
      );
    }
    for (const { table, count } of cannotCopy) {
      log(
        `    ${c.red}✗${c.reset} ${c.bold}${table}${c.reset}  ${c.dim}(${count} row${count === 1 ? "" : "s"})${c.reset}  ${c.red}— table not in target schema${c.reset}`,
      );
    }
  }
  log("");
}

/**
 * Query the new DB for the list of public-schema tables.
 */
async function getNewDbTables(newPool) {
  const res = await newPool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  return res.rows.map((r) => r.table_name);
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

The script will ask which schema version to start at (1.0.0 or 2.0.0).
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

    if (!targetVersion) targetVersion = "2.0.0";
    const dryRunSource = sourceParsed.database;
    const dryRunTarget = `${dryRunSource}_v${targetVersion.split(".")[0]}_dryrun`;
    log(`  ${c.dim}Would create:${c.reset} ${c.bold}${dryRunTarget}${c.reset}`);
    log(
      `  ${c.dim}Would apply schema:${c.reset} ${c.bold}v${targetVersion}${c.reset} ${c.dim}(${SCHEMA_FILES[targetVersion].split(/[\\/]/).pop()})${c.reset}`,
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

    const schemaFileContent = readFileSync(
      SCHEMA_FILES[targetVersion],
      "utf-8",
    );
    const tableMatches = [
      ...schemaFileContent.matchAll(
        /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi,
      ),
    ];
    const targetTables = new Set(tableMatches.map((m) => m[1]));

    const tablesWithData = source.tables
      .map((t) => ({ name: t, count: source.counts[t] }))
      .filter((t) => t.count > 0);
    const canCopy = tablesWithData.filter((t) => targetTables.has(t.name));
    const cannotCopy = tablesWithData.filter((t) => !targetTables.has(t.name));

    log(`  ${c.bold}Schema plan (v${targetVersion}):${c.reset}`);
    log(
      `    ${c.cyan}•${c.reset} ${c.bold}${targetTables.size}${c.reset} tables would be created`,
    );
    log(
      `    ${c.cyan}•${c.reset} vulnradar_schema_meta would be created (with row schema_version=v${targetVersion}, app_version=v${meta.version})`,
    );
    log("");

    log(`  ${c.bold}Data migration plan:${c.reset}`);
    log(
      `    ${c.dim}Source: ${dryRunSource} (${source.tables.length} tables, ${source.totalRows} total rows)${c.reset}`,
    );
    log("");
    if (canCopy.length === 0 && cannotCopy.length === 0) {
      log(`    ${c.dim}(no data to migrate)${c.reset}`);
    } else {
      for (const t of canCopy) {
        log(
          `    ${c.green}✓${c.reset} ${c.bold}${t.name}${c.reset}  ${c.dim}(${t.count} row${t.count === 1 ? "" : "s"})${c.reset}`,
        );
      }
      for (const t of cannotCopy) {
        log(
          `    ${c.red}✗${c.reset} ${c.bold}${t.name}${c.reset}  ${c.dim}(${t.count} row${t.count === 1 ? "" : "s"})${c.reset}  ${c.red}— table not in v${targetVersion}${c.reset}`,
        );
      }
    }
    log("");

    success(
      "[DRY-RUN] No changes were made. Run `npm run db:create` to apply.",
    );
    await sourcePool.end();
    return;
  }

  // Pick the target version if not given on the command line.
  if (!targetVersion) {
    const KNOWN = ["1.0.0", "2.0.0"];
    log("");
    log(
      `  ${c.bold}Which schema version should the NEW database start at?${c.reset}`,
    );
    log("");
    log(
      `    ${c.bold}1.${c.reset} ${c.bold}1.0.0${c.reset}  ${c.dim}v1 baseline (19 tables, pre-MVP)${c.reset}`,
    );
    log(
      `    ${c.bold}2.${c.reset} ${c.bold}2.0.0${c.reset}  ${c.dim}v2 / current production (34 tables)${c.reset}  ${c.cyan}← recommended for app v${meta.version}${c.reset}`,
    );
    log(`     ${c.dim} n. Cancel${c.reset}`);
    log("");
    while (true) {
      const answer = (
        await ask(
          `Pick schema version [1, 2, or name; default = 2.0.0]`,
          "2.0.0",
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
  } else if (!SCHEMA_FILES[targetVersion]) {
    error(
      `Unknown version: ${targetVersion}. Known: ${Object.keys(SCHEMA_FILES).join(", ")}`,
    );
    process.exit(1);
  }

  const ok = await confirmIntro({
    title: `VulnRadar ${meta.version} — Create New Database`,
    tagline: `Creates a NEW database at schema v${targetVersion}, leaves the original untouched.`,
    target: formatDbHost(sourceParsed),
    steps: [
      "Let you pick which database to copy FROM (or skip)",
      `Ask for a name for the NEW database (default ends in _v${targetVersion.split(".")[0]})`,
      "Create the target database via the admin connection",
      `Apply the ${targetVersion} schema (${SCHEMA_FILES[targetVersion].split(/[\\/]/).pop()})`,
      targetVersion === "2.0.0"
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
  const tablesWithData = source.tables
    .map((t) => ({ name: t, count: source.counts[t] }))
    .filter((t) => t.count > 0);

  // Compute the data-migration plan once, so the user can see it before
  // approving. The "will copy" set is filtered against the target DB's
  // actual tables (so v2-only tables don't get inserted into a v1 DB).
  const targetSet = new Set(newDbTables);
  const canCopy = MIGRATE_TABLES.filter(
    (t) => targetSet.has(t) && tablesWithData.some((tw) => tw.name === t),
  );
  const cannotCopy = MIGRATE_TABLES.filter(
    (t) => !targetSet.has(t) && tablesWithData.some((tw) => tw.name === t),
  );
  const willMigrate =
    canCopy.length > 0 &&
    (await askYesNo("Migrate data from source database?", true));

  // Seed defaults ONLY if we're not bringing our own badges. Otherwise the
  // source user_badges rows would reference source badge IDs that don't match
  // the freshly-seeded ones. v1 doesn't have badges at all.
  if (
    targetVersion === "2.0.0" &&
    (!willMigrate || !tablesWithData.some((t) => t.name === "badges"))
  ) {
    await seedDefaultBadges(newPool);
  } else if (targetVersion === "1.0.0") {
    info("(skipping default badges — v1 schema has no badges table)");
  } else {
    info("Skipping default badge seed (will copy from source).");
  }

  if (canCopy.length === 0 && cannotCopy.length === 0) {
    log("");
    info("No data to migrate from source database.");
  } else if (willMigrate) {
    section("Step 3: Data Migration");
    showDataMigrationPlan(tablesWithData, newDbTables);
    log("");
    await migrateData(sourcePool, newPool, tablesWithData, newDbTables);
  } else {
    log("");
    info("Skipped data migration.");
    if (cannotCopy.length > 0) {
      log("");
      warn(
        `${cannotCopy.length} table(s) in the source have no equivalent in the target schema and would NOT have been copied:`,
      );
      for (const t of cannotCopy) {
        const src = tablesWithData.find((x) => x.name === t);
        log(
          `    ${c.red}!${c.reset} ${c.bold}${t}${c.reset}  ${c.dim}(${src?.count ?? 0} source rows)${c.reset}  ${c.red}— table not in v${targetVersion}${c.reset}`,
        );
      }
    }
  }

  log("");
  success("Done.");

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
      `    ${c.cyan}•${c.reset} Copied ${c.bold}${canCopy.length}${c.reset} table(s) from source`,
    );
    if (cannotCopy.length > 0) {
      log(
        `    ${c.cyan}•${c.reset} ${c.red}Skipped ${cannotCopy.length} table(s)${c.reset} ${c.dim}(not in v${targetVersion})${c.reset}`,
      );
    }
  } else if (canCopy.length > 0 || cannotCopy.length > 0) {
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
}

main().catch((err) => {
  error(err.message);
  process.exit(1);
});
