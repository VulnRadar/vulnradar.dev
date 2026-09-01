/**
 * Server startup. Next.js calls register() once per Node process, before the
 * first request is served.
 *
 * This file used to be 4,413 lines: the whole schema, every backfill, every
 * worker and every safety net inline in one function. It is now the ORDER
 * those phases run in, and nothing else. Each phase lives in its own module:
 *
 *   lib/database/schema/        the schema itself, as an ordered array of
 *                               steps that `npm run db:create` executes too
 *   lib/database/boot/          the phases below, one file each
 *
 * The split is not cosmetic. While the schema was 4,000 lines of template
 * literals in this file, the only way for another tool to know what the schema
 * was, was to read this file as TEXT and pull those literals out, and that
 * extraction could not resolve six of them (the ones whose table name came
 * from a loop variable). A database built by `npm run db:create` was therefore
 * missing four foreign keys, six CHECK constraints and seven triggers, and
 * said nothing about it. See lib/database/schema/index.mjs.
 *
 * Phase order, and why:
 *
 *   1. env validation          fail fast, with a message naming the missing var
 *   2. error log capture       installed first so it captures phases 3 onward
 *   3. schema version gate     refuses to touch a database that is too old
 *   4. release check           banner, and "is there a newer version"
 *   5. boot advisory lock      one process at a time from here down
 *   6. schema                  every CREATE/ALTER/DROP, in one ordered list
 *   7. backfills               data repair, all of it after the schema exists
 *   8. cleanup + workers       the long-lived timers
 *   9. safety nets             stale scans, required tables, sequences
 *  10. graceful shutdown       close the pool on SIGTERM/SIGINT
 *
 * Phases 6 to 9 are inside the advisory lock and inside one try/catch: a
 * failure anywhere in them alerts and exits rather than serving traffic
 * against a database this process cannot vouch for (AUDIT-010, prodready-07).
 */

export async function register() {
  // `if (...) { everything }` and NOT an early `return`, which is the shape
  // this obviously wants to be. Next.js compiles instrumentation.ts for the
  // EDGE runtime as well as for Node, and in that build webpack's DefinePlugin
  // replaces process.env.NEXT_RUNTIME with the literal "edge". A constant-false
  // `if` makes its whole body dead code, so every `await import()` below is
  // dropped from the edge bundle along with the module graph behind it. An
  // early return leaves those statements reachable in the AST, webpack follows
  // the imports, and the edge build fails on the first Node builtin it reaches
  // (`Can't resolve 'crypto'`, via lib/domains/verification.ts). None of this
  // shows up in `npx tsc --noEmit`; only `npm run build` sees it.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Fail fast on missing required env vars. Previously the process would
    // start with no schema, then 500 on every request. Now startup aborts with
    // a clear error message pointing at the missing var.
    const { validateEnv } = await import("./lib/config/env");
    validateEnv();

    const { default: pool } = await import("./lib/database/db");
    const {
      APP_NAME,
      APP_VERSION,
      MIN_SCHEMA_VERSION,
      ENGINE_VERSION,
      VERSION_CHECK_URL,
      RELEASES_URL,
    } = await import("./lib/config/constants");

    // ── System error log capture (Admin > System > Error Logs) ─────────
    // Wraps console.error exactly once per process so every genuine error logged
    // anywhere in the app (see CLAUDE.md's console.error/console.log convention)
    // also lands in system_error_logs, viewable from the admin panel without
    // shell/SSH access. installErrorLogCapture() is itself idempotent (guards on
    // a module-level flag), so this is also safe on dev hot-reload re-execution.
    // Installed this early so it captures errors from every phase below too;
    // inserts attempted before system_error_logs exists simply fail closed (see
    // lib/database/error-log-capture.ts).
    try {
      const { installErrorLogCapture } =
        await import("./lib/database/error-log-capture");
      installErrorLogCapture();
    } catch (captureErr) {
      console.error(
        `[${APP_NAME}] Failed to install error log capture (non-fatal):`,
        captureErr,
      );
    }

    // ── Schema version gate (BEFORE any table creation) ────────────────
    const { ensureSchemaVersion } =
      await import("./lib/database/boot/schema-version");
    await ensureSchemaVersion(pool, {
      appName: APP_NAME,
      appVersion: APP_VERSION,
      minSchemaVersion: MIN_SCHEMA_VERSION,
    });

    // ── Startup banner + update check ──────────────────────────────────
    const { reportRunningVersion } =
      await import("./lib/database/boot/release-check");
    await reportRunningVersion({
      appName: APP_NAME,
      appVersion: APP_VERSION,
      engineVersion: ENGINE_VERSION,
      versionCheckUrl: VERSION_CHECK_URL,
      releasesUrl: RELEASES_URL,
    });

    if (!process.env.DATABASE_URL) {
      // Throw instead of silently returning. validateEnv() already catches this,
      // but keep a defensive check in case the schema is bypassed in test
      // contexts.
      throw new Error(
        `[${APP_NAME}] DATABASE_URL is not configured. Set it in .env or your deployment environment.`,
      );
    }

    // ── Boot schema advisory lock (AUDIT-013 migrate-11) ───────────────
    const { acquireBootSchemaLock, releaseBootSchemaLock } =
      await import("./lib/database/boot/schema-lock");
    const schemaLock = await acquireBootSchemaLock(pool, APP_NAME);

    try {
      const { applyBootSchema } =
        await import("./lib/database/boot/apply-boot-schema");
      await applyBootSchema(pool, APP_NAME);

      const { runBootBackfills } =
        await import("./lib/database/boot/backfills");
      await runBootBackfills(pool, APP_NAME);

      const { runInitialCleanup, startBackgroundWorkers } =
        await import("./lib/database/boot/workers");
      await runInitialCleanup(APP_NAME);
      await startBackgroundWorkers(APP_NAME);

      const { runBootSafetyNets } =
        await import("./lib/database/boot/safety-nets");
      await runBootSafetyNets(pool, APP_NAME);

      // ── Graceful shutdown ─────────────────────────────────────────
      const gracefulShutdown = async () => {
        try {
          await pool.end();
          console.log(`[${APP_NAME}] Database pool closed on shutdown.`);
        } catch (err) {
          console.error(`[${APP_NAME}] Error closing database pool:`, err);
        }
      };
      process.on("SIGTERM", gracefulShutdown);
      process.on("SIGINT", gracefulShutdown);
    } catch (error) {
      // A failure partway through the schema used to just log and fall through,
      // leaving the app to boot and serve traffic against a database that might
      // be missing a table or column a later statement would have created. Match
      // the schema version gate above: alert, then refuse to serve traffic on a
      // database this process cannot vouch for (AUDIT-010, prodready-07).
      console.error(
        `[${APP_NAME}] Database schema creation/migration failed:`,
        error,
      );
      const { sendAdminAlert } = await import("./lib/admin/alert-webhook");
      await sendAdminAlert({
        event: "boot_schema_creation_failed",
        severity: "critical",
        message: `${APP_NAME} failed to start: schema creation/migration errored partway through. The database may be left partially initialized. Run npm run db:migrate, or npm run db:diagnose to inspect the current state.`,
      });
      process.exit(1);
    } finally {
      await releaseBootSchemaLock(schemaLock);
    }
  }
}
