import { NextResponse } from "next/server";
import pool, { getPoolStats } from "@/lib/database/db";
import { APP_VERSION, MIN_SCHEMA_VERSION } from "@/lib/config/constants";
import { CONFIG_DB_HEALTHCHECK_TIMEOUT_MS } from "@/lib/config/config-values";
import { REQUIRED_TABLES } from "@/lib/database/required-tables";

/**
 * Readiness endpoint.
 *
 * Answers one question: can this process serve traffic right now? The
 * container HEALTHCHECK, docker compose, and any load balancer in front
 * of a self-hosted deployment all need that answer, and none of them can
 * get it from a page render. The previous probe target, /api/version,
 * only talks to the GitHub releases API, so a container with a dead
 * database still reported healthy.
 *
 * Returns 200 when the database answers and its schema is new enough,
 * 503 otherwise, so an orchestrator can act on the status code alone.
 *
 * Deliberately terse in what it reveals. The app version is already
 * public via /api/version, and the schema version tells an operator
 * whether a migration is pending, but connection strings, hostnames, and
 * driver error text stay in the server log.
 */

// Never cached: a cached readiness answer is not a readiness answer.
export const dynamic = "force-dynamic";
export const revalidate = 0;

type DbStatus = {
  connected: boolean;
  latency_ms: number | null;
  schema_version: string | null;
  schema_required: string;
  schema_ok: boolean;
  missing_tables: string[];
  pool: ReturnType<typeof getPoolStats>;
};

function compareVersions(a: string, b: string): number {
  const av = a.split(".").map((s) => Number.parseInt(s, 10) || 0);
  const bv = b.split(".").map((s) => Number.parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const x = av[i] ?? 0;
    const y = bv[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

async function probeDatabase(): Promise<DbStatus> {
  const status: DbStatus = {
    connected: false,
    latency_ms: null,
    schema_version: null,
    schema_required: MIN_SCHEMA_VERSION,
    schema_ok: false,
    missing_tables: [],
    pool: getPoolStats(),
  };

  const started = Date.now();
  // Race the connection against a timeout, but never orphan the client: if
  // the timeout wins the race, pool.connect() may still resolve a moment
  // later, and without this a checked-out client would never be released.
  // Load balancers probe this endpoint every few seconds, so under DB
  // pressure (the only time the timeout trips) that leak would compound into
  // full pool starvation at the worst possible moment.
  const connectPromise = pool.connect();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let client;
  try {
    client = await Promise.race([
      connectPromise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("health probe timed out")),
          CONFIG_DB_HEALTHCHECK_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (err) {
    // Timeout (or connect) lost/failed: make sure a late-arriving client is
    // returned to the pool instead of leaking.
    connectPromise.then((c) => c.release()).catch(() => {});
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }

  try {
    // One round trip: liveness and schema version together.
    const res = await client.query<{ schema_version: string | null }>(
      `SELECT schema_version FROM vulnradar_schema_meta WHERE id = 1`,
    );
    status.connected = true;
    status.latency_ms = Date.now() - started;
    status.schema_version = res.rows[0]?.schema_version ?? null;
    status.schema_ok =
      status.schema_version !== null &&
      compareVersions(status.schema_version, MIN_SCHEMA_VERSION) >= 0;

    // instrumentation.ts's own boot-time CREATE TABLE sequence is built to
    // survive a single statement failing (console.error + continue, see its
    // own comments), so schema_version alone can say "ready" while a table
    // it depends on doesn't actually exist -- e.g. a transient DB hiccup
    // mid-sequence on a fresh `docker compose up`. Catches that gap
    // directly instead of trusting the version number (AUDIT-010,
    // production-readiness #3).
    const tablesRes = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [REQUIRED_TABLES],
    );
    const present = new Set(tablesRes.rows.map((r) => r.table_name));
    status.missing_tables = REQUIRED_TABLES.filter((t) => !present.has(t));
  } finally {
    client.release();
    status.pool = getPoolStats();
  }

  return status;
}

export async function GET() {
  let database: DbStatus;
  try {
    database = await probeDatabase();
  } catch (err) {
    // Log the real reason, return only the fact of failure.
    console.error("[health] database probe failed:", err);
    return NextResponse.json(
      {
        status: "unhealthy",
        version: APP_VERSION,
        uptime_s: Math.round(process.uptime()),
        database: {
          connected: false,
          latency_ms: null,
          schema_version: null,
          schema_required: MIN_SCHEMA_VERSION,
          schema_ok: false,
          missing_tables: [],
          pool: getPoolStats(),
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Reachable but on an older schema (operator needs to run
  // `npm run db:migrate`) or missing a table the schema version claims
  // should exist: either way the process is up but not actually ready, so
  // report degraded rather than pretending to be.
  const healthy =
    database.connected &&
    database.schema_ok &&
    database.missing_tables.length === 0;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      version: APP_VERSION,
      uptime_s: Math.round(process.uptime()),
      database,
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
