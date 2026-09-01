import { Client } from "pg";

/**
 * Builds the schema this whole tier runs against, once per run, by executing
 * the REAL boot path: instrumentation.ts's own register().
 *
 * Why register() and not a copy of its SQL
 * ----------------------------------------
 * This tier was written when the schema lived as ~4,400 lines of
 * `pool.query(\`...\`)` inside instrumentation.ts and `npm run db:create`
 * rebuilt it by reading that file as TEXT. That extraction was measurably
 * lossy: of the 280 statements it yielded, six were template literals whose
 * table or constraint name came from a loop variable, so what came out was the
 * literal text `ALTER TABLE ${fk.table}`. A database built that way silently
 * lacked the four ON DELETE SET NULL foreign keys (sessions.impersonated_by,
 * security_alerts.resolved_by, system_settings.updated_by,
 * broadcast_messages.sent_by), the six value-set CHECK constraints and the
 * seven updated_at triggers. Booting register() here is what surfaced that.
 *
 * The schema now lives in lib/database/schema as an ordered array of steps
 * that boot and db:create both execute, so the gap is closed at the source
 * (see schema.test.ts, which asserts the live catalog contains everything that
 * array declares). This bootstrap still runs the REAL register() rather than
 * calling applySchema() directly: a copy of the boot sequence, however thin,
 * is drift waiting to happen, and this way the boot backfills, the advisory
 * lock and the safety nets are exercised too.
 *
 * Two things are neutralised around that call, neither of which is schema:
 * the outbound version-check fetch (this suite runs offline, like the unit
 * suite) and the background workers register() schedules (a 5-minute cleanup
 * timer firing mid-run would delete other suites' fixtures).
 */

/** Proves this database was created by, and is safe to be reset by, this tier. */
const MARKER_TABLE = "vulnradar_integration_fixture";

const SKIP_MESSAGE = `
[integration] INTEGRATION_DATABASE_URL is not set, so every integration suite
[integration] is skipped. This tier executes real SQL and needs a THROWAWAY
[integration] PostgreSQL, because it drops and rebuilds the public schema.
[integration]
[integration]   docker run --rm -d -p 5433:5432 -e POSTGRES_PASSWORD=pw \\
[integration]     -e POSTGRES_DB=vulnradar_test --name vr-test-db postgres:16.4-alpine
[integration]   INTEGRATION_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:5433/vulnradar_test \\
[integration]     npx vitest run --config tests/integration/vitest.config.ts
`.trim();

/**
 * The version check in register() calls the GitHub releases API. The unit
 * suite's standing rule is that no test reaches a real third-party host, and
 * an integration tier is not an exemption from it. Anything that is not the
 * test database is refused; register() already treats a failed version check
 * as non-fatal, so this changes nothing about the schema it builds.
 */
function installOfflineFetch(): () => void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(
      typeof input === "string" || input instanceof URL
        ? input
        : (input as Request).url,
    );
    throw new Error(
      `[integration] blocked an outbound request to ${url}. This tier runs offline.`,
    );
  }) as typeof fetch;
  return () => {
    globalThis.fetch = realFetch;
  };
}

/**
 * register() arms five setInterval workers. They are unref'd so they cannot
 * keep the process alive, but they CAN fire during a long run, in this
 * process, against the test database: periodic cleanup is on a 5-minute
 * cadence and deletes by retention window, which would quietly remove another
 * suite's fixtures mid-assertion. Four expose a stop function; the
 * scheduled-scans worker does not, so it is re-armed at an interval that
 * cannot elapse (its scheduler clears the previous timer first).
 */
async function stopBackgroundWorkers(): Promise<void> {
  const [cleanup, digest, reverify, backup, scheduled] = await Promise.all([
    import("@/lib/database/cleanup"),
    import("@/lib/notifications/posture-digest"),
    import("@/lib/domains/reverify-worker"),
    import("@/lib/backup/scheduled-backup-worker"),
    import("@/lib/scanner/scheduled-scans-worker"),
  ]);
  cleanup.stopPeriodicCleanup();
  digest.stopPeriodicPostureDigest();
  reverify.stopPeriodicDomainReverify();
  backup.stopPeriodicBackup();
  // 2^31 - 1 ms is the largest delay setInterval accepts without wrapping to
  // 1ms, roughly 24 days: the timer exists and is unref'd, and never fires.
  scheduled.schedulePeriodicScheduledScans(2 ** 31 - 1);
}

export async function setup(): Promise<void> {
  const url = process.env.INTEGRATION_DATABASE_URL;
  if (!url) {
    console.info(SKIP_MESSAGE);
    return;
  }

  // Refusing to run against the developer's own database is worth a hard
  // check and not just a warning: the next statements drop the public schema.
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) {
    throw new Error(
      "[integration] INTEGRATION_DATABASE_URL is identical to DATABASE_URL. " +
        "This tier drops and rebuilds the public schema, so it must point at a " +
        "throwaway database, never at the one the app is configured to use.",
    );
  }

  const admin = new Client({
    connectionString: url,
    // Same rule lib/database/db.ts applies: TLS off by default for a local
    // database, and verified (never rejectUnauthorized: false) when asked for.
    ssl:
      process.env.INTEGRATION_DATABASE_SSL === "true"
        ? { rejectUnauthorized: true }
        : false,
  });
  await admin.connect();
  try {
    const existing = await admin.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    );
    const isOurs = existing.rows.some((r) => r.tablename === MARKER_TABLE);
    if (existing.rows.length > 0 && !isOurs) {
      throw new Error(
        `[integration] the target database already has ${existing.rows.length} table(s) in ` +
          `the public schema and none of them is ${MARKER_TABLE}, so this is not a database ` +
          "this tier created. Refusing to drop it. Point INTEGRATION_DATABASE_URL at an empty, " +
          "throwaway database.",
      );
    }

    await admin.query("DROP SCHEMA public CASCADE");
    await admin.query("CREATE SCHEMA public");
    // Written BEFORE the schema is built, so a run that dies partway through
    // still leaves the database recognisably ours and the next run can reset
    // it rather than refusing on a half-built schema.
    await admin.query(
      `CREATE TABLE ${MARKER_TABLE} (
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
    );
    await admin.query(`INSERT INTO ${MARKER_TABLE} DEFAULT VALUES`);
  } finally {
    await admin.end();
  }

  // register() reads these directly. NEXT_RUNTIME is the gate it opens on at
  // all; the other three are what lib/config/env.ts's validateEnv() requires.
  process.env.NEXT_RUNTIME = "nodejs";
  process.env.DATABASE_URL = url;
  process.env.DATABASE_SSL = process.env.INTEGRATION_DATABASE_SSL ?? "false";
  process.env.API_KEY_ENCRYPTION_KEY ??=
    "1111111111111111111111111111111111111111111111111111111111111111";
  process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";

  const restoreFetch = installOfflineFetch();
  try {
    const { register } = await import("@/instrumentation");
    await register();
  } finally {
    restoreFetch();
  }

  await stopBackgroundWorkers();

  // A boot that creates no tables is a boot that failed quietly, and every
  // suite after it would report a confusing "relation does not exist" instead.
  const { default: pool } = await import("@/lib/database/db");
  const { rows } = await pool.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM pg_tables WHERE schemaname = 'public'",
  );
  if (rows[0].n < 40) {
    throw new Error(
      `[integration] the boot path created only ${rows[0].n} tables. Expected the full schema.`,
    );
  }
  console.info(`[integration] schema ready: ${rows[0].n} tables.`);
}

export async function teardown(): Promise<void> {
  // DATABASE_URL rather than INTEGRATION_DATABASE_URL: teardown also runs
  // when setup() threw before it got as far as assigning it, and importing
  // lib/database/db.ts without one throws a second, misleading error on top
  // of the real failure.
  if (!process.env.DATABASE_URL) return;
  // The bootstrap opened a pool in THIS process (register() and the table
  // count above both used it). Without this the run holds connections open
  // after the last suite finishes.
  const { default: pool } = await import("@/lib/database/db");
  await pool.end().catch(() => {});
}
