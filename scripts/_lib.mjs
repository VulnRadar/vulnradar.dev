#!/usr/bin/env node

/**
 * VulnRadar — Shared helpers for scripts in this directory.
 *
 * Centralises:
 *   - Coloured terminal output (log/info/success/warn/error)
 *   - Banner / section headers
 *   - .env.local loading (DATABASE_URL fallback)
 *   - Interactive prompts (ask / askYesNo / askDanger)
 *   - Version + project metadata (read from package.json)
 *   - Postgres URL parsing + safe pool construction
 *   - Schema introspection helpers
 *
 * Never import this file from a runtime/server path; it's CLI-only.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as readline from "node:readline";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, "..");

// ── ANSI colours ────────────────────────────────────────────────────────────
export const c = {
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
  bgCyan: "\x1b[46m",
};

export const log = (msg) => console.log(msg);
export const info = (msg) => log(`${c.cyan}[INFO]${c.reset} ${msg}`);
export const success = (msg) => log(`${c.green}[OK]${c.reset}   ${msg}`);
export const warn = (msg) => log(`${c.yellow}[WARN]${c.reset} ${msg}`);
export const error = (msg) => log(`${c.red}[ERR]${c.reset}  ${msg}`);
// ── Banner / section header ────────────────────────────────────────────────
/**
 * Compute the visible length of a string (excluding ANSI escape codes).
 * Used to build box-drawing borders that align regardless of color codes.
 */
function visibleLength(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function padToVisible(s, width) {
  const pad = Math.max(0, width - visibleLength(s));
  return s + " ".repeat(pad);
}

export function banner(title, subtitle) {
  const innerWidth = Math.max(
    visibleLength(title),
    subtitle ? visibleLength(subtitle) : 0,
  );
  const horizontal = "═".repeat(innerWidth + 4);
  const top = `  ╔${horizontal}╗`;
  const bot = `  ╚${horizontal}╝`;
  // Pad with spaces AFTER the styled title/subtitle so the right border ║
  // stays inside the cyan color span (not white/default).
  const titleLine = `  ║  ${c.bold}${title}${c.reset}${" ".repeat(
    Math.max(0, innerWidth - title.length),
  )}  ║`;
  const subLine = subtitle
    ? `  ║  ${c.dim}${subtitle}${c.reset}${" ".repeat(
        Math.max(0, innerWidth - subtitle.length),
      )}  ║`
    : null;

  log("");
  log(`${c.bold}${c.cyan}${top}${c.reset}`);
  log(`${c.cyan}${titleLine}${c.reset}`);
  if (subLine) log(`${c.cyan}${subLine}${c.reset}`);
  log(`${c.bold}${c.cyan}${bot}${c.reset}`);
  log("");
}

export function section(title) {
  log("");
  log(
    `${c.bold}─── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}${c.reset}`,
  );
  log("");
}
// ── .env.local loader (only sets vars not already in process.env) ──────────
export function loadEnv() {
  if (process.env.DATABASE_URL) return true;
  try {
    const envPath = resolve(ROOT, ".env.local");
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
    return Boolean(process.env.DATABASE_URL);
  } catch {
    return false;
  }
}

// ── Interactive prompts ────────────────────────────────────────────────────
function rawQuestion(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export async function ask(question, defaultVal = "") {
  const hint = defaultVal ? ` ${c.dim}(${defaultVal})${c.reset}` : "";
  const answer = await rawQuestion(`${c.cyan}?${c.reset} ${question}${hint} `);
  return answer.trim() || defaultVal;
}

export async function askYesNo(question, defaultYes = false) {
  const hint = defaultYes
    ? `${c.dim}(Y/n)${c.reset}`
    : `${c.dim}(y/N)${c.reset}`;
  const answer = (
    await rawQuestion(`${c.cyan}?${c.reset} ${question} ${hint} `)
  )
    .trim()
    .toLowerCase();
  if (answer === "") return defaultYes;
  return answer === "y" || answer === "yes";
}

export async function askDanger(question) {
  const answer = (
    await rawQuestion(
      `${c.red}?${c.reset} ${question} ${c.dim}(y/N)${c.reset} `,
    )
  )
    .trim()
    .toLowerCase();
  return answer === "y" || answer === "yes";
}

// ── Project metadata (from package.json — single source of truth) ──────────
export function getProjectMeta() {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));
  return {
    name: pkg.name ?? "vulnradar",
    version: pkg.version ?? "0.0.0",
    description: pkg.description ?? "",
    node: pkg.engines?.node ?? ">=20",
  };
}

// ── Database URL parsing ───────────────────────────────────────────────────
export function parseDbUrl(url) {
  const match = url.match(
    /postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:/]+):?(\d+)?\/([^?]+)/,
  );
  if (!match) return null;
  return {
    user: match[1],
    password: match[2],
    host: match[3],
    port: match[4] || "5432",
    database: match[5],
  };
}

/**
 * Build a connection string from a parsed DB object, optionally overriding the
 * database name. Used to spin up an admin pool against the `postgres` database
 * for things like CREATE DATABASE or listing databases.
 */
export function buildConnectionString(parsed, database) {
  const db = database ?? parsed.database;
  const port = parsed.port || "5432";
  return `postgresql://${parsed.user}:${parsed.password}@${parsed.host}:${port}/${db}`;
}

/**
 * Pretty-print a parsed DB for human display. NEVER includes the password.
 */
export function formatDbTarget(parsed) {
  if (!parsed) return null;
  const port = parsed.port || "5432";
  return `${parsed.user}@${parsed.host}:${port}/${parsed.database}`;
}

/**
 * Just the host:port (no user, no database). Useful for intro screens where
 * the database will be picked afterwards, so showing the DB name is noise.
 */
export function formatDbHost(parsed) {
  if (!parsed) return null;
  const port = parsed.port || "5432";
  return `${parsed.host}:${port}`;
}

/**
 * Connect to the user's target database and list every non-template database
 * on the same host. Returns an array of { name, sizeBytes, owner }.
 *
 * Note: `pg_database` is a cluster-wide view, so we don't need to connect to
 * a special admin database — any database in the cluster can see every
 * database. This means it works on managed Postgres providers (Neon, Supabase,
 * RDS) that don't expose the `postgres` admin database.
 */
export async function listDatabases(parsed) {
  const pool = new pg.Pool({
    connectionString: buildConnectionString(parsed),
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
  });
  try {
    const res = await pool.query(`
      SELECT
        d.datname AS name,
        pg_database_size(d.datname) AS size_bytes,
        pg_catalog.pg_get_userbyid(d.datdba) AS owner,
        d.datistemplate AS is_template
      FROM pg_database d
      WHERE d.datistemplate = false
      ORDER BY d.datname
    `);
    return res.rows
      .filter((r) => !r.is_template)
      .map((r) => ({
        name: r.name,
        sizeBytes: Number(r.size_bytes),
        owner: r.owner,
      }));
  } finally {
    await pool.end();
  }
}

/**
 * Show a numbered list of databases on the same host and let the user pick.
 *
 * Flow:
 *   1. Show the list
 *   2. User picks (or `n` / `cancel` to abort → returns null)
 *   3. Confirm: "Use <name>? (Y/n)"
 *      - y  → return the chosen name
 *      - n  → loop back to the picker
 *      - c  → confirm cancel → returns null
 *
 * Returns the chosen database name, or null if the user cancelled.
 */
export async function chooseDatabase(parsed, options = {}) {
  const {
    currentDb = parsed.database,
    prompt = "Which database",
    excludeCurrent = false,
    allowCustom = true,
  } = options;

  const dbs = await listDatabases(parsed);
  const choices = excludeCurrent
    ? dbs.filter((d) => d.name !== currentDb)
    : dbs;

  const renderList = () => {
    log("");
    log(
      `  ${c.bold}Databases on ${c.cyan}${parsed.host}:${parsed.port}${c.reset}:${c.reset}`,
    );
    for (let i = 0; i < choices.length; i++) {
      const d = choices[i];
      const isCurrent = d.name === currentDb;
      const marker = isCurrent ? `${c.green}*${c.reset}` : " ";
      const sizeStr = formatBytes(d.sizeBytes);
      log(
        `    ${marker} ${c.bold}${String(i + 1).padStart(2)}${c.reset}. ${d.name} ${c.dim}(${sizeStr})${c.reset}`,
      );
    }
    if (allowCustom) {
      log(`     ${c.dim} 0.  Enter a custom database name${c.reset}`);
    }
    log(`     ${c.dim} n.  Cancel (abort this script)${c.reset}`);
    if (currentDb) {
      log("");
      log(`  ${c.dim}* = current (${currentDb})${c.reset}`);
    }
    log("");
  };

  renderList();

  while (true) {
    const raw = await rawQuestion(
      `${c.cyan}?${c.reset} ${prompt} ${c.dim}[1-${choices.length}${allowCustom ? ", 0, n" : ", n"}]${c.reset} `,
    );
    const trimmed = raw.trim().toLowerCase();

    // Cancel paths
    if (
      trimmed === "n" ||
      trimmed === "no" ||
      trimmed === "q" ||
      trimmed === "quit" ||
      trimmed === "cancel" ||
      trimmed === "exit"
    ) {
      const sure = await askDanger("Cancel this operation?");
      if (sure) {
        warn("Cancelled.");
        return null;
      }
      renderList();
      continue;
    }

    // Default to current DB on bare Enter
    if (trimmed === "" && currentDb) {
      const confirmed = await askYesNo(
        `Use ${c.bold}${currentDb}${c.reset} ${c.dim}(current)${c.reset}?`,
        true,
      );
      if (confirmed) return currentDb;
      renderList();
      continue;
    }

    // Custom name
    if (allowCustom && (trimmed === "0" || trimmed === "custom")) {
      const customName = await ask("Enter database name");
      if (!customName) {
        warn("Empty name. Try again.");
        renderList();
        continue;
      }
      const confirmed = await askYesNo(
        `Use ${c.bold}${customName}${c.reset} ${c.dim}(custom)${c.reset}?`,
        true,
      );
      if (confirmed) return customName;
      renderList();
      continue;
    }

    // Numeric pick
    const n = Number(trimmed);
    if (Number.isInteger(n) && n >= 1 && n <= choices.length) {
      const picked = choices[n - 1].name;
      const tag = picked === currentDb ? ` ${c.dim}(current)${c.reset}` : "";
      const confirmed = await askYesNo(
        `Use ${c.bold}${picked}${c.reset}${tag}?`,
        true,
      );
      if (confirmed) return picked;
      renderList();
      continue;
    }

    warn("Invalid selection. Try again.");
  }
}

// ── Pool factory (safe timeouts, friendly errors) ──────────────────────────
export function createPool() {
  return new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
  });
}

export async function connect(pool) {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch (err) {
    error(`Failed to connect: ${err.message}`);
    return false;
  }
}

// ── Schema introspection helpers ──────────────────────────────────────────
export async function getExistingTables(pool) {
  const res = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  return res.rows.map((r) => r.table_name);
}

export async function getTableCounts(pool, tables) {
  const counts = {};
  for (const t of tables) {
    try {
      const res = await pool.query(`SELECT COUNT(*)::int AS n FROM "${t}"`);
      counts[t] = res.rows[0].n;
    } catch {
      counts[t] = 0;
    }
  }
  return counts;
}

export async function getDatabaseSummary(pool) {
  const tables = await getExistingTables(pool);
  const counts = await getTableCounts(pool, tables);
  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
  return { tables, counts, totalRows };
}

// ── Formatting helpers ─────────────────────────────────────────────────────
export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

// ── Top-of-script confirmation gate ────────────────────────────────────────
/**
 * Prints a structured "what this script will do" panel and asks the user to
 * confirm before proceeding. Pass `destructive: true` to swap the prompt for
 * the red danger variant.
 *
 * @param {object} opts
 * @param {string} opts.title        — e.g. "Run database migration"
 * @param {string} opts.tagline      — one-line description
 * @param {string[]} opts.steps      — ordered list of what will happen
 * @param {string[]} opts.warnings   — optional list of caveats
 * @param {boolean} [opts.destructive]
 * @param {string} [opts.target]     — e.g. "db 'vulnradar' on localhost"
 * @returns {Promise<boolean>}
 */
export async function confirmIntro({
  title,
  tagline,
  steps,
  warnings = [],
  destructive = false,
  target,
}) {
  banner(title, tagline);

  if (target) {
    log(`  ${c.dim}Target:${c.reset}  ${c.bold}${target}${c.reset}`);
    log("");
  }

  if (steps?.length) {
    log(`  ${c.bold}What this script will do:${c.reset}`);
    for (const step of steps) log(`    ${c.cyan}•${c.reset} ${step}`);
    log("");
  }

  if (warnings.length) {
    const prefix = destructive ? c.red : c.yellow;
    const label = destructive ? "Destructive operations" : "Heads up";
    log(`  ${prefix}${c.bold}${label}:${c.reset}`);
    for (const w of warnings) log(`    ${prefix}!${c.reset} ${w}`);
    log("");
  }

  const confirmFn = destructive ? askDanger : askYesNo;
  const prompt = destructive
    ? "Proceed? This is a destructive operation."
    : "Proceed?";
  return confirmFn(prompt, !destructive);
}

// ── Pre-flight: ensure DATABASE_URL is available ───────────────────────────
export function requireDatabaseUrl() {
  if (!process.env.DATABASE_URL) {
    error("DATABASE_URL is not set.");
    log("");
    info("Set it in your environment or in .env.local at the project root.");
    info("Example: DATABASE_URL=postgres://user:pass@host:5432/dbname");
    log("");
    process.exit(1);
  }
}
