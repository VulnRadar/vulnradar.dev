#!/usr/bin/env node

/**
 * VulnRadar Fresh Database Setup Script
 * 
 * Creates all tables from scratch. Use for fresh installs only.
 * For migrations, use: npm run migrate
 * 
 * Usage:
 *   npm run new-db
 *   node scripts/create-fresh-db.mjs
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
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  white: "\x1b[37m",
}

function log(msg) { console.log(msg) }
function info(msg) { log(`${c.cyan}[INFO]${c.reset} ${msg}`) }
function success(msg) { log(`${c.green}[OK]${c.reset}   ${msg}`) }
function warn(msg) { log(`${c.yellow}[WARN]${c.reset} ${msg}`) }
function error(msg) { log(`${c.red}[ERR]${c.reset}  ${msg}`) }

function banner() {
  log("")
  log(`${c.bold}${c.cyan}  ╔══════════════════════════════════════╗${c.reset}`)
  log(`${c.bold}${c.cyan}  ║   VulnRadar Fresh Database Setup     ║${c.reset}`)
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

// ── Prompt helper ───────────────────────────────────────────────────────────
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

// ── Get existing tables ─────────────────────────────────────────────────────
async function getExistingTables(pool) {
  const res = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `)
  return res.rows.map(r => r.table_name)
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  banner()
  loadEnv()

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

  // Check for existing tables
  const existingTables = await getExistingTables(pool)
  
  if (existingTables.length > 0) {
    log("")
    log(`${c.bold}${c.bgRed}${c.white} WARNING: DATABASE IS NOT EMPTY ${c.reset}`)
    log("")
    log(`${c.yellow}Found ${existingTables.length} existing tables:${c.reset}`)
    for (const t of existingTables) {
      try {
        const countRes = await pool.query(`SELECT COUNT(*) as total FROM "${t}"`)
        log(`  - ${c.bold}${t}${c.reset} ${c.dim}(${countRes.rows[0].total} rows)${c.reset}`)
      } catch {
        log(`  - ${c.bold}${t}${c.reset}`)
      }
    }
    log("")
    log(`${c.red}This script will DROP ALL EXISTING TABLES and create fresh ones.${c.reset}`)
    log(`${c.red}All existing data will be permanently deleted.${c.reset}`)
    log("")

    const shouldProceed = await askDanger("Are you SURE you want to delete ALL data and start fresh?")
    if (!shouldProceed) {
      info("Operation cancelled. Your database was not modified.")
      await pool.end()
      return
    }

    log("")
    info("Dropping all existing tables...")
    for (const table of existingTables) {
      try {
        await pool.query(`DROP TABLE IF EXISTS "${table}" CASCADE`)
        success(`  Dropped ${table}`)
      } catch (err) {
        warn(`  Could not drop ${table}: ${err.message}`)
      }
    }
    log("")
  }

  // Extract SQL statements from instrumentation.ts
  info("Reading schema from instrumentation.ts...")
  const instrPath = resolve(ROOT, "instrumentation.ts")
  let instrContent
  try {
    instrContent = readFileSync(instrPath, "utf-8")
    success("instrumentation.ts loaded.")
  } catch (err) {
    error(`Failed to read instrumentation.ts: ${err.message}`)
    await pool.end()
    process.exit(1)
  }

  log("")
  info("Creating tables...")
  
  // Extract SQL blocks from pool.query(`...`) calls
  const sqlBlockRegex = /await pool\.query\(`([\s\S]*?)`\)/g
  const statements = []
  let match
  while ((match = sqlBlockRegex.exec(instrContent)) !== null) {
    const sql = match[1].trim()
    // Split by semicolons for multi-statement blocks
    const parts = sql.split(";").map(s => s.trim()).filter(s => s)
    statements.push(...parts)
  }

  let created = 0
  let indexes = 0
  let errors = 0

  for (const stmt of statements) {
    if (!stmt) continue
    try {
      await pool.query(stmt)
      // Count CREATE TABLE statements
      if (stmt.toUpperCase().includes("CREATE TABLE")) {
        const tableMatch = stmt.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i)
        if (tableMatch) {
          success(`  Created table: ${tableMatch[1]}`)
          created++
        }
      } else if (stmt.toUpperCase().includes("CREATE INDEX")) {
        indexes++
      }
    } catch (err) {
      if (!err.message.includes("already exists")) {
        warn(`  Error: ${err.message.slice(0, 80)}...`)
        errors++
      }
    }
  }
  
  // Seed default badges
  info("Seeding default badges...")
  try {
    await pool.query(`
      INSERT INTO badges (name, display_name, description, color, icon) VALUES
        ('early_adopter', 'Early Adopter', 'One of the first users of VulnRadar', '#f59e0b', 'star'),
        ('beta_tester', 'Beta Tester', 'Helped test VulnRadar before release', '#8b5cf6', 'flask'),
        ('bug_hunter', 'Bug Hunter', 'Reported bugs or security issues', '#ef4444', 'bug'),
        ('contributor', 'Contributor', 'Contributed to VulnRadar development', '#10b981', 'code'),
        ('supporter', 'Supporter', 'Supports VulnRadar with a paid plan', '#3b82f6', 'heart'),
        ('power_user', 'Power User', 'Performed over 1000 scans', '#ec4899', 'zap'),
        ('verified', 'Verified', 'Verified identity', '#06b6d4', 'check-circle')
      ON CONFLICT (name) DO NOTHING
    `)
    success("  Seeded default badges")
  } catch (err) {
    warn(`  Could not seed badges: ${err.message}`)
  }

  log("")
  log(`${c.bold}═══════════════════════════════════════════${c.reset}`)
  success(`Fresh database setup complete!`)
  log(`${c.bold}═══════════════════════════════════════════${c.reset}`)
  log("")
  log(`  ${c.green}✓${c.reset} ${created} tables created`)
  log(`  ${c.green}✓${c.reset} ${indexes} indexes created`)
  if (errors > 0) {
    log(`  ${c.yellow}!${c.reset} ${errors} statements had errors (may be expected)`)
  }
  log("")
  log(`${c.cyan}Next steps:${c.reset}`)
  log(`  1. Run ${c.bold}npm run dev${c.reset} to start the app`)
  log(`  2. Create your first admin user via the signup page`)
  log(`  3. First user to sign up can be promoted to admin via database`)
  log("")

  await pool.end()
}

main().catch((err) => {
  error(`Unexpected error: ${err.message}`)
  process.exit(1)
})
