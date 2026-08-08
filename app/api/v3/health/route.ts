import { NextResponse } from "next/server";
import pool, { getPoolStats } from "@/lib/database/db";
import { APP_VERSION, MIN_SCHEMA_VERSION } from "@/lib/config/constants";
import { CONFIG_DB_HEALTHCHECK_TIMEOUT_MS } from "@/lib/config/config-values";

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
    pool: getPoolStats(),
  };

  const started = Date.now();
  const client = await Promise.race([
    pool.connect(),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("health probe timed out")),
        CONFIG_DB_HEALTHCHECK_TIMEOUT_MS,
      ),
    ),
  ]);

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
          pool: getPoolStats(),
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Reachable but on an older schema: the process is up and the operator
  // needs to run `npm run db:migrate`, so report degraded rather than
  // pretending to be ready.
  const healthy = database.connected && database.schema_ok;

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
