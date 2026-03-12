#!/usr/bin/env node

/**
 * VulnRadar Database Migration Script
 *
 * Connects to your database, reads the expected schema from instrumentation.ts,
 * compares it against the actual DB, and offers to fix differences.
 *
 * Features:
 *   - Detects v1 -> v2 migration needs and handles data migration
 *   - Detects missing/extra tables and columns
 *   - Detects renamed tables and columns (via rename mappings below)
 *   - Interactive prompts with safe defaults (review = Y, destructive = N)
 *
 * Usage:
 *   node scripts/migrate.mjs           # Normal migration
 *   node scripts/migrate.mjs --v2      # Force v2 migration check
 *   node scripts/migrate.mjs --fresh   # Fresh install (drops all tables, creates new)
 *
 * Requires DATABASE_URL in .env.local or as an environment variable.
 */

import pg from "pg"
import { readFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import * as readline from "readline"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")

// ── Version Info ────────────────────────────────────────────────────────────
const SCHEMA_VERSION = "2.0.0"

// Core tables that exist in v1 (original schema)
// v1 only has these tables - no badges, billing, subscriptions, etc.
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
]

// New tables added in v2
const V2_NEW_TABLES = [
  "badges",
  "user_badges",
  "billing_history",
  "gifted_subscriptions",
  "admin_notifications",
  "admin_user_notes",
]

// Columns that v2 adds to the users table
const V2_USER_COLUMNS = [
  "plan",
  "stripe_customer_id",
  "stripe_subscription_id",
  "subscription_status",
  "subscription_current_period_end",
  "stripe_subscription_metadata",
  "beta_access",
  "email_session_revoked",
]

// ── Rename Mappings ─────────────────────────────────────────────────────────
const TABLE_RENAMES = {
  // "old_name": "new_name",
}

const COLUMN_RENAMES = {
  // "table_name": { "old_col": "new_col" },
}

// ── Colors for terminal output ──────────────────────────────────────────────
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
}

function log(msg) { console.log(msg) }
function info(msg) { log(`${c.cyan}[INFO]${c.reset} ${msg}`) }
function success(msg) { log(`${c.green}[OK]${c.reset}   ${msg}`) }
function warn(msg) { log(`${c.yellow}[WARN]${c.reset} ${msg}`) }
function error(msg) { log(`${c.red}[ERR]${c.reset}  ${msg}`) }

function banner() {
  log("")
  log(`${c.bold}${c.cyan}  ╔══════════════════════════════════════╗${c.reset}`)
  log(`${c.bold}${c.cyan}  ║    VulnRadar Database Migration      ║${c.reset}`)
  log(`${c.bold}${c.cyan}  ║           Schema v${SCHEMA_VERSION}              ║${c.reset}`)
  log(`${c.bold}${c.cyan}  ╚══════════════════════════════════════╝${c.reset}`)
  log("")
}

// ── Read .env.local for DATABASE_URL if not in env ──────────────────────────
function loadEnv() {
  if (process.env.DATABASE_URL) return
  try {
    const envPath = resolve(ROOT, ".env.local")
    const envContent = readFileSync(envPath, "utf-8")
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eq = trimmed.indexOf("=")
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      let val = trimmed.slice(eq + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (!process.env[key]) process.env[key] = val
    }
  } catch {
    // No .env.local, that's fine
  }
}

// ── Prompt helpers ──────────────────────────────────────────────────────────
function askReview(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(`${c.yellow}?${c.reset} ${question} ${c.dim}(Y/n)${c.reset} `, (answer) => {
      rl.close()
      const val = answer.trim().toLowerCase()
      resolve(val === "" || val === "y" || val === "yes")
    })
  })
}

function askDanger(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(`${c.red}?${c.reset} ${question} ${c.dim}(y/N)${c.reset} `, (answer) => {
      rl.close()
      const val = answer.trim().toLowerCase()
      resolve(val === "y" || val === "yes")
    })
  })
}

// ── Parse expected schema from instrumentation.ts ───────────────────────────
function parseExpectedSchema() {
  const filePath = resolve(ROOT, "instrumentation.ts")
  const content = readFileSync(filePath, "utf-8")

  const tables = {}
  const SQL_TYPES = /^(SERIAL|BIGSERIAL|INTEGER|INT|SMALLINT|VARCHAR|TEXT|BOOLEAN|BOOL|TIMESTAMP|TIMESTAMPTZ|JSONB|JSON|BIGINT|UUID|REAL|FLOAT|DOUBLE|NUMERIC|DECIMAL|DATE|TIME|BYTEA|INET|CIDR|MACADDR)\b/i
  const SKIP_KEYWORDS = /^(UNIQUE|PRIMARY\s+KEY|FOREIGN\s+KEY|CHECK|CONSTRAINT)/i

  let currentTable = null
  const lines = content.split("\n")

  for (const rawLine of lines) {
    const line = rawLine.trim()

    const tableMatch = line.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/i)
    if (tableMatch) {
      currentTable = tableMatch[1]
      if (!tables[currentTable]) tables[currentTable] = new Set()

      const afterParen = line.split("(").slice(1).join("(").trim()
      if (afterParen) {
        const colToken = afterParen.replace(/,\s*$/, "").trim()
        const parts = colToken.split(/\s+/)
        if (parts.length >= 2 && SQL_TYPES.test(parts[1])) {
          tables[currentTable].add(parts[0].replace(/"/g, "").toLowerCase())
        }
      }
      continue
    }

    if (currentTable && /^\);?\s*$/.test(line)) {
      currentTable = null
      continue
    }

    if (currentTable) {
      const cleaned = line.replace(/,\s*$/, "").replace(/\)\s*;?\s*$/, "").trim()
      if (!cleaned) continue
      if (SKIP_KEYWORDS.test(cleaned)) continue
      if (cleaned.startsWith("--")) continue

      const parts = cleaned.split(/\s+/)
      if (parts.length >= 2) {
        const colName = parts[0].replace(/"/g, "")
        const colType = parts[1]
        if (/^\w+$/.test(colName) && SQL_TYPES.test(colType)) {
          tables[currentTable].add(colName.toLowerCase())
        }
      }
    }

    const alterMatch = line.match(/ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?("?\w+"?)\s+/i)
    if (alterMatch) {
      const tbl = alterMatch[1]
      const col = alterMatch[2].replace(/"/g, "").toLowerCase()
      if (!tables[tbl]) tables[tbl] = new Set()
      tables[tbl].add(col)
    }
  }

  const result = {}
  for (const [table, cols] of Object.entries(tables)) {
    result[table] = [...cols].sort()
  }
  return result
}

// ── Get actual schema from database ─────────────────────────────────────────
async function getActualSchema(pool) {
  const res = await pool.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `)

  const tables = {}
  for (const row of res.rows) {
    const t = row.table_name
    if (!tables[t]) tables[t] = []
    tables[t].push(row.column_name.toLowerCase())
  }
  return tables
}

// ── Check if this is a v1 database that needs v2 migration ──────────────────
// v1 is detected by: has v1 core tables, but MISSING v2 tables and v2 user columns
function detectV1Database(actual) {
  // Check if users table exists
  if (!actual["users"]) return { isV1: false, reason: "No users table found" }
  
  const userColumns = actual["users"] || []
  
  // Check if v2 tables are missing
  const missingV2Tables = V2_NEW_TABLES.filter(t => !actual[t])
  
  // Check if v2 user columns are missing
  const missingV2Columns = V2_USER_COLUMNS.filter(col => !userColumns.includes(col))
  
  // It's v1 if it's MISSING v2 tables (core infrastructure)
  // Missing a few columns is OK - those can be added incrementally
  // But if v2 tables don't exist, it's definitely v1
  const isV1 = missingV2Tables.length > 0
  
  return {
    isV1,
    missingTables: missingV2Tables,
    missingColumns: missingV2Columns,
    hasV1CoreTables: V1_CORE_TABLES.filter(t => actual[t]).length,
  }
}

// ── V2 Migration: Add v2 tables and columns to v1 database ──────────────────
async function runV2Migration(pool, actual, v1Info) {
  log("")
  log(`${c.bold}${c.bgYellow}${c.white} V1 -> V2 MIGRATION DETECTED ${c.reset}`)
  log("")
  log(`${c.yellow}Your database is running VulnRadar v1 schema.${c.reset}`)
  log(`${c.yellow}This migration will upgrade it to v2.${c.reset}`)
  log("")
  
  if (v1Info.missingTables.length > 0) {
    log(`${c.cyan}New tables to create:${c.reset}`)
    for (const t of v1Info.missingTables) {
      log(`  + ${c.bold}${t}${c.reset}`)
    }
    log("")
  }
  
  if (v1Info.missingColumns.length > 0) {
    log(`${c.cyan}New columns to add to users table:${c.reset}`)
    for (const col of v1Info.missingColumns) {
      log(`  + ${c.bold}users.${col}${c.reset}`)
    }
    log("")
  }
  
  log(`${c.cyan}What this migration will do:${c.reset}`)
  log(`  1. Add new columns to the ${c.bold}users${c.reset} table (plan, stripe_customer_id, etc.)`)
  log(`  2. Create new tables: ${c.bold}badges${c.reset}, ${c.bold}user_badges${c.reset}, ${c.bold}billing_history${c.reset}`)
  log(`  3. Set default values (plan = 'free', beta_access = false)`)
  log("")
  log(`${c.green}This is a safe migration - no data will be lost.${c.reset}`)
  log("")

  const shouldProceed = await askReview("Proceed with v2 migration?")
  if (!shouldProceed) {
    info("Migration cancelled. Your database was not modified.")
    return false
  }

  log("")
  info("Starting v2 migration...")
  log("")

  // Step 1: Add new columns to users table if they don't exist
  const newUserColumns = [
    { name: "plan", def: "VARCHAR(50) DEFAULT 'free'" },
    { name: "stripe_customer_id", def: "VARCHAR(255)" },
    { name: "stripe_subscription_id", def: "VARCHAR(255)" },
    { name: "subscription_status", def: "VARCHAR(50)" },
    { name: "subscription_current_period_end", def: "TIMESTAMP" },
    { name: "stripe_subscription_metadata", def: "JSONB" },
    { name: "beta_access", def: "BOOLEAN DEFAULT FALSE" },
  ]

  info("Adding new columns to users table...")
  for (const col of newUserColumns) {
    try {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col.name} ${col.def}`)
      success(`  Added users.${col.name}`)
    } catch (err) {
      if (!err.message.includes("already exists")) {
        error(`  Failed to add users.${col.name}: ${err.message}`)
      } else {
        info(`  users.${col.name} already exists`)
      }
    }
  }

  // Step 2: Create badges table
  if (!actual["badges"]) {
    info("Creating badges table...")
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS badges (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL UNIQUE,
          display_name VARCHAR(255) NOT NULL,
          description TEXT,
          color VARCHAR(7) DEFAULT '#6366f1',
          icon VARCHAR(100),
          created_at TIMESTAMP DEFAULT NOW()
        )
      `)
      success("  Created badges table")
    } catch (err) {
      error(`  Failed to create badges table: ${err.message}`)
    }
  }

  // Step 3: Create user_badges table
  if (!actual["user_badges"]) {
    info("Creating user_badges table...")
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS user_badges (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          badge_id INTEGER NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
          awarded_at TIMESTAMP DEFAULT NOW(),
          awarded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          UNIQUE(user_id, badge_id)
        )
      `)
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges(user_id)`)
      success("  Created user_badges table")
    } catch (err) {
      error(`  Failed to create user_badges table: ${err.message}`)
    }
  }

  // Step 4: Create billing_history table
  if (!actual["billing_history"]) {
    info("Creating billing_history table...")
    try {
      await pool.query(`
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
        )
      `)
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_billing_history_user ON billing_history(user_id)`)
      success("  Created billing_history table")
    } catch (err) {
      error(`  Failed to create billing_history table: ${err.message}`)
    }
  } else {
    // Ensure stripe_payment_intent_id column exists for older v2 installs
    try {
      await pool.query(`ALTER TABLE billing_history ADD COLUMN IF NOT EXISTS stripe_payment_intent_id VARCHAR(255)`)
    } catch { /* column may already exist */ }
  }

  // Step 5: Add missing user columns
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_session_revoked BOOLEAN NOT NULL DEFAULT false`)
    success("  Added email_session_revoked to users table")
  } catch { /* column may already exist */ }

  // Step 6: Add missing api_keys columns
  try {
    await pool.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS daily_limit INTEGER DEFAULT 50`)
    success("  Added daily_limit to api_keys table")
  } catch { /* column may already exist */ }

  // Step 6b: Add key_encrypted to api_keys (nullable - stores encrypted key for reveal feature)
  try {
    await pool.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_encrypted TEXT`)
    success("  Added key_encrypted to api_keys table")
  } catch { /* column may already exist */ }

  // Step 6c: Add missing notification_preferences columns
  const notifPrefColumns = [
    "email_session_revoked BOOLEAN NOT NULL DEFAULT true",
    "email_regression_alert BOOLEAN NOT NULL DEFAULT true",
    "email_schedules BOOLEAN NOT NULL DEFAULT true",
    "email_api_limit_warning BOOLEAN NOT NULL DEFAULT true",
    "email_webhook_failure BOOLEAN NOT NULL DEFAULT true",
    "email_data_requests BOOLEAN NOT NULL DEFAULT true",
    "email_account_deletion BOOLEAN NOT NULL DEFAULT true",
    "email_team_invite BOOLEAN NOT NULL DEFAULT true",
    "email_team_changes BOOLEAN NOT NULL DEFAULT true",
  ]
  for (const colDef of notifPrefColumns) {
    try {
      await pool.query(`ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS ${colDef}`)
    } catch { /* column may already exist */ }
  }
  success("  Added missing notification_preferences columns")

  // Step 6d: Add daily_scan_limit to users
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_scan_limit INTEGER DEFAULT NULL`)
    success("  Added daily_scan_limit to users table")
  } catch { /* column may already exist */ }

  // Step 6e: Create admin_user_notes table
  if (!actual["admin_user_notes"]) {
    info("Creating admin_user_notes table...")
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS admin_user_notes (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          note TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `)
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_admin_user_notes_user ON admin_user_notes(user_id)`)
      success("  Created admin_user_notes table")
    } catch (err) {
      error(`  Failed to create admin_user_notes table: ${err.message}`)
    }
  }

  // Step 7: Create gifted_subscriptions table
  if (!actual["gifted_subscriptions"]) {
    info("Creating gifted_subscriptions table...")
    try {
      await pool.query(`
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
        )
      `)
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_gifted_subscriptions_user ON gifted_subscriptions(user_id)`)
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_gifted_subscriptions_expires ON gifted_subscriptions(expires_at) WHERE revoked_at IS NULL`)
      success("  Created gifted_subscriptions table")
    } catch (err) {
      error(`  Failed to create gifted_subscriptions table: ${err.message}`)
    }
  }

  // Step 8: Create admin_notifications table
  if (!actual["admin_notifications"]) {
    info("Creating admin_notifications table...")
    try {
      await pool.query(`
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
        )
      `)
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_admin_notifications_active ON admin_notifications (is_active, starts_at, ends_at) WHERE is_active = true`)
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_admin_notifications_type ON admin_notifications (type)`)
      success("  Created admin_notifications table")
    } catch (err) {
      error(`  Failed to create admin_notifications table: ${err.message}`)
    }
  }

  log("")
  success("V2 migration complete!")
  log("")
  log(`${c.cyan}Your database has been upgraded to VulnRadar v2 schema.${c.reset}`)
  log(`${c.cyan}New features available: badges, billing history, subscription management, admin notifications.${c.reset}`)
  log("")

  return true
}

// ── Fresh install: Drop all and recreate ────────────────────────────────────
async function runFreshInstall(pool, actual) {
  log("")
  log(`${c.bold}${c.bgRed}${c.white} FRESH INSTALL MODE ${c.reset}`)
  log("")
  log(`${c.red}${c.bold}WARNING: This will DROP ALL TABLES and create a fresh database!${c.reset}`)
  log(`${c.red}All existing data will be permanently deleted.${c.reset}`)
  log("")
  
  const existingTables = Object.keys(actual)
  if (existingTables.length > 0) {
    log(`${c.yellow}Tables that will be dropped:${c.reset}`)
    for (const t of existingTables) {
      try {
        const countRes = await pool.query(`SELECT COUNT(*) as total FROM "${t}"`)
        log(`  - ${c.bold}${t}${c.reset} ${c.dim}(${countRes.rows[0].total} rows)${c.reset}`)
      } catch {
        log(`  - ${c.bold}${t}${c.reset}`)
      }
    }
    log("")
  }

  const shouldProceed = await askDanger("Are you SURE you want to delete ALL data and start fresh?")
  if (!shouldProceed) {
    info("Fresh install cancelled.")
    return false
  }

  const reallyProceed = await askDanger("Type 'y' again to confirm PERMANENT DATA DELETION:")
  if (!reallyProceed) {
    info("Fresh install cancelled.")
    return false
  }

  log("")
  info("Dropping all tables...")
  
  for (const table of existingTables) {
    try {
      await pool.query(`DROP TABLE IF EXISTS "${table}" CASCADE`)
      success(`  Dropped ${table}`)
    } catch (err) {
      warn(`  Could not drop ${table}: ${err.message}`)
    }
  }

  log("")
  success("All tables dropped. Start the app (npm run dev) to create fresh tables.")
  return true
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  banner()
  loadEnv()

  const args = process.argv.slice(2)
  const forceV2 = args.includes("--v2")
  const freshInstall = args.includes("--fresh")

  if (!process.env.DATABASE_URL) {
    error("DATABASE_URL is not set. Add it to .env.local or set it as an environment variable.")
    process.exit(1)
  }

  info("Connecting to database...")
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
    max: 3,
    connectionTimeoutMillis: 10000,
  })

  try {
    await pool.query("SELECT 1")
    success("Connected to database.")
  } catch (err) {
    error(`Failed to connect: ${err.message}`)
    process.exit(1)
  }

  log("")
  info("Reading actual database schema...")
  const actual = await getActualSchema(pool)
  success(`Found ${Object.keys(actual).length} tables in database.`)

  // Fresh install mode
  if (freshInstall) {
    await runFreshInstall(pool, actual)
    await pool.end()
    return
  }

  // Check for v1 -> v2 migration
  const v1Info = detectV1Database(actual)
  if (v1Info.isV1 || forceV2) {
    if (v1Info.isV1) {
      log("")
      log(`${c.bold}${c.bgYellow}${c.white} V1 DATABASE DETECTED ${c.reset}`)
      log("")
      log(`${c.yellow}Your database is running VulnRadar v1 schema.${c.reset}`)
      log(`${c.yellow}Missing ${v1Info.missingTables.length} tables, ${v1Info.missingColumns.length} columns.${c.reset}`)
      log("")
      log(`${c.cyan}${c.bold}RECOMMENDATION:${c.reset}`)
      log(`${c.cyan}For v1 databases, we recommend using ${c.bold}npm run new-db${c.reset}${c.cyan} instead.${c.reset}`)
      log(`${c.cyan}This creates a fresh database with the latest schema and is safer${c.reset}`)
      log(`${c.cyan}than incremental migration for large schema changes.${c.reset}`)
      log("")
      log(`${c.dim}If you have important data to preserve, the migration below will${c.reset}`)
      log(`${c.dim}attempt to add missing tables/columns without data loss.${c.reset}`)
      log("")
      
      const continueAnyway = await askReview("Continue with incremental migration anyway?")
      if (!continueAnyway) {
        log("")
        info("Migration cancelled. Run 'npm run new-db' for a fresh install.")
        await pool.end()
        return
      }
      
      const migrated = await runV2Migration(pool, actual, v1Info)
      if (migrated) {
        // Re-read schema after migration
        info("Re-reading database schema after migration...")
        const newActual = await getActualSchema(pool)
        Object.keys(actual).forEach(k => delete actual[k])
        Object.assign(actual, newActual)
      }
    } else if (forceV2) {
      info("Your database already has all v2 tables and columns.")
    }
  }

  log("")
  info("Parsing expected schema from instrumentation.ts...")
  let expected
  try {
    expected = parseExpectedSchema()
    success(`Found ${Object.keys(expected).length} expected tables.`)
  } catch (err) {
    error(`Failed to parse instrumentation.ts: ${err.message}`)
    await pool.end()
    process.exit(1)
  }

  // ── Phase 1: Detect and apply table renames ───────────���─────────────────
  const pendingTableRenames = []
  for (const [oldName, newName] of Object.entries(TABLE_RENAMES)) {
    if (actual[oldName] && !actual[newName] && expected[newName]) {
      pendingTableRenames.push({ oldName, newName })
    }
  }

  if (pendingTableRenames.length > 0) {
    log("")
    log(`${c.bold}═══════════════════════════════════════════${c.reset}`)
    log(`${c.bold}  Table Renames Detected${c.reset}`)
    log(`${c.bold}═══════════════════════════════════════════${c.reset}`)
    log("")

    for (const { oldName, newName } of pendingTableRenames) {
      log(`  ${c.magenta}RENAME${c.reset}  ${c.bold}${oldName}${c.reset} ${c.dim}->${c.reset} ${c.bold}${newName}${c.reset}`)

      const shouldRename = await askReview(`Rename table ${c.bold}${oldName}${c.reset} to ${c.bold}${newName}${c.reset}?`)
      if (shouldRename) {
        try {
          await pool.query(`ALTER TABLE "${oldName}" RENAME TO "${newName}"`)
          success(`Renamed table ${oldName} -> ${newName}`)
          actual[newName] = actual[oldName]
          delete actual[oldName]
        } catch (err) {
          error(`Failed to rename: ${err.message}`)
        }
      }
    }
  }

  // ── Phase 2: Detect and apply column renames ────────────────────────────
  const pendingColRenames = []
  for (const [table, renames] of Object.entries(COLUMN_RENAMES)) {
    const actualTable = actual[table]
    if (!actualTable) continue
    const expectedCols = expected[table]
    if (!expectedCols) continue

    for (const [oldCol, newCol] of Object.entries(renames)) {
      if (actualTable.includes(oldCol) && !actualTable.includes(newCol) && expectedCols.includes(newCol)) {
        pendingColRenames.push({ table, oldCol, newCol })
      }
    }
  }

  if (pendingColRenames.length > 0) {
    log("")
    log(`${c.bold}═══════════════════════════════════════════${c.reset}`)
    log(`${c.bold}  Column Renames Detected${c.reset}`)
    log(`${c.bold}═══════════════════════════════════════════${c.reset}`)
    log("")

    for (const { table, oldCol, newCol } of pendingColRenames) {
      log(`  ${c.magenta}RENAME${c.reset}  ${c.bold}${table}.${oldCol}${c.reset} ${c.dim}->${c.reset} ${c.bold}${table}.${newCol}${c.reset}`)

      const shouldRename = await askReview(`Rename column ${c.bold}${table}.${oldCol}${c.reset} to ${c.bold}${newCol}${c.reset}?`)
      if (shouldRename) {
        try {
          await pool.query(`ALTER TABLE "${table}" RENAME COLUMN "${oldCol}" TO "${newCol}"`)
          success(`Renamed ${table}.${oldCol} -> ${table}.${newCol}`)
          const idx = actual[table].indexOf(oldCol)
          if (idx !== -1) actual[table][idx] = newCol
        } catch (err) {
          error(`Failed to rename: ${err.message}`)
        }
      }
    }
  }

  // ── Phase 3: Schema comparison ──────────────────────────────────────────
  log("")
  log(`${c.bold}═══════════════════════════════════════════${c.reset}`)
  log(`${c.bold}  Schema Comparison${c.reset}`)
  log(`${c.bold}═══════════════════════════════════════════${c.reset}`)
  log("")

  const missingTables = []
  const missingColumns = []
  const extraColumns = []

  for (const [table, expectedCols] of Object.entries(expected)) {
    if (!actual[table]) {
      missingTables.push(table)
      log(`  ${c.red}MISSING TABLE${c.reset}  ${c.bold}${table}${c.reset} ${c.dim}(${expectedCols.length} columns)${c.reset}`)
      continue
    }

    const actualCols = actual[table]
    const missing = expectedCols.filter((col) => !actualCols.includes(col))
    const extra = actualCols.filter((col) => !expectedCols.includes(col))

    if (missing.length === 0 && extra.length === 0) {
      log(`  ${c.green}OK${c.reset}             ${c.bold}${table}${c.reset} ${c.dim}(${actualCols.length} columns)${c.reset}`)
    } else {
      log(`  ${c.yellow}DIFF${c.reset}           ${c.bold}${table}${c.reset}`)
      for (const col of missing) {
        log(`                   ${c.red}+ missing:${c.reset} ${col}`)
        missingColumns.push({ table, column: col })
      }
      for (const col of extra) {
        log(`                   ${c.yellow}~ extra:${c.reset}   ${col}`)
        extraColumns.push({ table, column: col })
      }
    }
  }

  const unknownTables = Object.keys(actual).filter((t) => !expected[t])
  if (unknownTables.length > 0) {
    log("")
    for (const t of unknownTables) {
      log(`  ${c.yellow}EXTRA TABLE${c.reset}    ${c.bold}${t}${c.reset} ${c.dim}(${actual[t].length} columns, not in expected schema)${c.reset}`)
    }
  }

  log("")
  log(`${c.bold}═══════════════════════════════════════════${c.reset}`)
  log("")

  if (missingTables.length === 0 && missingColumns.length === 0 && extraColumns.length === 0 && unknownTables.length === 0) {
    success("Your database schema is fully up to date! Nothing to do.")
    await pool.end()
    return
  }

  // ── Handle missing tables ─────────────────────────────────────────────────
  if (missingTables.length > 0) {
    log("")
    warn(`${missingTables.length} table(s) are missing from the database.`)
    log(`${c.dim}These will be created automatically when you start the app (npm run dev).${c.reset}`)
  }

  // ── Handle missing columns ────────────────────────────────────────────────
  if (missingColumns.length > 0) {
    log("")
    log(`${c.yellow}${missingColumns.length} column(s) are missing from existing tables.${c.reset}`)
    log(`${c.dim}These will be added automatically when you start the app, or you can add them now.${c.reset}`)
    log("")

    const shouldReview = await askReview(`Review and add ${missingColumns.length} missing column(s)?`)
    if (shouldReview) {
      for (const { table, column } of missingColumns) {
        const filePath = resolve(ROOT, "instrumentation.ts")
        const content = readFileSync(filePath, "utf-8")

        const alterRegex = new RegExp(
          `ALTER\\s+TABLE\\s+${table}\\s+ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${column}\\s+([^;]+)`,
          "i"
        )
        const alterMatch = content.match(alterRegex)

        if (alterMatch) {
          const shouldAdd = await askDanger(`Add column ${c.bold}${table}.${column}${c.reset}?`)
          if (shouldAdd) {
            try {
              await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${alterMatch[1].split(";")[0].trim()}`)
              success(`Added ${table}.${column}`)
            } catch (err) {
              error(`Failed to add ${table}.${column}: ${err.message}`)
            }
          }
        } else {
          warn(`Could not find column definition for ${table}.${column}. Start the app to auto-migrate.`)
        }
      }
    }
  }

  // ── Handle extra columns ─────────────────────────────���────────────────────
  if (extraColumns.length > 0) {
    log("")
    log(`${c.yellow}${extraColumns.length} extra column(s) found that are not in the current schema.${c.reset}`)
    log(`${c.dim}These may be from custom modifications or older versions.${c.reset}`)
    log(`${c.red}${c.bold}WARNING: Dropping columns permanently deletes data!${c.reset}`)
    log("")

    const shouldReview = await askReview("Review extra columns?")
    if (shouldReview) {
      for (const { table, column } of extraColumns) {
        log("")
        log(`  Table: ${c.bold}${table}${c.reset}  Column: ${c.bold}${column}${c.reset}`)

        try {
          const countRes = await pool.query(
            `SELECT COUNT(*) as total, COUNT("${column}") as non_null FROM "${table}"`
          )
          log(`  ${c.dim}Rows: ${countRes.rows[0].total}, Non-null: ${countRes.rows[0].non_null}${c.reset}`)
        } catch { /* ignore */ }

        const shouldDrop = await askDanger(`Drop column ${c.bold}${table}.${column}${c.reset}? THIS CANNOT BE UNDONE.`)
        if (shouldDrop) {
          try {
            await pool.query(`ALTER TABLE "${table}" DROP COLUMN "${column}"`)
            success(`Dropped ${table}.${column}`)
          } catch (err) {
            error(`Failed to drop: ${err.message}`)
          }
        }
      }
    }
  }

  // ── Handle unknown/extra tables ───────────────────────────────────────────
  if (unknownTables.length > 0) {
    log("")
    log(`${c.yellow}${unknownTables.length} table(s) found that are not part of the VulnRadar schema.${c.reset}`)
    log(`${c.dim}These may be from custom modifications, plugins, or a shared database.${c.reset}`)
    log(`${c.red}${c.bold}WARNING: Dropping tables permanently deletes ALL data!${c.reset}`)
    log("")

    const shouldReview = await askReview("Review extra tables?")
    if (shouldReview) {
      for (const table of unknownTables) {
        log("")
        log(`  Table: ${c.bold}${table}${c.reset}  ${c.dim}(${actual[table].length} columns)${c.reset}`)

        try {
          const countRes = await pool.query(`SELECT COUNT(*) as total FROM "${table}"`)
          log(`  ${c.dim}Rows: ${countRes.rows[0].total}${c.reset}`)
        } catch { /* ignore */ }

        const shouldDrop = await askDanger(`Drop table ${c.bold}${table}${c.reset}? THIS CANNOT BE UNDONE.`)
        if (shouldDrop) {
          const reallyDrop = await askDanger(`Type y again to confirm dropping ${c.bold}${table}${c.reset}.`)
          if (reallyDrop) {
            try {
              await pool.query(`DROP TABLE "${table}" CASCADE`)
              success(`Dropped table ${table}`)
            } catch (err) {
              error(`Failed to drop: ${err.message}`)
            }
          }
        }
      }
    }
  }

  log("")
  success("Migration check complete.")
  await pool.end()
}

main().catch((err) => {
  error(`Unexpected error: ${err.message}`)
  process.exit(1)
})
