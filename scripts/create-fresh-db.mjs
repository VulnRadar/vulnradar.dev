#!/usr/bin/env node

/**
 * VulnRadar Safe Database Migration Script
 * 
 * Creates a NEW database with fresh schema, then optionally migrates data
 * from the original database. Never touches or erases the original DB.
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
  bgCyan: "\x1b[46m",
  white: "\x1b[37m",
  black: "\x1b[30m",
}

function log(msg) { console.log(msg) }
function info(msg) { log(`${c.cyan}[INFO]${c.reset} ${msg}`) }
function success(msg) { log(`${c.green}[OK]${c.reset}   ${msg}`) }
function warn(msg) { log(`${c.yellow}[WARN]${c.reset} ${msg}`) }
function error(msg) { log(`${c.red}[ERR]${c.reset}  ${msg}`) }

function banner() {
  log("")
  log(`${c.bold}${c.cyan}  ╔══════════════════════════════════════════════╗${c.reset}`)
  log(`${c.bold}${c.cyan}  ║   VulnRadar Safe Database Migration          ║${c.reset}`)
  log(`${c.bold}${c.cyan}  ║   Creates new DB, preserves original data    ║${c.reset}`)
  log(`${c.bold}${c.cyan}  ╚══════════════════════════════════════════════╝${c.reset}`)
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
function ask(question, defaultVal = "") {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const defaultHint = defaultVal ? ` ${c.dim}(${defaultVal})${c.reset}` : ""
    rl.question(`${c.cyan}?${c.reset} ${question}${defaultHint} `, (answer) => {
      rl.close()
      resolve(answer.trim() || defaultVal)
    })
  })
}

function askYesNo(question, defaultYes = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const hint = defaultYes ? `${c.dim}(Y/n)${c.reset}` : `${c.dim}(y/N)${c.reset}`
    rl.question(`${c.cyan}?${c.reset} ${question} ${hint} `, (answer) => {
      rl.close()
      const val = answer.trim().toLowerCase()
      if (val === "") resolve(defaultYes)
      else resolve(val === "y" || val === "yes")
    })
  })
}

// ── Parse database URL ──────────────────────────────────────────────────────
function parseDbUrl(url) {
  const match = url.match(/postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:\/]+):?(\d+)?\/(.+)/)
  if (!match) return null
  return {
    user: match[1],
    password: match[2],
    host: match[3],
    port: match[4] || "5432",
    database: match[5].split("?")[0],
  }
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

// ── Get table row counts ────────────────────────────────────────────────────
async function getTableCounts(pool, tables) {
  const counts = {}
  for (const t of tables) {
    try {
      const res = await pool.query(`SELECT COUNT(*) as total FROM "${t}"`)
      counts[t] = parseInt(res.rows[0].total)
    } catch {
      counts[t] = 0
    }
  }
  return counts
}

// ── Tables that should be migrated (contain user data) ─────────────────────
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
]

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  banner()
  loadEnv()

  if (!process.env.DATABASE_URL) {
    error("DATABASE_URL is not set. Add it to .env.local or set it as an environment variable.")
    process.exit(1)
  }

  const dbInfo = parseDbUrl(process.env.DATABASE_URL)
  if (!dbInfo) {
    error("Could not parse DATABASE_URL. Make sure it's a valid PostgreSQL connection string.")
    process.exit(1)
  }

  log(`${c.bold}Current Database:${c.reset} ${c.cyan}${dbInfo.database}${c.reset} on ${dbInfo.host}`)
  log("")

  // Connect to original database
  info("Connecting to original database...")
  const originalPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
    max: 3,
    connectionTimeoutMillis: 10000,
  })

  try {
    await originalPool.query("SELECT 1")
    success("Connected to original database.")
  } catch (err) {
    error(`Failed to connect: ${err.message}`)
    process.exit(1)
  }

  // Check existing tables and data
  const existingTables = await getExistingTables(originalPool)
  const tableCounts = await getTableCounts(originalPool, existingTables)
  
  log("")
  log(`${c.bold}Original database has ${existingTables.length} tables:${c.reset}`)
  for (const t of existingTables) {
    const count = tableCounts[t]
    const countStr = count > 0 ? `${c.green}${count} rows${c.reset}` : `${c.dim}empty${c.reset}`
    log(`  - ${t} (${countStr})`)
  }
  log("")

  // Ask for new database name
  const defaultNewName = `${dbInfo.database}_v2`
  const newDbName = await ask(`Enter name for the NEW database`, defaultNewName)
  
  if (newDbName === dbInfo.database) {
    error("New database name cannot be the same as the original!")
    await originalPool.end()
    process.exit(1)
  }

  log("")
  log(`${c.bold}${c.bgCyan}${c.black} SAFE MIGRATION PLAN ${c.reset}`)
  log("")
  log(`  ${c.green}1.${c.reset} Create new database: ${c.bold}${newDbName}${c.reset}`)
  log(`  ${c.green}2.${c.reset} Create all tables with fresh schema`)
  log(`  ${c.green}3.${c.reset} Optionally migrate data from original`)
  log(`  ${c.green}4.${c.reset} Original database ${c.bold}${dbInfo.database}${c.reset} is ${c.green}NEVER modified${c.reset}`)
  log("")

  const shouldProceed = await askYesNo("Proceed with creating the new database?", true)
  if (!shouldProceed) {
    info("Operation cancelled.")
    await originalPool.end()
    return
  }

  // Connect to postgres database to create new database
  log("")
  log(`${c.bold}${c.cyan}Step 1: Creating New Database${c.reset}`)
  
  const adminPool = new pg.Pool({
    user: dbInfo.user,
    password: dbInfo.password,
    host: dbInfo.host,
    port: parseInt(dbInfo.port),
    database: "postgres",
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
    max: 1,
  })

  try {
    // Check if database already exists
    const existsRes = await adminPool.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [newDbName]
    )
    
    if (existsRes.rows.length > 0) {
      warn(`Database '${newDbName}' already exists.`)
      const shouldDrop = await askYesNo(`Drop and recreate '${newDbName}'?`, false)
      if (shouldDrop) {
        // Terminate connections to the database
        await adminPool.query(`
          SELECT pg_terminate_backend(pg_stat_activity.pid)
          FROM pg_stat_activity
          WHERE pg_stat_activity.datname = $1
          AND pid <> pg_backend_pid()
        `, [newDbName])
        await adminPool.query(`DROP DATABASE "${newDbName}"`)
        success(`Dropped existing database '${newDbName}'`)
      } else {
        info("Using existing database.")
      }
    }
    
    // Create new database
    const existsAgain = await adminPool.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [newDbName]
    )
    if (existsAgain.rows.length === 0) {
      await adminPool.query(`CREATE DATABASE "${newDbName}"`)
      success(`Created new database: ${newDbName}`)
    }
  } catch (err) {
    error(`Failed to create database: ${err.message}`)
    await adminPool.end()
    await originalPool.end()
    process.exit(1)
  }
  
  await adminPool.end()

  // Connect to new database
  const newDbUrl = process.env.DATABASE_URL.replace(`/${dbInfo.database}`, `/${newDbName}`)
  const newPool = new pg.Pool({
    connectionString: newDbUrl,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
    max: 3,
  })

  try {
    await newPool.query("SELECT 1")
    success(`Connected to new database: ${newDbName}`)
  } catch (err) {
    error(`Failed to connect to new database: ${err.message}`)
    await originalPool.end()
    process.exit(1)
  }

  // Read schema from instrumentation.ts
  log("")
  log(`${c.bold}${c.cyan}Step 2: Creating Schema${c.reset}`)
  info("Reading schema from instrumentation.ts...")
  const instrPath = resolve(ROOT, "instrumentation.ts")
  let instrContent
  try {
    instrContent = readFileSync(instrPath, "utf-8")
    success("Schema loaded.")
  } catch (err) {
    error(`Failed to read instrumentation.ts: ${err.message}`)
    await newPool.end()
    await originalPool.end()
    process.exit(1)
  }

  // Extract and execute SQL statements
  info("Creating tables in new database...")
  
  const sqlBlockRegex = /await pool\.query\(`([\s\S]*?)`\)/g
  const statements = []
  let match
  while ((match = sqlBlockRegex.exec(instrContent)) !== null) {
    const sql = match[1].trim()
    const parts = sql.split(";").map(s => s.trim()).filter(s => s)
    statements.push(...parts)
  }

  let created = 0
  let indexes = 0

  for (const stmt of statements) {
    if (!stmt) continue
    try {
      await newPool.query(stmt)
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
        warn(`  ${err.message.slice(0, 60)}...`)
      }
    }
  }
  
  log(`  ${c.dim}Created ${indexes} indexes${c.reset}`)

  // Seed default badges
  info("Seeding default badges...")
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
    `)
    success("  Seeded default badges")
  } catch (err) {
    warn(`  Could not seed badges: ${err.message}`)
  }

  // Ask about data migration
  log("")
  log(`${c.bold}${c.bgGreen}${c.white} DATA MIGRATION ${c.reset}`)
  log("")
  
  const tablesToMigrate = MIGRATE_TABLES.filter(t => 
    existingTables.includes(t) && tableCounts[t] > 0
  )
  
  if (tablesToMigrate.length === 0) {
    info("No data to migrate from original database.")
  } else {
    log(`${c.cyan}The following tables have data that can be migrated:${c.reset}`)
    for (const t of tablesToMigrate) {
      log(`  - ${t} (${tableCounts[t]} rows)`)
    }
    log("")
    
    const shouldMigrate = await askYesNo("Migrate data from original database?", true)
    
    if (shouldMigrate) {
      log("")
      log(`${c.bold}${c.cyan}Step 3: Data Migration${c.reset}`)
      log(`${c.dim}Transferring data from original database to new database...${c.reset}`)
      log("")
      
      // Order matters for foreign keys
      const orderedTables = [
        "users",
        "badges", // badges before user_badges
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
      ]
      
      // Column defaults for v1 -> v2 migration (columns that exist in v2 but not v1)
      // These are used when a NOT NULL column exists in v2 but not in v1 data
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
      }
      
      // Column renames from v1 -> v2 (old_name: new_name)
      const COLUMN_RENAMES = {
        scan_history: {
          results: "findings",  // v1 might have "results" instead of "findings"
          scan_results: "findings",
          result: "findings",
        },
      }
      
      // Columns that need JSON conversion (v1 might store as text)
      const JSON_COLUMNS = {
        scan_history: ["summary", "findings", "metadata", "results", "scan_results", "result"],
      }
      
      for (const table of orderedTables) {
        if (!tablesToMigrate.includes(table)) continue
        
        try {
          // Get columns from original table
          const colRes = await originalPool.query(`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = $1 AND table_schema = 'public'
            ORDER BY ordinal_position
          `, [table])
          const columns = colRes.rows.map(r => r.column_name)
          
          // Check which columns exist in new table (with nullability info)
          const newColRes = await newPool.query(`
            SELECT column_name, is_nullable, column_default 
            FROM information_schema.columns
            WHERE table_name = $1 AND table_schema = 'public'
          `, [table])
          const newColumnsInfo = new Map(newColRes.rows.map(r => [r.column_name, r]))
          const newColumns = new Set(newColRes.rows.map(r => r.column_name))
          
          // Handle column renames and find common columns
          const renames = COLUMN_RENAMES[table] || {}
          const columnMapping = new Map() // old_name -> new_name
          
          for (const oldCol of columns) {
            if (newColumns.has(oldCol)) {
              columnMapping.set(oldCol, oldCol)
            } else if (renames[oldCol] && newColumns.has(renames[oldCol])) {
              columnMapping.set(oldCol, renames[oldCol])
            }
          }
          
          const commonColumns = [...columnMapping.keys()]
          const targetColumns = [...columnMapping.values()]
          
          // Find new NOT NULL columns that need defaults (not in source, not already mapped)
          const tableDefaults = COLUMN_DEFAULTS[table] || {}
          const extraColumns = []
          const extraValues = []
          const mappedTargets = new Set(targetColumns)
          const oldColumns = new Set(columns)
          
          // Always add columns from COLUMN_DEFAULTS if they don't exist in old table
          for (const [col, defaultVal] of Object.entries(tableDefaults)) {
            if (!oldColumns.has(col) && !mappedTargets.has(col) && newColumnsInfo.has(col)) {
              extraColumns.push(col)
              extraValues.push(defaultVal)
            }
          }
          
          // Also check for other NOT NULL columns without defaults
          for (const [col, info] of newColumnsInfo) {
            if (!mappedTargets.has(col) && !extraColumns.includes(col) && info.is_nullable === 'NO' && !info.column_default) {
              // New required column without a default - this will fail
              warn(`    Missing default for NOT NULL column: ${col}`)
            }
          }
          
          if (commonColumns.length === 0) {
            warn(`  Skipping ${table}: no common columns`)
            continue
          }
          
          // Fetch data from original
          const dataRes = await originalPool.query(
            `SELECT ${commonColumns.map(c => `"${c}"`).join(", ")} FROM "${table}"`
          )
          
          if (dataRes.rows.length === 0) continue
          
          // Build column list with extra defaults (using target column names)
          const allTargetColumns = [...targetColumns, ...extraColumns]
          const colList = allTargetColumns.map(c => `"${c}"`).join(", ")
          const placeholders = [
            ...targetColumns.map((_, i) => `$${i + 1}`),
            ...extraValues
          ].join(", ")
          
          let migrated = 0
          let firstError = null
          const jsonCols = JSON_COLUMNS[table] || []
          
          for (const row of dataRes.rows) {
            try {
              // Transform values, handling JSON columns specially
              const values = commonColumns.map((col, idx) => {
                let val = row[col]
                const targetCol = targetColumns[idx]
                
                // Handle JSON columns - ensure they're valid JSON
                if (jsonCols.includes(col) || jsonCols.includes(targetCol)) {
                  if (val === null || val === undefined) {
                    return col.includes('findings') || col.includes('results') ? '[]' : '{}'
                  }
                  if (typeof val === 'string') {
                    try {
                      // Try to parse - if valid, return as-is
                      JSON.parse(val)
                      return val
                    } catch {
                      // Not valid JSON, wrap as string or return empty
                      return col.includes('findings') || col.includes('results') ? '[]' : '{}'
                    }
                  }
                  if (typeof val === 'object') {
                    return JSON.stringify(val)
                  }
                }
                return val
              })
              
              await newPool.query(
                `INSERT INTO "${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
                values
              )
              migrated++
            } catch (err) {
              // Capture first error for debugging
              if (!firstError) firstError = err.message
            }
          }
          
          // Show error if most rows failed
          if (migrated < dataRes.rows.length / 2 && firstError) {
            warn(`    Error sample: ${firstError.slice(0, 100)}`)
          }
          
          // Reset sequence if table has serial ID
          if (targetColumns.includes("id")) {
            try {
              await newPool.query(`
                SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), 
                  COALESCE((SELECT MAX(id) FROM "${table}"), 1))
              `)
            } catch {
              // No sequence, that's fine
            }
          }
          
          success(`  Migrated ${table}: ${migrated}/${dataRes.rows.length} rows`)
        } catch (err) {
          warn(`  Failed to migrate ${table}: ${err.message}`)
        }
      }
      
      // Post-migration cleanup: fix invalid roles from v1
      log("")
      info("Cleaning up v1 data...")
      try {
        const roleUpdate = await newPool.query(`
          UPDATE users SET role = 'user' WHERE role = 'beta_tester'
        `)
        if (roleUpdate.rowCount > 0) {
          success(`  Fixed ${roleUpdate.rowCount} users with invalid 'beta_tester' role -> 'user'`)
        } else {
          log(`  ${c.dim}No beta_tester roles to fix${c.reset}`)
        }
      } catch (err) {
        warn(`  Could not fix beta_tester roles: ${err.message}`)
      }
    }
  }

  // Done!
  log("")
  log(`${c.bold}${c.bgGreen}${c.black}                                                         ${c.reset}`)
  log(`${c.bold}${c.bgGreen}${c.black}   Migration Complete!                                   ${c.reset}`)
  log(`${c.bold}${c.bgGreen}${c.black}                                                         ${c.reset}`)
  log("")
  log(`  ${c.green}✓${c.reset} New database created: ${c.bold}${c.green}${newDbName}${c.reset}`)
  log(`  ${c.green}✓${c.reset} ${created} tables with fresh v2 schema`)
  log(`  ${c.green}✓${c.reset} Original database ${c.bold}${dbInfo.database}${c.reset} is ${c.green}safe and untouched${c.reset}`)
  log("")
  log(`${c.bold}${c.cyan}Next Steps:${c.reset}`)
  log(`  ${c.white}1.${c.reset} Update your DATABASE_URL in .env.local:`)
  log(`     ${c.dim}DATABASE_URL="${newDbUrl}"${c.reset}`)
  log("")
  log(`  ${c.white}2.${c.reset} Restart your dev server to use the new database`)
  log("")
  log(`  ${c.white}3.${c.reset} Once verified, you can optionally delete the old database:`)
  log(`     ${c.dim}${dbInfo.database}${c.reset}`)
  log("")

  await newPool.end()
  await originalPool.end()
}

main().catch((err) => {
  error(`Unexpected error: ${err.message}`)
  console.error(err)
  process.exit(1)
})
