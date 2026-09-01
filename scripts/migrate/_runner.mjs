/**
 * VulnRadar — Migration runner.
 *
 * Executes a plan (from _planner.mjs) inside a single transaction, with
 * per-step logging. Returns a summary the caller can display.
 *
 * Why a single transaction?
 *   - If any step fails, every prior step is rolled back. Half-migrated
 *     schemas are the worst-case outcome for a database.
 *   - Downgrade operations are dangerous by nature; atomicity gives us a
 *     free "all or nothing" guarantee.
 *
 * Caveat: PostgreSQL DDL is transactional in most cases, but a few
 * operations (CREATE INDEX CONCURRENTLY, etc.) cannot run inside a
 * transaction. We avoid those here.
 */

import { c, log, info, success, warn, error } from "../_lib/_lib.output.mjs";
import { formatDuration } from "../_lib/_lib.meta.mjs";

// Advisory lock id held while sequences are repaired, so two callers
// (a migration finishing and `npm run db:repair-sequences` run by hand)
// cannot interleave a read of MAX(id) with each other's setval.
const SEQUENCE_REPAIR_LOCK_ID = 4_150_921_734;

// Moves every SERIAL/BIGSERIAL sequence in the public schema FORWARD to
// MAX(id) when it has fallen behind. Prevents "duplicate key value
// violates unique constraint" errors when rows were inserted with explicit
// IDs (imports, seeds, a restore) and the sequence counter is stale.
//
// AUDIT-013 migrate-03: this used to run an unconditional
// `setval(seq, MAX(id))` whenever MAX(id) > 0, with no comparison against
// the sequence's current value, unlike the copy in instrumentation.ts.
// That moves a sequence BACKWARDS whenever rows above MAX(id) have been
// deleted, and it runs post-COMMIT while the app is still serving (the
// admin self-updater's last step is `npm run db:migrate`, executed from
// inside the running app with no restart). Two consequences, both real:
//
//   - Race: read MAX(id)=N, a concurrent INSERT consumes nextval N+1 and
//     commits, setval(N) executes, the next INSERT gets N+1 again and
//     fails with a duplicate key violation on a live scan.
//   - Id reuse: scan_history rows are pruned by the retention pass and by
//     account deletion, so rewinding hands out ids that used to belong to
//     someone else's row, which stale sequential-id references then
//     resolve to.
//
// `pg_sequence_last_value(s.oid)` is read alongside the sequence and the
// setval only fires when max_val is strictly greater, matching
// instrumentation.ts's own sequence repair exactly. The function's own
// stated purpose was always the forward case; the backwards move was
// never intended.
export async function repairAllSequences(client) {
  const sql = `
    DO $$
    DECLARE
      r RECORD;
      max_val BIGINT;
    BEGIN
      FOR r IN
        SELECT
          s.relname AS seq_name,
          t.relname AS tbl_name,
          a.attname AS col_name,
          pg_sequence_last_value(s.oid) AS last_val
        FROM pg_class s
        JOIN pg_depend d ON d.objid = s.oid
          AND d.classid = 'pg_class'::regclass
          AND d.refclassid = 'pg_class'::regclass
          AND d.deptype = 'a'
        JOIN pg_class t ON t.oid = d.refobjid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
        WHERE s.relkind = 'S'
          AND t.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      LOOP
        EXECUTE format(
          'SELECT COALESCE(MAX(%I), 0) FROM public.%I',
          r.col_name, r.tbl_name
        ) INTO max_val;
        -- Forward only. Never setval below where the sequence already is.
        IF max_val > 0 AND max_val > COALESCE(r.last_val, 0) THEN
          EXECUTE format('SELECT setval(%L, %s)', r.seq_name, max_val);
        END IF;
      END LOOP;
    END $$;
  `;
  // The advisory lock narrows the read-then-setval window against another
  // repair running at the same time. It does not (and cannot) stop the
  // app's own inserts, which is why the forward-only guard above is the
  // actual fix and this is only belt and braces.
  await client.query("SELECT pg_advisory_lock($1)", [SEQUENCE_REPAIR_LOCK_ID]);
  try {
    await client.query(sql);
  } finally {
    await client
      .query("SELECT pg_advisory_unlock($1)", [SEQUENCE_REPAIR_LOCK_ID])
      .catch(() => {});
  }
}

/**
 * Execute a plan against the given pool.
 *
 * IMPORTANT: dryRun does NOT mean "don't run the SQL". It runs every
 * statement for real, inside a transaction, and rolls that transaction
 * back instead of committing -- that's the only way a dry run can prove
 * the SQL is actually valid against the live schema (syntax errors,
 * missing columns, bad references, etc). Postgres DDL is transactional,
 * so the rollback leaves zero persistent trace. A dry run that only
 * logged step labels without executing anything could never catch a
 * broken statement, which defeats the entire point of running it before
 * a real migration.
 *
 * @param {object} pool
 * @param {object} plan  shape from buildPlan()
 * @param {object} options
 * @param {boolean} [options.dryRun=false]   run every statement for real inside a
 *   transaction, then ROLLBACK instead of COMMIT (no persistent changes)
 * @param {boolean} [options.stopOnError=true]
 * @param {(client: object) => Promise<void>} [options.beforeCommit]
 *   runs as the LAST statement inside the transaction, after every plan
 *   step and before COMMIT. Used to write the schema-version marker in
 *   the same transaction as the DDL it records (AUDIT-013 migrate-05):
 *   previously the marker was a third separate commit, so an interruption
 *   between the DDL COMMIT and that write left a fully migrated database
 *   the app refused to boot on, with a message saying the schema was
 *   older than the app requires.
 * @returns {Promise<{ executed: number, failed: number, totalMs: number }>}
 */
export async function runPlan(pool, plan, options = {}) {
  const { dryRun = false, stopOnError = true, beforeCommit = null } = options;
  const start = Date.now();
  let executed = 0;
  let failed = 0;

  if (plan.steps.length === 0) {
    return { executed: 0, failed: 0, totalMs: 0 };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // AUDIT-013 migrate-13: the whole plan runs as one transaction, and
    // two of its steps take ACCESS EXCLUSIVE on scan_history and hold it
    // for the rest of that transaction. The self-updater runs db:migrate
    // from inside the running app without restarting it, so every request
    // touching those tables queues behind the migration. A lock_timeout
    // makes a blocked acquisition fail fast (and roll the plan back
    // cleanly) instead of stalling every request behind it indefinitely;
    // statement_timeout bounds a single runaway rewrite. Both are LOCAL,
    // so they end with the transaction.
    await client.query("SET LOCAL lock_timeout = '30s'");
    await client.query("SET LOCAL statement_timeout = '10min'");
    info(
      `${dryRun ? "[DRY-RUN] " : ""}Executing ${plan.steps.length} step(s) in a single transaction${dryRun ? " that will be rolled back" : ""}.`,
    );
    log("");

    for (let i = 0; i < plan.steps.length; i++) {
      const s = plan.steps[i];
      const stepStart = Date.now();
      try {
        await client.query(s.sql);
        const ms = Date.now() - stepStart;
        log(
          `  ${c.green}${String(i + 1).padStart(2)}.${c.reset}  ${c.green}OK${c.reset}     ${s.label}  ${c.dim}(${ms}ms)${c.reset}`,
        );
        executed++;
      } catch (err) {
        const ms = Date.now() - stepStart;
        failed++;
        log(
          `  ${c.red}${String(i + 1).padStart(2)}.${c.reset}  ${c.red}FAIL${c.reset}   ${s.label}  ${c.dim}(${ms}ms)${c.reset}`,
        );
        log(`        ${c.red}${err.message}${c.reset}`);
        if (stopOnError) {
          log("");
          await client.query("ROLLBACK");
          error(
            dryRun
              ? "Dry-run rolled back after this error. Nothing was ever committed -- fix the SQL before running for real."
              : "Transaction rolled back. No changes were applied.",
          );
          return { executed, failed, totalMs: Date.now() - start };
        }
      }
    }

    if (dryRun) {
      await client.query("ROLLBACK");
    } else {
      // Schema-version marker, written inside the SAME transaction as the
      // DDL it records. See the beforeCommit doc above.
      if (beforeCommit) await beforeCommit(client);
      await client.query("COMMIT");
      // Move any sequence that fell behind forward to MAX(id), so rows
      // inserted with explicit IDs never cause a duplicate-key error
      // later. AUDIT-009 migration-03: this used to run unguarded, so a
      // failure here propagated past the caller's writeMeta and reported
      // a migration that had already durably committed as a failure. It
      // is a safety net, not part of the migration: warn and carry on.
      try {
        await repairAllSequences(client);
      } catch (seqErr) {
        warn(
          `Sequence repair failed after a successful migration (non-fatal): ${seqErr.message}`,
        );
      }
    }
    log("");
    const totalMs = Date.now() - start;
    if (failed === 0) {
      success(
        `${dryRun ? "Dry-run" : "Migration"} complete: ${executed} step(s) in ${formatDuration(totalMs)}${dryRun ? " (transaction rolled back -- no persistent changes)" : ""}.`,
      );
    } else {
      warn(`${executed} step(s) succeeded, ${failed} failed.`);
    }
    return { executed, failed, totalMs };
  } finally {
    client.release();
  }
}
