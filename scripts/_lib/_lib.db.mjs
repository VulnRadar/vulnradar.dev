/**
 * VulnRadar — Database connection helpers.
 *
 * URL parsing, connection string building, pool factory, friendly error
 * wrapper. No business logic — see _lib.target.mjs for picker UI.
 */

import pg from "pg";

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
    const { error: logError } = await import("./_lib.output.mjs");
    logError(`Failed to connect: ${err.message}`);
    return false;
  }
}
