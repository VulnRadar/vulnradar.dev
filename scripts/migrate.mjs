#!/usr/bin/env node

/**
 * VulnRadar Database Migration Script
 *
 * Connects to your database, reads the expected schema from instrumentation.ts,
 * compares it against the actual DB, and offers to fix differences.
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

// ── Colors for terminal output ──────────────────────────────────────────────
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
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
      // Remove surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (!process.env[key]) process.env[key] = val
    }
  } catch {
    // No .env.local, that's fine
  }
}

// ── Prompt user for yes/no ──────────────────────────────────────────────────
function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(`${c.yellow}?${c.reset} ${question} ${c.dim}(y/N)${c.reset} `, (answer) => {
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

  // Simple line-by-line state machine parser
  // This avoids all regex/paren issues with SQL inside template literals
  const SQL_TYPES = /^(SERIAL|BIGSERIAL|INTEGER|INT|SMALLINT|VARCHAR|TEXT|BOOLEAN|BOOL|TIMESTAMP|TIMESTAMPTZ|JSONB|JSON|BIGINT|UUID|REAL|FLOAT|DOUBLE|NUMERIC|DECIMAL|DATE|TIME|BYTEA|INET|CIDR|MACADDR)\b/i
  const SKIP_KEYWORDS = /^(UNIQUE|PRIMARY\s+KEY|FOREIGN\s+KEY|CHECK|CONSTRAINT)/i

  let currentTable = null
  const lines = content.split("\n")

  for (const rawLine of lines) {
    const line = rawLine.trim()

    // Detect CREATE TABLE
    const tableMatch = line.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/i)
    if (tableMatch) {
      currentTable = tableMatch[1]
      if (!tables[currentTable]) tables[currentTable] = new Set()

      // Handle case where column defs are on the SAME line after the opening paren
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

    // Detect end of CREATE TABLE block
    if (currentTable && /^\);?\s*$/.test(line)) {
      currentTable = null
      continue
    }

    // Inside a CREATE TABLE block: parse column definitions
    if (currentTable) {
      // Clean up: remove trailing commas, semicolons, closing parens
      const cleaned = line.replace(/,\s*$/, "").replace(/\)\s*;?\s*$/, "").trim()
      if (!cleaned) continue
      // Skip SQL constraints and comments
      if (SKIP_KEYWORDS.test(cleaned)) continue
      if (cleaned.startsWith("--")) continue

      // Extract: column_name TYPE ...
      const parts = cleaned.split(/\s+/)
      if (parts.length >= 2) {
        const colName = parts[0].replace(/"/g, "")
        const colType = parts[1]
        // Must look like a valid column name (letters/underscores) followed by a SQL type
        if (/^\w+$/.test(colName) && SQL_TYPES.test(colType)) {
          tables[currentTable].add(colName.toLowerCase())
        }
      }
    }

    // Detect ALTER TABLE ... ADD COLUMN
    const alterMatch = line.match(/ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?("?\w+"?)\s+/i)
    if (alterMatch) {
      const tbl = alterMatch[1]
      const col = alterMatch[2].replace(/"/g, "").toLowerCase()
      if (!tables[tbl]) tables[tbl] = new Set()
      tables[tbl].add(col)
    }
  }

  // Convert Sets to arrays
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

  log("")
  log(`${c.bold}═══════════════════════════════════════════${c.reset}`)
  log(`${c.bold}  Schema Comparison${c.reset}`)
  log(`${c.bold}═══════════════════════════════════════════${c.reset}`)
  log("")

  const missingTables = []
  const missingColumns = [] // { table, column }
  const extraColumns = []   // { table, column }

  // Check for missing tables and columns
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

  // Check for tables in DB that aren't in instrumentation.ts
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

  // Summary
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
    log(`${c.yellow}${missingColumns.length} column(s) are missing from existing tables.${c.reset}`)
    log(`${c.dim}These will be added automatically when you start the app, or you can apply now.${c.reset}`)
    log("")

    const shouldAdd = await ask(`Add ${missingColumns.length} missing column(s) now?`)
    if (shouldAdd) {
      for (const { table, column } of missingColumns) {
        // Try to find the column definition from instrumentation.ts
        const filePath = resolve(ROOT, "instrumentation.ts")
        const content = readFileSync(filePath, "utf-8")

        // Find the ALTER TABLE or CREATE TABLE with this column
        const alterRegex = new RegExp(
          `ALTER\\s+TABLE\\s+${table}\\s+ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${column}\\s+([^;]+)`,
          "i"
        )
        const alterMatch = content.match(alterRegex)

        if (alterMatch) {
          const colDef = alterMatch[0]
          try {
            await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${alterMatch[1].split(";")[0].trim()}`)
            success(`Added ${table}.${column}`)
          } catch (err) {
            error(`Failed to add ${table}.${column}: ${err.message}`)
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

    const shouldReview = await ask("Review and selectively drop extra columns?")
    if (shouldReview) {
      for (const { table, column } of extraColumns) {
        log("")
        log(`  Table: ${c.bold}${table}${c.reset}  Column: ${c.bold}${column}${c.reset}`)

        // Check if there's data in this column
        try {
          const countRes = await pool.query(
            `SELECT COUNT(*) as total, COUNT(${column}) as non_null FROM ${table}`
          )
          const { total, non_null } = countRes.rows[0]
          log(`  ${c.dim}Rows: ${total}, Non-null values: ${non_null}${c.reset}`)
        } catch {
          log(`  ${c.dim}(could not check data)${c.reset}`)
        }

        const shouldDrop = await ask(`Drop column ${c.bold}${table}.${column}${c.reset}? THIS CANNOT BE UNDONE.`)
        if (shouldDrop) {
          try {
            await pool.query(`ALTER TABLE ${table} DROP COLUMN ${column}`)
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

    const shouldReview = await ask("Review and selectively drop extra tables?")
    if (shouldReview) {
      for (const table of unknownTables) {
        log("")
        log(`  Table: ${c.bold}${table}${c.reset}  ${c.dim}(${actual[table].length} columns)${c.reset}`)

        // Show row count
        try {
          const countRes = await pool.query(`SELECT COUNT(*) as total FROM "${table}"`)
          log(`  ${c.dim}Rows: ${countRes.rows[0].total}${c.reset}`)
        } catch {
          log(`  ${c.dim}(could not check row count)${c.reset}`)
        }

        const shouldDrop = await ask(`Drop table ${c.bold}${table}${c.reset}? THIS CANNOT BE UNDONE.`)
        if (shouldDrop) {
          // Double confirm for tables
          const reallyDrop = await ask(`Are you ABSOLUTELY sure? Type y again to confirm dropping ${c.bold}${table}${c.reset}.`)
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
