/**
 * VulnRadar — Database connection helpers.
 *
 * URL parsing, connection string building, pool factory, friendly error
 * wrapper. No business logic — see _lib.target.mjs for picker UI.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import pg from "pg";
import { pgConnectionString, pgSslConfig } from "../../lib/database/pg-ssl.mjs";
import { splitDbUrlForEnv } from "./_lib.db-url.mjs";

// ── Database URL parsing ───────────────────────────────────────────────────
export function parseDbUrl(url) {
  const match = url.match(
    /postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:/]+):?(\d+)?\/([^?]+)(\?.*)?$/,
  );
  if (!match) return null;
  return {
    user: match[1],
    password: match[2],
    host: match[3],
    port: match[4] || "5432",
    database: match[5],
    search: match[6] || "",
  };
}

/**
 * Build a connection string from a parsed DB object, optionally overriding the
 * database name. Used to spin up an admin pool against the `postgres` database
 * for things like CREATE DATABASE or listing databases.
 *
 * Goes through the URL API so only the database changes. The query string used
 * to be dropped here, which took `?sslmode=require` with it, and db:create's
 * string replacement of "/<database>" hit the role instead whenever the two
 * share a name, which is the shipped default.
 */
export function buildConnectionString(parsed, database) {
  const url = new URL(`postgresql://${parsed.host}:${parsed.port || "5432"}`);
  url.username = parsed.user;
  url.password = parsed.password;
  url.pathname = `/${database ?? parsed.database}`;
  url.search = parsed.search ?? "";
  return url.toString();
}

/**
 * The connection half of a pg.Pool config, under the app's TLS rule.
 *
 * `ssl` is left out when TLS is off rather than set to false, which is the one
 * difference from lib/database/db.ts: node-pg only reads PGSSLMODE when the key
 * is absent, and an operator who exports it for pg_dump should not find the
 * same script's pool quietly in plaintext.
 */
export function pgPoolOptions(
  connectionString = process.env.DATABASE_URL,
  env = process.env,
) {
  const ssl = pgSslConfig(env);
  return {
    connectionString: pgConnectionString(connectionString, env),
    ...(ssl ? { ssl } : {}),
  };
}

// ── Pool factory (safe timeouts, friendly errors) ──────────────────────────
export function createPool() {
  return new pg.Pool({
    ...pgPoolOptions(),
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
  });
}

/**
 * The same rule for a libpq child process (pg_dump, psql), plus keeping the
 * password out of argv. Call `cleanup` once the child has exited.
 *
 * sslrootcert has to be a file, and with no CA configured libpq would look for
 * ~/.postgresql/root.crt, which does not exist, so verify-full would fail where
 * the pool succeeds. Writing out the roots Node itself trusts makes both verify
 * against the same set, on any libpq version (`sslrootcert=system` needs 16).
 * mkdtemp's private random directory is what stops another local user swapping
 * the file between the write and pg_dump reading it.
 */
export async function pgToolConnection(
  connectionString,
  baseEnv = process.env,
) {
  const { connArg, env } = splitDbUrlForEnv(
    pgConnectionString(connectionString, baseEnv),
    baseEnv,
  );
  const ssl = pgSslConfig(baseEnv);
  if (!ssl) return { connArg, env, cleanup: async () => {} };

  const dir = await mkdtemp(join(tmpdir(), "vulnradar-pgssl-"));
  const rootCert = join(dir, "root.crt");
  // getCACertificates also covers NODE_EXTRA_CA_CERTS; it landed in 22.15 and
  // package.json allows any 22.
  const roots =
    ssl.ca ?? (tls.getCACertificates?.() ?? tls.rootCertificates).join("\n");
  await writeFile(rootCert, roots, { mode: 0o600 });
  return {
    connArg,
    env: { ...env, PGSSLMODE: "verify-full", PGSSLROOTCERT: rootCert },
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
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
