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
    rl.question(`${c.yellow}?${c.reset} ${question} ${c.dim}(y/n)${c.reset} `, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes")
    })
  })
}

// ── Parse expected schema from instrumentation.ts ───────────────────────────
function parseExpectedSchema() {
  const filePath = resolve(ROOT, "instrumentation.ts")
  const content = readFileSync(filePath, "utf-8")

  const tables = {}

  // Match CREATE TABLE statements
  // Use a custom parser instead of regex to handle nested parens like DEFAULT NOW()
  const createTablePattern = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)\s*\(/gi
  let match
  while ((match = createTablePattern.exec(content)) !== null) {
    const tableName = match[1]
    const startIdx = match.index + match[0].length

    // Walk forward from the opening paren, counting nesting depth
    let depth = 1
    let endIdx = startIdx
    for (let i = startIdx; i < content.length && depth > 0; i++) {
      if (content[i] === "(") depth++
      if (content[i] === ")") depth--
      endIdx = i
    }
    const body = content.substring(startIdx, endIdx)

    if (!tables[tableName]) tables[tableName] = new Set()

    // DEBUG: show what we parsed for users table
    if (tableName === "users") {
      console.log(`\n[DEBUG] Table: ${tableName}`)
      console.log(`[DEBUG] Body length: ${body.length}`)
      console.log(`[DEBUG] Body:\n${body}\n[/DEBUG]\n`)
    }

    // Extract column definitions (skip constraints like UNIQUE, PRIMARY KEY, etc.)
    for (const line of body.split(/\n/)) {
      // Strip leading whitespace and template literal noise (> prefix from SQL in template strings)
      const trimmed = line.replace(/^\s*>?\s*/, "").replace(/,\s*$/, "").trim()
      if (!trimmed) continue
      // Skip constraints, comments, closing parens, and backtick/template ends
      if (/^(UNIQUE|PRIMARY\s+KEY|FOREIGN\s+KEY|CHECK|CONSTRAINT|CREATE|--|\)|`|;|\$)/i.test(trimmed)) continue
      // Get column name: first word followed by a SQL type keyword
      const colMatch = trimmed.match(/^"?(\w+)"?\s+(SERIAL|BIGSERIAL|INTEGER|INT|SMALLINT|VARCHAR|TEXT|BOOLEAN|BOOL|TIMESTAMP|TIMESTAMPTZ|JSONB|JSON|BIGINT|UUID|REAL|FLOAT|DOUBLE|NUMERIC|DECIMAL|DATE|TIME|BYTEA|INET|CIDR|MACADDR)/i)
      if (colMatch) {
        tables[tableName].add(colMatch[1].toLowerCase())
        if (tableName === "users") {
          console.log(`[DEBUG] Matched column: ${colMatch[1]} (type: ${colMatch[2]})`)
        }
      } else if (tableName === "users" && trimmed.length > 0) {
        console.log(`[DEBUG] SKIPPED line: "${trimmed}"`)
      }
    }
  }

  // Match ALTER TABLE ... ADD COLUMN statements
  const alterRegex = /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?("?\w+"?)\s+/gi
  while ((match = alterRegex.exec(content)) !== null) {
    const tableName = match[1]
    const colName = match[2].replace(/"/g, "").toLowerCase()
    if (!tables[tableName]) tables[tableName] = new Set()
    tables[tableName].add(colName)
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
      log(`  ${c.dim}UNKNOWN${c.reset}        ${t} ${c.dim}(not in instrumentation.ts, probably fine)${c.reset}`)
    }
  }

  log("")
  log(`${c.bold}═══════════════════════════════════════════${c.reset}`)
  log("")

  // Summary
  if (missingTables.length === 0 && missingColumns.length === 0 && extraColumns.length === 0) {
    success("Your database schema is fully up to date! Nothing to do.")
    await pool.end()
    return
  }

  // ── Handle missing tables ─────────────────────────────────────────────────
  if (missingTables.length > 0) {
    warn(`${missingTables.length} table(s) are missing. Run the app once to auto-create them via instrumentation.ts,`)
    warn(`or run: ${c.cyan}node scripts/migrate.mjs --apply${c.reset}`)
    log("")

    if (process.argv.includes("--apply")) {
      const shouldCreate = await ask(`Create ${missingTables.length} missing table(s)? This will run the full schema from instrumentation.ts.`)
      if (shouldCreate) {
        info("Running full schema migration from instrumentation.ts...")
        try {
          // Just import and run the register function
          const instrModule = await import("../instrumentation.ts")
          if (instrModule.register) {
            // We can't easily call register() since it checks NEXT_RUNTIME
            // Instead, tell user to start the app
            warn("Missing tables will be created automatically when you start the app (npm run dev).")
          }
        } catch {
          warn("Could not auto-run migrations. Start the app with 'npm run dev' to create missing tables.")
        }
      }
    }
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

  log("")
  success("Migration check complete.")
  await pool.end()
}

main().catch((err) => {
  error(`Unexpected error: ${err.message}`)
  process.exit(1)
})
