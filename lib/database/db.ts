import { Pool } from "pg";
import {
  CONFIG_DB_POOL_MAX,
  CONFIG_DB_POOL_MIN,
  CONFIG_DB_IDLE_TIMEOUT_MS,
  CONFIG_DB_CONNECTION_TIMEOUT_MS,
  CONFIG_DB_STATEMENT_TIMEOUT_MS,
  CONFIG_DB_QUERY_TIMEOUT_MS,
} from "@/lib/config/config-values";
import { APP_SLUG } from "@/lib/config/constants";
import { pgConnectionString, pgSslConfig } from "@/lib/database/pg-ssl.mjs";
import { logError } from "@/lib/logging/log";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL environment variable is not set. Add it to your .env.local file or Vercel project settings.",
  );
}

/**
 * Read a pool tuning value from the environment, falling back to the
 * compiled default in lib/config/config-values.ts.
 *
 * Per-deployment sizing has to be changeable without a rebuild: the same
 * image runs on a 1 GB VPS and on a managed Postgres with a connection
 * pooler in front, and those want very different numbers. A value that
 * is not a non-negative finite number is rejected loudly rather than
 * silently coerced, because a typo here surfaces later as connection
 * exhaustion under load, which is painful to diagnose.
 */
function tunable(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      `[db] ${name}=${JSON.stringify(raw)} is not a non-negative number. ` +
        `Remove it to use the default (${fallback}).`,
    );
  }
  return parsed;
}

export const POOL_CONFIG = {
  max: tunable("DATABASE_POOL_MAX", CONFIG_DB_POOL_MAX),
  min: tunable("DATABASE_POOL_MIN", CONFIG_DB_POOL_MIN),
  idleTimeoutMillis: tunable(
    "DATABASE_IDLE_TIMEOUT_MS",
    CONFIG_DB_IDLE_TIMEOUT_MS,
  ),
  connectionTimeoutMillis: tunable(
    "DATABASE_CONNECTION_TIMEOUT_MS",
    CONFIG_DB_CONNECTION_TIMEOUT_MS,
  ),
  statement_timeout: tunable(
    "DATABASE_STATEMENT_TIMEOUT_MS",
    CONFIG_DB_STATEMENT_TIMEOUT_MS,
  ),
  query_timeout: tunable(
    "DATABASE_QUERY_TIMEOUT_MS",
    CONFIG_DB_QUERY_TIMEOUT_MS,
  ),
};

/**
 * Next bundles this module once per runtime layer, so a module-level pool was
 * three pools in one process, each allowed POOL_CONFIG.max connections and each
 * reporting only its own counters. Keyed on globalThis so every copy shares one.
 *
 * Local until lib/runtime/global-singleton.ts lands; same signature.
 */
function globalSingleton<T>(key: string, init: () => T): T {
  const store = globalThis as unknown as Record<symbol, T | undefined>;
  const slot = Symbol.for(key);
  let value = store[slot];
  if (value === undefined) {
    value = init();
    store[slot] = value;
  }
  return value;
}

const pool = globalSingleton<Pool>("vulnradar.dbPool", () => {
  const created = new Pool({
    // Paired on purpose: see lib/database/pg-ssl.mjs for why the URL has to
    // change as well for `ssl` to mean anything.
    connectionString: pgConnectionString(process.env.DATABASE_URL),
    ssl: pgSslConfig(),
    // Cap each connection at POOL_CONFIG.max simultaneous clients.
    // statement_timeout prevents any single query from holding a slot
    // indefinitely: without it, the pool can be saturated by that many slow
    // queries and every other request (including login) blocks behind them.
    ...POOL_CONFIG,
    application_name: APP_SLUG,
    // Pin every session to UTC. The daily-quota buckets on date_trunc('day',
    // NOW()) / CURRENT_DATE (lib/rate-limiting/daily-limits.ts) while the API
    // advertises and computes reset at "midnight UTC"; without this, a Postgres
    // running in a non-UTC timezone would reset the counter at the server's
    // local midnight, off the documented boundary.
    options: "-c timezone=UTC",
  });

  // Inside the initializer so the listener is attached once, not once per copy.
  created.on("error", (err) => {
    logError("db", "Unexpected database pool error", err);
  });
  return created;
});

/**
 * Live pool counters, for the readiness endpoint. `waiting` is the number
 * that matters operationally: anything consistently above zero means
 * requests are queueing for a connection and the pool needs to be bigger
 * (or the slow queries need fixing).
 */
export function getPoolStats(): {
  total: number;
  idle: number;
  waiting: number;
  max: number;
} {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    max: POOL_CONFIG.max,
  };
}

export default pool;
