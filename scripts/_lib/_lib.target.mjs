/**
 * VulnRadar — Database target picker.
 *
 * Lists every non-template database on the host and lets the user pick one
 * with cancel/exit semantics. Works on managed Postgres providers (Neon,
 * Supabase, RDS) that don't expose the `postgres` admin database.
 */

import pg from "pg";
import * as readline from "node:readline";
import { c, log, warn } from "./_lib.output.mjs";
import { ask, askYesNo, askDanger } from "./_lib.prompts.mjs";
import { buildConnectionString } from "./_lib.db.mjs";

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

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
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
    const answer = (
      await rawQuestion(
        `${c.cyan}?${c.reset} ${prompt} ${c.dim}[1-${choices.length}${allowCustom ? ", 0, n" : ", n"}]${c.reset} `,
      )
    ).trim();
    const trimmed = answer.toLowerCase();

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

// Re-export formatBytes so the barrel's surface stays the same.
export { formatBytes };
