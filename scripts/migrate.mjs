#!/usr/bin/env node

/**
 * VulnRadar — Database Migration Script
 *
 * Connects to the database, compares the live schema against the expected
 * schema declared in `instrumentation.ts`, and offers to apply the diff.
 *
 *   - Detects v1 -> v2 schema drift and runs the v1-to-v2 upgrade path
 *   - Detects missing/extra tables and columns
 *   - Applies renames from TABLE_RENAMES / COLUMN_RENAMES (with confirmation)
 *   - Asks before every destructive change
 *
 * Usage:
 *   npm run db:migrate
 *   node scripts/migrate.mjs --v2      # force v2 check
 *   node scripts/migrate.mjs --fresh   # drop everything and start over
 *
 * Requires DATABASE_URL in .env.local or as an environment variable.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  askYesNo,
  askDanger,
  getProjectMeta,
  createPool,
  connect,
  confirmIntro,
  requireDatabaseUrl,
  parseDbUrl,
  formatDbTarget,
  formatDbHost,
  buildConnectionString,
  chooseDatabase,
  ROOT,
} from "./_lib.mjs";

// ── v1 / v2 schema knowledge ───────────────────────────────────────────────
const V1_CORE_TABLES = [
  "admin_audit_log",
  "api_keys",
  "api_usage",
  "data_requests",
  "device_trust",
  "email_2fa_codes",
  "email_verification_tokens",
  "notification_preferences",
  "password_reset_tokens",
  "rate_limits",
  "scan_history",
  "scan_tags",
  "scheduled_scans",
  "sessions",
  "team_invites",
  "team_members",
  "teams",
  "users",
  "webhooks",
];

const V2_NEW_TABLES = [
  "badges",
  "user_badges",
  "billing_history",
  "gifted_subscriptions",
  "admin_notifications",
  "admin_user_notes",
];

const V2_USER_COLUMNS = [
  "plan",
  "stripe_customer_id",
  "stripe_subscription_id",
  "subscription_status",
  "subscription_current_period_end",
  "stripe_subscription_metadata",
  "beta_access",
  "email_session_revoked",
];

// Edit these when you rename a table or column. The migration script will
// detect the old name in the live DB and offer to rename it.
const TABLE_RENAMES = {};
const COLUMN_RENAMES = {};

// ── Expected schema (parsed from instrumentation.ts) ───────────────────────
function parseExpectedSchema() {
  const filePath = resolve(ROOT, "instrumentation.ts");
  const content = readFileSync(filePath, "utf-8");

  const tables = {};
  const SQL_TYPES =
    /^(SERIAL|BIGSERIAL|INTEGER|INT|SMALLINT|VARCHAR|TEXT|BOOLEAN|BOOL|TIMESTAMP|TIMESTAMPTZ|JSONB|JSON|BIGINT|UUID|REAL|FLOAT|DOUBLE|NUMERIC|DECIMAL|DATE|TIME|BYTEA|INET|CIDR|MACADDR)\b/i;
  const SKIP_KEYWORDS =
    /^(UNIQUE|PRIMARY\s+KEY|FOREIGN\s+KEY|CHECK|CONSTRAINT)/i;

  let currentTable = null;
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();

    const tableMatch = line.match(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/i,
    );
    if (tableMatch) {
      currentTable = tableMatch[1];
      if (!tables[currentTable]) tables[currentTable] = new Set();

      const afterParen = line.split("(").slice(1).join("(").trim();
      if (afterParen) {
        const colToken = afterParen.replace(/,\s*$/, "").trim();
        const parts = colToken.split(/\s+/);
        if (parts.length >= 2 && SQL_TYPES.test(parts[1])) {
          tables[currentTable].add(parts[0].replace(/"/g, "").toLowerCase());
        }
      }
      continue;
    }

    if (currentTable && /^\);?\s*$/.test(line)) {
      currentTable = null;
      continue;
    }

    if (currentTable) {
      const cleaned = line
        .replace(/,\s*$/, "")
        .replace(/\)\s*;?\s*$/, "")
        .trim();
      if (!cleaned || SKIP_KEYWORDS.test(cleaned) || cleaned.startsWith("--"))
        continue;

      const parts = cleaned.split(/\s+/);
      if (parts.length >= 2) {
        const colName = parts[0].replace(/"/g, "");
        const colType = parts[1];
        if (/^\w+$/.test(colName) && SQL_TYPES.test(colType)) {
          tables[currentTable].add(colName.toLowerCase());
        }
      }
    }

    const alterMatch = line.match(
      /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?("?\w+"?)\s+/i,
    );
    if (alterMatch) {
      const tbl = alterMatch[1];
      const col = alterMatch[2].replace(/"/g, "").toLowerCase();
      if (!tables[tbl]) tables[tbl] = new Set();
      tables[tbl].add(col);
    }
  }

  const result = {};
  for (const [table, cols] of Object.entries(tables)) {
    result[table] = [...cols].sort();
  }
  return result;
}

// ── Live schema from information_schema ────────────────────────────────────
async function getActualSchema(pool) {
  const res = await pool.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);
  const tables = {};
  for (const row of res.rows) {
    const t = row.table_name;
    if (!tables[t]) tables[t] = [];
    tables[t].push(row.column_name.toLowerCase());
  }
  return tables;
}

// ── v1 detection ───────────────────────────────────────────────────────────
function detectV1Database(actual) {
  if (!actual["users"]) return { isV1: false, reason: "No users table found" };

  const missingV2Tables = V2_NEW_TABLES.filter((t) => !actual[t]);
  const missingV2Columns = V2_USER_COLUMNS.filter(
    (col) => !(actual["users"] || []).includes(col),
  );

  return {
    isV1: missingV2Tables.length > 0,
    missingTables: missingV2Tables,
    missingColumns: missingV2Columns,
    hasV1CoreTables: V1_CORE_TABLES.filter((t) => actual[t]).length,
  };
}

// ── v1 -> v2 upgrade path ──────────────────────────────────────────────────
async function runV2Migration(pool, actual, v1Info) {
  section("V1 -> V2 MIGRATION DETECTED");
  warn("Your database is running the VulnRadar v1 schema.");
  info("Missing tables: " + v1Info.missingTables.length);
  info("Missing user columns: " + v1Info.missingColumns.length);
  log("");
  info("What this will do:");
  log(
    `    ${c.cyan}•${c.reset} Add new columns to the ${c.bold}users${c.reset} table`,
  );
  log(
    `    ${c.cyan}•${c.reset} Create new tables: ${c.bold}badges${c.reset}, ${c.bold}user_badges${c.reset}, ${c.bold}billing_history${c.reset}`,
  );
  log(
    `    ${c.cyan}•${c.reset} Set defaults (plan = 'free', beta_access = false)`,
  );
  log("");

  if (!(await askYesNo("Proceed with v2 migration?"))) {
    info("Cancelled. Your database was not modified.");
    return false;
  }

  log("");
  info("Starting v2 migration...");

  const newUserColumns = [
    { name: "plan", def: "VARCHAR(50) DEFAULT 'free'" },
    { name: "stripe_customer_id", def: "VARCHAR(255)" },
    { name: "stripe_subscription_id", def: "VARCHAR(255)" },
    { name: "subscription_status", def: "VARCHAR(50)" },
    {
      name: "subscription_current_period_end",
      def: "TIMESTAMP",
    },
    { name: "stripe_subscription_metadata", def: "JSONB" },
    { name: "beta_access", def: "BOOLEAN DEFAULT FALSE" },
  ];

  info("Adding new columns to users table...");
  for (const col of newUserColumns) {
    try {
      await pool.query(
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col.name} ${col.def}`,
      );
      success(`  users.${col.name}`);
    } catch (err) {
      if (!err.message.includes("already exists")) {
        error(`  users.${col.name}: ${err.message}`);
      }
    }
  }

  // Fix subscription_status default to NULL for new rows
  try {
    await pool.query(
      `ALTER TABLE users ALTER COLUMN subscription_status SET DEFAULT NULL`,
    );
    await pool.query(
      `UPDATE users SET subscription_status = NULL WHERE subscription_status = 'active' AND stripe_subscription_id IS NULL AND plan = 'free'`,
    );
    success("  Fixed subscription_status default to NULL");
  } catch {
    /* column may not exist yet */
  }

  const v2TableSQL = {
    badges: `
      CREATE TABLE IF NOT EXISTS badges (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        display_name VARCHAR(255) NOT NULL,
        description TEXT,
        color VARCHAR(7) DEFAULT '#6366f1',
        icon VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW()
      )`,
    user_badges: `
      CREATE TABLE IF NOT EXISTS user_badges (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        badge_id INTEGER NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
        awarded_at TIMESTAMP DEFAULT NOW(),
        awarded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE(user_id, badge_id)
      )`,
    billing_history: `
      CREATE TABLE IF NOT EXISTS billing_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stripe_invoice_id VARCHAR(255) UNIQUE,
        stripe_payment_intent_id VARCHAR(255),
        amount_cents INTEGER NOT NULL,
        currency VARCHAR(10) NOT NULL DEFAULT 'usd',
        status VARCHAR(50) NOT NULL,
        description TEXT,
        invoice_pdf_url TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )`,
    admin_user_notes: `
      CREATE TABLE IF NOT EXISTS admin_user_notes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        note TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )`,
    discord_connections: `
      CREATE TABLE IF NOT EXISTS discord_connections (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        discord_id VARCHAR(64) NOT NULL UNIQUE,
        discord_username VARCHAR(100) NOT NULL,
        discord_discriminator VARCHAR(10),
        discord_avatar VARCHAR(255),
        discord_email VARCHAR(255),
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        token_expires_at TIMESTAMP WITH TIME ZONE,
        guild_joined BOOLEAN NOT NULL DEFAULT false,
        connected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )`,
    gifted_subscriptions: `
      CREATE TABLE IF NOT EXISTS gifted_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        gifted_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plan VARCHAR(50) NOT NULL,
        reason TEXT,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        revoked_at TIMESTAMP WITH TIME ZONE,
        revoked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )`,
    admin_notifications: `
      CREATE TABLE IF NOT EXISTS admin_notifications (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        type VARCHAR(20) NOT NULL DEFAULT 'bell' CHECK (type IN ('banner', 'modal', 'toast', 'bell')),
        variant VARCHAR(20) NOT NULL DEFAULT 'info' CHECK (variant IN ('info', 'success', 'warning', 'error')),
        audience VARCHAR(20) NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'authenticated', 'unauthenticated', 'admin', 'staff')),
        path_pattern VARCHAR(255) DEFAULT NULL,
        starts_at TIMESTAMPTZ DEFAULT NOW(),
        ends_at TIMESTAMPTZ DEFAULT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        is_dismissible BOOLEAN NOT NULL DEFAULT true,
        dismiss_duration_hours INTEGER DEFAULT NULL,
        action_label VARCHAR(100) DEFAULT NULL,
        action_url VARCHAR(500) DEFAULT NULL,
        action_external BOOLEAN DEFAULT false,
        priority INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
  };

  for (const [table, sql] of Object.entries(v2TableSQL)) {
    if (actual[table]) continue;
    info(`Creating ${table} table...`);
    try {
      await pool.query(sql);
      success(`  Created ${table}`);
    } catch (err) {
      error(`  Failed to create ${table}: ${err.message}`);
    }
  }

  // Add missing user columns
  const userAdditions = [
    "email_session_revoked BOOLEAN NOT NULL DEFAULT false",
    "discord_id VARCHAR(64) UNIQUE",
    "daily_scan_limit INTEGER DEFAULT NULL",
  ];
  for (const def of userAdditions) {
    const parts = def.trim().split(/\s+/);
    const colName = parts[0];
    const colDef = parts.slice(1).join(" ");
    try {
      await pool.query(
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS ${colName} ${colDef}`,
      );
      success(`  Added users.${colName}`);
    } catch (err) {
      warn(`  Skipped users.${colName}: ${err.message}`);
    }
  }

  // api_keys additions
  const apiKeyAdditions = [
    "daily_limit INTEGER DEFAULT 50",
    "key_encrypted TEXT",
  ];
  for (const def of apiKeyAdditions) {
    const parts = def.trim().split(/\s+/);
    const colName = parts[0];
    const colDef = parts.slice(1).join(" ");
    try {
      await pool.query(
        `ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS ${colName} ${colDef}`,
      );
      success(`  Added api_keys.${colName}`);
    } catch (err) {
      warn(`  Skipped api_keys.${colName}: ${err.message}`);
    }
  }

  // notification_preferences additions
  const notifColumns = [
    "email_session_revoked BOOLEAN NOT NULL DEFAULT true",
    "email_regression_alert BOOLEAN NOT NULL DEFAULT true",
    "email_schedules BOOLEAN NOT NULL DEFAULT true",
    "email_api_limit_warning BOOLEAN NOT NULL DEFAULT true",
    "email_webhook_failure BOOLEAN NOT NULL DEFAULT true",
    "email_data_requests BOOLEAN NOT NULL DEFAULT true",
    "email_account_deletion BOOLEAN NOT NULL DEFAULT true",
    "email_team_invite BOOLEAN NOT NULL DEFAULT true",
    "email_team_changes BOOLEAN NOT NULL DEFAULT true",
  ];
  for (const def of notifColumns) {
    try {
      await pool.query(
        `ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS ${def}`,
      );
    } catch (err) {
      warn(
        `  Could not ensure notification_preferences column (${def}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  success("  notification_preferences columns ensured");

  // billing_history backfill column for older v2 installs
  try {
    await pool.query(
      `ALTER TABLE billing_history ADD COLUMN IF NOT EXISTS stripe_payment_intent_id VARCHAR(255)`,
    );
  } catch {
    /* already exists */
  }

  log("");
  success("V2 migration complete.");
  info(
    "New: badges, billing history, subscription management, admin notifications.",
  );
  return true;
}

// ── Fresh install: drop everything ─────────────────────────────────────────
async function runFreshInstall(pool, actual) {
  section("FRESH INSTALL MODE");
  error("This will DROP ALL TABLES and recreate the database.");
  error("All existing data will be permanently deleted.");
  log("");

  const existingTables = Object.keys(actual);
  if (existingTables.length > 0) {
    log("  Tables that will be dropped:");
    for (const t of existingTables) {
      try {
        const countRes = await pool.query(
          `SELECT COUNT(*)::int AS n FROM "${t}"`,
        );
        log(
          `    - ${c.bold}${t}${c.reset} ${c.dim}(${countRes.rows[0].n} rows)${c.reset}`,
        );
      } catch {
        log(`    - ${c.bold}${t}${c.reset}`);
      }
    }
    log("");
  }

  if (!(await askDanger("Delete ALL data and start fresh?"))) {
    info("Cancelled.");
    return false;
  }
  if (!(await askDanger("Type y again to confirm PERMANENT DATA DELETION."))) {
    info("Cancelled.");
    return false;
  }

  log("");
  info("Dropping all tables...");
  for (const table of existingTables) {
    try {
      await pool.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
      success(`  Dropped ${table}`);
    } catch (err) {
      warn(`  Could not drop ${table}: ${err.message}`);
    }
  }
  log("");
  success("All tables dropped. Start the app to recreate the schema.");
  return true;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const meta = getProjectMeta();
  const args = process.argv.slice(2);
  const forceV2 = args.includes("--v2");
  const freshInstall = args.includes("--fresh");

  loadEnv();
  requireDatabaseUrl();

  const sourceParsed = parseDbUrl(process.env.DATABASE_URL);
  if (!sourceParsed) {
    error("Could not parse DATABASE_URL.");
    process.exit(1);
  }

  const ok = await confirmIntro({
    title: `VulnRadar ${meta.version} — Database Migration`,
    tagline: "Compares live schema to instrumentation.ts and applies the diff.",
    target: formatDbHost(sourceParsed),
    steps: [
      "Connect to the database and read every table/column",
      "Detect v1 -> v2 drift and offer the upgrade path",
      "Detect renames declared in TABLE_RENAMES / COLUMN_RENAMES",
      "Compare against the expected schema in instrumentation.ts",
      "Ask before each additive or destructive change",
    ],
    warnings: [
      "Always back up your database before running migrations.",
      "Destructive changes (dropping tables/columns) require explicit 'y'.",
    ],
    destructive: freshInstall,
  });
  if (!ok) {
    info("Cancelled. Your database was not modified.");
    return;
  }

  // Let the user pick which database to migrate (lists all on the host)
  const chosenDb = await chooseDatabase(sourceParsed, {
    currentDb: sourceParsed.database,
    prompt: "Which database to migrate",
  });
  if (chosenDb === null) {
    info("Cancelled. Your database was not modified.");
    return;
  }
  if (chosenDb !== sourceParsed.database) {
    process.env.DATABASE_URL = buildConnectionString(sourceParsed, chosenDb);
  }
  success(
    `Target: ${c.bold}${chosenDb}${c.reset} on ${c.cyan}${sourceParsed.host}:${sourceParsed.port}${c.reset}`,
  );
  log("");

  const pool = createPool();
  if (!(await connect(pool))) {
    await pool.end();
    process.exit(1);
  }
  success("Connected.");

  log("");
  info("Reading actual database schema...");
  const actual = await getActualSchema(pool);
  success(`Found ${Object.keys(actual).length} tables.`);

  if (freshInstall) {
    await runFreshInstall(pool, actual);
    await pool.end();
    return;
  }

  // v1 -> v2
  const v1Info = detectV1Database(actual);
  if (v1Info.isV1 || forceV2) {
    if (v1Info.isV1) {
      section("V1 DATABASE DETECTED");
      warn(`Your database is running VulnRadar v1 schema.`);
      log(
        `  Missing ${v1Info.missingTables.length} tables, ${v1Info.missingColumns.length} user columns.`,
      );
      log("");
      info("Recommendation: run `npm run db:create` for a clean v2 install.");
      info("This script will attempt an additive migration if you continue.");
      log("");
      if (!(await askYesNo("Continue with incremental v1 -> v2 migration?"))) {
        info("Cancelled. Run `npm run db:create` for a fresh install.");
        await pool.end();
        return;
      }
      const migrated = await runV2Migration(pool, actual, v1Info);
      if (migrated) {
        info("Re-reading database schema after migration...");
        Object.assign(actual, await getActualSchema(pool));
      }
    } else if (forceV2) {
      info("Database already has all v2 tables and columns.");
    }
  }

  log("");
  info("Parsing expected schema from instrumentation.ts...");
  let expected;
  try {
    expected = parseExpectedSchema();
    success(`Found ${Object.keys(expected).length} expected tables.`);
  } catch (err) {
    error(`Failed to parse instrumentation.ts: ${err.message}`);
    await pool.end();
    process.exit(1);
  }

  // Phase 1: table renames
  const pendingTableRenames = [];
  for (const [oldName, newName] of Object.entries(TABLE_RENAMES)) {
    if (actual[oldName] && !actual[newName] && expected[newName]) {
      pendingTableRenames.push({ oldName, newName });
    }
  }
  if (pendingTableRenames.length > 0) {
    section("Table Renames Detected");
    for (const { oldName, newName } of pendingTableRenames) {
      log(
        `  ${c.magenta}RENAME${c.reset}  ${c.bold}${oldName}${c.reset} ${c.dim}->${c.reset} ${c.bold}${newName}${c.reset}`,
      );
      if (
        await askYesNo(
          `Rename table ${c.bold}${oldName}${c.reset} to ${c.bold}${newName}${c.reset}?`,
        )
      ) {
        try {
          await pool.query(`ALTER TABLE "${oldName}" RENAME TO "${newName}"`);
          success(`Renamed ${oldName} -> ${newName}`);
          actual[newName] = actual[oldName];
          delete actual[oldName];
        } catch (err) {
          error(`Rename failed: ${err.message}`);
        }
      }
    }
  }

  // Phase 2: column renames
  const pendingColRenames = [];
  for (const [table, renames] of Object.entries(COLUMN_RENAMES)) {
    if (!actual[table] || !expected[table]) continue;
    for (const [oldCol, newCol] of Object.entries(renames)) {
      if (
        actual[table].includes(oldCol) &&
        !actual[table].includes(newCol) &&
        expected[table].includes(newCol)
      ) {
        pendingColRenames.push({ table, oldCol, newCol });
      }
    }
  }
  if (pendingColRenames.length > 0) {
    section("Column Renames Detected");
    for (const { table, oldCol, newCol } of pendingColRenames) {
      if (
        await askYesNo(
          `Rename column ${c.bold}${table}.${oldCol}${c.reset} to ${c.bold}${newCol}${c.reset}?`,
        )
      ) {
        try {
          await pool.query(
            `ALTER TABLE "${table}" RENAME COLUMN "${oldCol}" TO "${newCol}"`,
          );
          success(`Renamed ${table}.${oldCol} -> ${newCol}`);
          const idx = actual[table].indexOf(oldCol);
          if (idx !== -1) actual[table][idx] = newCol;
        } catch (err) {
          error(`Rename failed: ${err.message}`);
        }
      }
    }
  }

  // Phase 3: schema comparison
  section("Schema Comparison");
  const missingTables = [];
  const missingColumns = [];
  const extraColumns = [];

  for (const [table, expectedCols] of Object.entries(expected)) {
    if (!actual[table]) {
      missingTables.push(table);
      log(
        `  ${c.red}MISSING${c.reset}  ${c.bold}${table}${c.reset} ${c.dim}(${expectedCols.length} columns)${c.reset}`,
      );
      continue;
    }
    const actualCols = actual[table];
    const missing = expectedCols.filter((col) => !actualCols.includes(col));
    const extra = actualCols.filter((col) => !expectedCols.includes(col));
    if (missing.length === 0 && extra.length === 0) {
      log(
        `  ${c.green}OK${c.reset}      ${c.bold}${table}${c.reset} ${c.dim}(${actualCols.length} columns)${c.reset}`,
      );
    } else {
      log(`  ${c.yellow}DIFF${c.reset}    ${c.bold}${table}${c.reset}`);
      for (const col of missing) {
        log(`              ${c.red}+ missing:${c.reset} ${col}`);
        missingColumns.push({ table, column: col });
      }
      for (const col of extra) {
        log(`              ${c.yellow}~ extra:${c.reset}   ${col}`);
        extraColumns.push({ table, column: col });
      }
    }
  }

  const unknownTables = Object.keys(actual).filter((t) => !expected[t]);
  if (unknownTables.length > 0) {
    for (const t of unknownTables) {
      log(
        `  ${c.yellow}EXTRA${c.reset}   ${c.bold}${t}${c.reset} ${c.dim}(${actual[t].length} columns, not in schema)${c.reset}`,
      );
    }
  }
  log("");

  if (
    missingTables.length === 0 &&
    missingColumns.length === 0 &&
    extraColumns.length === 0 &&
    unknownTables.length === 0
  ) {
    success("Schema is fully up to date. Nothing to do.");
    await pool.end();
    return;
  }

  // Missing tables: app auto-creates on boot
  if (missingTables.length > 0) {
    warn(`${missingTables.length} missing table(s).`);
    info("These are created automatically on `npm run dev`.");
  }

  // Missing columns: offer to add now
  if (missingColumns.length > 0) {
    warn(`${missingColumns.length} missing column(s).`);
    if (
      await askYesNo(
        `Review and add ${missingColumns.length} missing column(s) now?`,
      )
    ) {
      const filePath = resolve(ROOT, "instrumentation.ts");
      const content = readFileSync(filePath, "utf-8");
      for (const { table, column } of missingColumns) {
        const alterRegex = new RegExp(
          `ALTER\\s+TABLE\\s+${table}\\s+ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${column}\\s+([^;]+)`,
          "i",
        );
        const alterMatch = content.match(alterRegex);
        if (!alterMatch) {
          warn(
            `No definition found for ${table}.${column}; will be created on app boot.`,
          );
          continue;
        }
        if (
          await askDanger(`Add column ${c.bold}${table}.${column}${c.reset}?`)
        ) {
          try {
            const def = alterMatch[1].split(";")[0].trim();
            await pool.query(
              `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${def}`,
            );
            success(`Added ${table}.${column}`);
          } catch (err) {
            error(`Failed to add ${table}.${column}: ${err.message}`);
          }
        }
      }
    }
  }

  // Extra columns: warn, offer to drop
  if (extraColumns.length > 0) {
    warn(`${extraColumns.length} extra column(s) not in the current schema.`);
    info("These may be from custom modifications or older versions.");
    error("Dropping columns permanently deletes their data.");
    if (await askYesNo("Review extra columns?")) {
      for (const { table, column } of extraColumns) {
        log("");
        log(
          `  Table: ${c.bold}${table}${c.reset}  Column: ${c.bold}${column}${c.reset}`,
        );
        try {
          const countRes = await pool.query(
            `SELECT COUNT(*)::int AS total, COUNT("${column}")::int AS non_null FROM "${table}"`,
          );
          log(
            `  ${c.dim}Rows: ${countRes.rows[0].total}, Non-null: ${countRes.rows[0].non_null}${c.reset}`,
          );
        } catch {
          /* ignore */
        }
        if (
          await askDanger(
            `Drop ${c.bold}${table}.${column}${c.reset}? THIS CANNOT BE UNDONE.`,
          )
        ) {
          try {
            await pool.query(`ALTER TABLE "${table}" DROP COLUMN "${column}"`);
            success(`Dropped ${table}.${column}`);
          } catch (err) {
            error(`Failed: ${err.message}`);
          }
        }
      }
    }
  }

  // Unknown tables
  if (unknownTables.length > 0) {
    warn(`${unknownTables.length} table(s) not in the VulnRadar schema.`);
    info("These may be from custom modifications, plugins, or a shared DB.");
    error("Dropping tables permanently deletes ALL data.");
    if (await askYesNo("Review extra tables?")) {
      for (const table of unknownTables) {
        log("");
        log(
          `  ${c.bold}${table}${c.reset} ${c.dim}(${actual[table].length} columns)${c.reset}`,
        );
        try {
          const countRes = await pool.query(
            `SELECT COUNT(*)::int AS n FROM "${table}"`,
          );
          log(`  ${c.dim}Rows: ${countRes.rows[0].n}${c.reset}`);
        } catch {
          /* ignore */
        }
        if (await askDanger(`Drop table ${c.bold}${table}${c.reset}?`)) {
          if (
            await askDanger(
              `Type y again to confirm dropping ${c.bold}${table}${c.reset}.`,
            )
          ) {
            try {
              await pool.query(`DROP TABLE "${table}" CASCADE`);
              success(`Dropped ${table}`);
            } catch (err) {
              error(`Failed: ${err.message}`);
            }
          }
        }
      }
    }
  }

  log("");
  success("Migration check complete.");
  await pool.end();
}

main().catch((err) => {
  error(err.message);
  process.exit(1);
});
