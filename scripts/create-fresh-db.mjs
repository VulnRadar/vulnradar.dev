#!/usr/bin/env node

/**
 * VulnRadar — Safe Database Migration (Side-by-Side)
 *
 * Creates a NEW database with the fresh schema, then optionally copies data
 * from the original database. The original database is never modified.
 *
 *   1. Connects to the original (source) database
 *   2. Asks for the new (target) database name
 *   3. Creates the new database via the postgres admin connection
 *   4. Applies the schema from instrumentation.ts
 *   5. Seeds default badges
 *   6. Optionally copies user data table-by-table (with column-mapping)
 *
 * Usage:
 *   npm run db:create
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
} from "./_lib.mjs";

const ROOT = resolve(import.meta.dirname, "..");

// Tables that contain user data worth migrating (in FK-safe order).
const MIGRATE_TABLES = [
  "users",
  "sessions",
  "password_reset_tokens",
  "backup_codes",
  "api_keys",
  "scan_history",
  "scan_schedules",
  "scan_tags",
  "scan_tag_assignments",
  "teams",
  "team_members",
  "team_invites",
  "audit_log",
  "billing_history",
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
  users: {
    subscription_source: "'manual'",
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
async function applySchemaToNewPool(newPool) {
  const instrPath = resolve(ROOT, "instrumentation.ts");
  let content;
  try {
    content = readFileSync(instrPath, "utf-8");
  } catch (err) {
    error(`Failed to read instrumentation.ts: ${err.message}`);
    return { tables: 0, indexes: 0 };
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
  return { tables: created, indexes };
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
  for (const [name, info_] of targetInfo) {
    if (mapping.has(name)) continue;
    if (defaults[name] !== undefined) {
      extraCols.push(name);
      extraVals.push(defaults[name]);
    } else if (info_.is_nullable === "NO" && !info_.column_default) {
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
  for (const row of rows.rows) {
    const values = [
      ...targetNames.map((t) => {
        const v = row[mappingReverseGet(mapping, t)];
        if (v == null) return null;
        if (jsonCols.has(t) && typeof v === "string") {
          try {
            return JSON.parse(v);
          } catch {
            return v;
          }
        }
        return v;
      }),
      ...extraVals,
    ];
    try {
      await newPool.query(
        `INSERT INTO "${table}" (${colList}) VALUES (${placeholders})
         ON CONFLICT DO NOTHING`,
        values,
      );
      inserted++;
    } catch (err) {
      warn(`  Row insert failed in ${table}: ${err.message}`);
    }
  }
  success(`  ${table}: ${inserted}/${rowCount} rows copied`);
  return true;
}

function mappingReverseGet(mapping, targetName) {
  for (const [src, tgt] of mapping) {
    if (tgt === targetName) return src;
  }
  return targetName;
}

async function migrateData(originalPool, newPool, tablesWithData) {
  section("Step 3: Data Migration");
  info(`Transferring data from source to target...`);
  log("");

  // MIGRATE_TABLES is already in FK-safe order.
  for (const table of MIGRATE_TABLES) {
    if (!tablesWithData.includes(table)) continue;
    const meta = tablesWithData.find((t) => t.name === table);
    if (!meta || meta.count === 0) continue;
    await copyTableData(originalPool, newPool, table, meta.count);
  }
  log("");
  success("Data migration complete.");
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const meta = getProjectMeta();

  loadEnv();
  requireDatabaseUrl();

  const sourceParsed = parseDbUrl(process.env.DATABASE_URL);
  if (!sourceParsed) {
    error(
      "Could not parse DATABASE_URL. Make sure it's a valid PostgreSQL connection string.",
    );
    process.exit(1);
  }

  const ok = await confirmIntro({
    title: `VulnRadar ${meta.version} — Create New Database`,
    tagline: "Creates a NEW database, leaves the original untouched.",
    target: formatDbHost(sourceParsed),
    steps: [
      "Let you pick which database to copy FROM",
      "Ask for a name for the NEW database",
      "Create the target database via the postgres admin connection",
      "Apply the schema from instrumentation.ts",
      "Seed default badges",
      "Optionally copy user data table-by-table",
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

  const defaultNewName = `${chosenSource}_v2`;
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
    `    ${c.green}4.${c.reset} Source database ${c.bold}${sourceParsed.database}${c.reset} is ${c.green}NEVER modified${c.reset}`,
  );
  log("");

  if (!(await askYesNo("Proceed with creating the new database?", true))) {
    info("Cancelled.");
    await sourcePool.end();
    return;
  }

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
    `/${sourceParsed.database}`,
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
  section("Step 2: Creating Schema");
  const { tables } = await applySchemaToNewPool(newPool);
  log("");
  success(`Created ${tables} table(s).`);

  // ── Seed default badges ──────────────────────────────────────────────────
  await seedDefaultBadges(newPool);

  // ── Step 3: optionally migrate data ───────────────────────────────────────
  const tablesWithData = source.tables
    .map((t) => ({ name: t, count: source.counts[t] }))
    .filter((t) => t.count > 0);
  const candidates = MIGRATE_TABLES.filter((t) =>
    tablesWithData.some((tw) => tw.name === t),
  );

  if (candidates.length === 0) {
    log("");
    info("No data to migrate from source database.");
  } else {
    section("Data Migration");
    log("  The following tables have data that can be migrated:");
    for (const t of candidates) {
      const meta = tablesWithData.find((x) => x.name === t);
      log(`    - ${t} (${meta.count} rows)`);
    }
    log("");

    if (await askYesNo("Migrate data from source database?", true)) {
      await migrateData(sourcePool, newPool, tablesWithData);
    } else {
      info("Skipped data migration.");
    }
  }

  log("");
  success("Done.");
  log("");
  log(`  ${c.bold}Next steps:${c.reset}`);
  log(
    `    1. Update ${c.bold}.env.local${c.reset} DATABASE_URL to point to ${c.bold}${newDbName}${c.reset}`,
  );
  log(
    `    2. Run ${c.bold}npm run dev${c.reset} to verify the app starts cleanly`,
  );
  log(`    3. If everything looks good, drop the old database manually`);
  log("");

  await newPool.end();
  await sourcePool.end();
}

main().catch((err) => {
  error(err.message);
  process.exit(1);
});
