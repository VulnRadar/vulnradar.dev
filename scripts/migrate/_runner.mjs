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

/**
 * Execute a plan against the given pool.
 *
 * @param {object} pool
 * @param {object} plan  shape from buildPlan()
 * @param {object} options
 * @param {boolean} [options.dryRun=false]   log steps but don't execute
 * @param {boolean} [options.stopOnError=true]
 * @returns {Promise<{ executed: number, failed: number, totalMs: number }>}
 */
export async function runPlan(pool, plan, options = {}) {
  const { dryRun = false, stopOnError = true } = options;
  const start = Date.now();
  let executed = 0;
  let failed = 0;

  if (plan.steps.length === 0) {
    return { executed: 0, failed: 0, totalMs: 0 };
  }

  const client = await pool.connect();
  try {
    if (!dryRun) await client.query("BEGIN");
    info(
      `${dryRun ? "[DRY-RUN] " : ""}Executing ${plan.steps.length} step(s) in a single transaction.`,
    );
    log("");

    for (let i = 0; i < plan.steps.length; i++) {
      const s = plan.steps[i];
      const stepStart = Date.now();
      try {
        if (dryRun) {
          log(
            `  ${c.dim}${String(i + 1).padStart(2)}.${c.reset}  ${c.dim}[skip]${c.reset}  ${s.label}`,
          );
        } else {
          await client.query(s.sql);
          const ms = Date.now() - stepStart;
          log(
            `  ${c.green}${String(i + 1).padStart(2)}.${c.reset}  ${c.green}OK${c.reset}     ${s.label}  ${c.dim}(${ms}ms)${c.reset}`,
          );
        }
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
          if (!dryRun) {
            await client.query("ROLLBACK");
            error("Transaction rolled back. No changes were applied.");
          }
          return { executed, failed, totalMs: Date.now() - start };
        }
      }
    }

    if (dryRun) {
      await client.query("ROLLBACK");
    } else {
      await client.query("COMMIT");
    }
    log("");
    const totalMs = Date.now() - start;
    if (failed === 0) {
      success(
        `${dryRun ? "Dry-run" : "Migration"} complete: ${executed} step(s) in ${formatDuration(totalMs)}.`,
      );
    } else {
      warn(`${executed} step(s) succeeded, ${failed} failed.`);
    }
    return { executed, failed, totalMs };
  } finally {
    client.release();
  }
}
