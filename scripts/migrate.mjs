#!/usr/bin/env node

/**
 * VulnRadar Database Migration Script
 *
 * Connects to your database, reads the expected schema from instrumentation.ts,
 * compares it against the actual DB, and offers to fix differences.
 *
 * Features:
 *   - Detects missing/extra tables and columns
 *   - Detects renamed tables and columns (via rename mappings below)
 *   - Interactive prompts with safe defaults (review = Y, destructive = N)
 *
 * Usage:
 *   node scripts/migrate.mjs
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

// ── Rename Mappings ─────────────────────────────────────────────────────────
// When a table or column is renamed between versions, add an entry here.
// The migration tool will detect the old name in the DB and offer to rename it.
//
// Format:
//   TABLE_RENAMES: { "old_table_name": "new_table_name" }
//   COLUMN_RENAMES: { "table_name": { "old_column_name": "new_column_name" } }
//
// Example:
//   TABLE_RENAMES: { "user": "users", "scan_result": "scan_history" }
//   COLUMN_RENAMES: { "sessions": { "ip_address": "ipaddress" } }

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
// askReview: defaults to YES (pressing Enter = yes) - used for non-destructive review prompts
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

// askDanger: defaults to NO (pressing Enter = no) - used for destructive actions
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

  info("Reading actual database schema...")
  const actual = await getActualSchema(pool)
  success(`Found ${Object.keys(actual).length} tables in database.`)

  // ── Phase 1: Detect and apply table renames ─────────────────────────────
  const tableRenamesApplied = []
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
    log(`${c.magenta}Found ${pendingTableRenames.length} table(s) that appear to have been renamed in a newer version.${c.reset}`)
    log("")

    for (const { oldName, newName } of pendingTableRenames) {
      log(`  ${c.magenta}RENAME${c.reset}  ${c.bold}${oldName}${c.reset} ${c.dim}->${c.reset} ${c.bold}${newName}${c.reset}`)

      try {
        const countRes = await pool.query(`SELECT COUNT(*) as total FROM "${oldName}"`)
        log(`          ${c.dim}(${countRes.rows[0].total} rows, data will be preserved)${c.reset}`)
      } catch { /* ignore */ }

      const shouldRename = await askReview(`Rename table ${c.bold}${oldName}${c.reset} to ${c.bold}${newName}${c.reset}?`)
      if (shouldRename) {
        try {
          await pool.query(`ALTER TABLE "${oldName}" RENAME TO "${newName}"`)
          success(`Renamed table ${oldName} -> ${newName}`)
          tableRenamesApplied.push({ oldName, newName })
          // Update the actual schema in memory
          actual[newName] = actual[oldName]
          delete actual[oldName]
        } catch (err) {
          error(`Failed to rename ${oldName} -> ${newName}: ${err.message}`)
        }
      } else {
        info(`Skipped renaming ${oldName}`)
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
    log(`${c.magenta}Found ${pendingColRenames.length} column(s) that appear to have been renamed in a newer version.${c.reset}`)
    log("")

    for (const { table, oldCol, newCol } of pendingColRenames) {
      log(`  ${c.magenta}RENAME${c.reset}  ${c.bold}${table}.${oldCol}${c.reset} ${c.dim}->${c.reset} ${c.bold}${table}.${newCol}${c.reset}`)

      try {
        const countRes = await pool.query(`SELECT COUNT("${oldCol}") as non_null FROM "${table}" WHERE "${oldCol}" IS NOT NULL`)
        log(`          ${c.dim}(${countRes.rows[0].non_null} non-null values, data will be preserved)${c.reset}`)
      } catch { /* ignore */ }

      const shouldRename = await askReview(`Rename column ${c.bold}${table}.${oldCol}${c.reset} to ${c.bold}${newCol}${c.reset}?`)
      if (shouldRename) {
        try {
          await pool.query(`ALTER TABLE "${table}" RENAME COLUMN "${oldCol}" TO "${newCol}"`)
          success(`Renamed ${table}.${oldCol} -> ${table}.${newCol}`)
          // Update actual schema in memory
          const idx = actual[table].indexOf(oldCol)
          if (idx !== -1) actual[table][idx] = newCol
        } catch (err) {
          error(`Failed to rename ${table}.${oldCol}: ${err.message}`)
        }
      } else {
        info(`Skipped renaming ${table}.${oldCol}`)
      }
    }
  }

  // ── Phase 3: Schema comparison (after renames applied) ──────────────────
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
    log(`${c.dim}If you'd like to create them now, start the app once and they will be set up via instrumentation.ts.${c.reset}`)
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
          } else {
            info(`Skipped ${table}.${column}`)
          }
        } else {
          warn(`Could not find column definition for ${table}.${column}. Start the app to auto-migrate.`)
        }
      }
    }
  }

  // ── Handle extra columns ──────────────────────────────────────────────────
  if (extraColumns.length > 0) {
    log("")
    log(`${c.yellow}${extraColumns.length} extra column(s) found that are not in the current schema.${c.reset}`)
    log(`${c.dim}These may be from custom modifications or older versions.${c.reset}`)
    log(`${c.red}${c.bold}WARNING: Dropping columns permanently deletes data in those columns!${c.reset}`)
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
          const { total, non_null } = countRes.rows[0]
          log(`  ${c.dim}Rows: ${total}, Non-null values: ${non_null}${c.reset}`)
        } catch {
          log(`  ${c.dim}(could not check data)${c.reset}`)
        }

        const shouldDrop = await askDanger(`Drop column ${c.bold}${table}.${column}${c.reset}? THIS CANNOT BE UNDONE.`)
        if (shouldDrop) {
          try {
            await pool.query(`ALTER TABLE "${table}" DROP COLUMN "${column}"`)
            success(`Dropped ${table}.${column}`)
          } catch (err) {
            error(`Failed to drop ${table}.${column}: ${err.message}`)
          }
        } else {
          info(`Skipped ${table}.${column}`)
        }
      }
    }
  }

  // ── Handle unknown/extra tables ───────────────────────────────────────────
  if (unknownTables.length > 0) {
    log("")
    log(`${c.yellow}${unknownTables.length} table(s) found in the database that are not part of the VulnRadar schema.${c.reset}`)
    log(`${c.dim}These may be from custom modifications, plugins, or a shared database.${c.reset}`)
    log("")
    log(`${c.cyan}NOTE:${c.reset} We recommend using a dedicated database for VulnRadar rather than sharing`)
    log(`      it with other applications. This helps avoid conflicts during migrations`)
    log(`      and ensures schema updates can be applied cleanly.`)
    log("")
    log(`${c.red}${c.bold}WARNING: Dropping tables permanently deletes ALL data in those tables!${c.reset}`)
    log("")

    const shouldReview = await askReview("Review extra tables?")
    if (shouldReview) {
      for (const table of unknownTables) {
        log("")
        log(`  Table: ${c.bold}${table}${c.reset}  ${c.dim}(${actual[table].length} columns)${c.reset}`)

        try {
          const countRes = await pool.query(`SELECT COUNT(*) as total FROM "${table}"`)
          log(`  ${c.dim}Rows: ${countRes.rows[0].total}${c.reset}`)
        } catch {
          log(`  ${c.dim}(could not check row count)${c.reset}`)
        }

        const shouldDrop = await askDanger(`Drop table ${c.bold}${table}${c.reset}? THIS CANNOT BE UNDONE.`)
        if (shouldDrop) {
          const reallyDrop = await askDanger(`Are you ABSOLUTELY sure? Type y again to confirm dropping ${c.bold}${table}${c.reset}.`)
          if (reallyDrop) {
            try {
              await pool.query(`DROP TABLE "${table}" CASCADE`)
              success(`Dropped table ${table}`)
            } catch (err) {
              error(`Failed to drop table ${table}: ${err.message}`)
            }
          } else {
            info(`Skipped ${table}`)
          }
        } else {
          info(`Skipped ${table}`)
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
