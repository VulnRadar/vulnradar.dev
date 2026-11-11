/**
 * VulnRadar - the boot schema, as data.
 *
 * Why this module exists
 * ----------------------
 * The schema used to live as ~4,400 lines of `await pool.query(`...`)` inside
 * instrumentation.ts, and `npm run db:create` reconstructed it by reading that
 * TypeScript file as TEXT and pulling the template literals back out
 * (scripts/_lib/_lib.schema-parity.mjs). Text extraction cannot resolve a
 * template literal whose name comes from a loop variable, so six statements
 * came out as the literal string `ALTER TABLE ${fk.table} ...` and were
 * dropped on the floor without a word. What a db:create'd database was
 * therefore missing, silently:
 *
 *   - the four ON DELETE SET NULL foreign keys (sessions.impersonated_by,
 *     security_alerts.resolved_by, system_settings.updated_by,
 *     broadcast_messages.sent_by), so deleting a user those rows reference
 *     failed the whole erasure transaction
 *   - all six value-set CHECK constraints (users.role, users.plan,
 *     gifted_subscriptions.plan, team_members.role, team_invites.role,
 *     domains.status)
 *   - the vulnradar_set_updated_at() function and all seven updated_at
 *     triggers, so users.updated_at was simply wrong on a db:create'd database
 *   - the 28 redundant-index drops
 *
 * A second gap had the same shape: DDL owned by a helper module
 * (ensureStaffInvitesTable and friends) was appended AFTER everything else, so
 * `CREATE INDEX ... ON staff_invites` ran before `CREATE TABLE staff_invites`
 * and db:create logged a warning and moved on, leaving the index absent.
 *
 * So the schema is no longer text to be parsed. It is an ordered array of
 * steps that both consumers EXECUTE:
 *
 *   - instrumentation.ts's register()          (every deployment, on boot)
 *   - scripts/create-fresh-db/create-fresh-db.mjs   (npm run db:create)
 *   - tests/integration/_global-setup.ts       (via register())
 *
 * and that scripts/_lib/_lib.schema-parity.mjs flattens into SQL for the
 * boot-vs-migration parity guard. One array, one order, no second copy.
 *
 * Order is the load-bearing property here. Steps run exactly in the order
 * SCHEMA_STEPS lists them, and several of them depend on it (an index on a
 * table declared further down, a CHECK on a column added by an earlier ALTER).
 * The numbered files below are concatenated in filename order and nothing
 * reorders them.
 *
 * This file is .mjs rather than .ts on purpose: `npm run db:create` is a plain
 * Node script and has to import the same module the Next.js server imports,
 * with no build step in between. A generated or hand-copied second form is the
 * exact failure this module exists to remove.
 */

import { coreSchemaSteps } from "./01-core.mjs";
import { featureSchemaSteps } from "./02-features.mjs";
import { integrationSchemaSteps } from "./03-integrations.mjs";
import { constraintSchemaSteps } from "./04-constraints.mjs";
import { INDEX_STATE_SQL, stepProbe } from "./applied-probe.mjs";

/**
 * @typedef {object} SchemaGuard
 * @property {string} sql SQL returning a single row whose first column is a
 *   boolean, e.g. `SELECT EXISTS (...) AS exists`.
 * @property {unknown[]} [params]
 * @property {boolean} [runWhen] Run the step only when the guard's boolean
 *   equals this. Defaults to false ("run it when the thing is NOT there yet").
 */

/**
 * @typedef {object} SchemaStep
 * @property {string} id Stable, unique, human-readable. Used in log lines and
 *   in the tests, never written to the database.
 * @property {string|string[]} [sql] One or more query texts. A single string
 *   may contain several statements; it is sent as ONE query, which PostgreSQL
 *   runs in one implicit transaction. That grouping is deliberate wherever it
 *   appears (a CREATE TABLE and its indexes succeed or fail together), so do
 *   not split a step's SQL up without meaning to.
 * @property {string} [moduleSource] Repo-relative path of a TypeScript module
 *   that owns this DDL and exports an idempotent ensure*() helper. The runner
 *   cannot import TypeScript, so the caller resolves these: see runModuleStep.
 * @property {SchemaGuard} [guard]
 * @property {"throw"|"warn"|"ignore"} [onError] Defaults to "throw", which
 *   aborts the boot (register() alerts and exits rather than serving traffic
 *   against a half-built database). "warn" reports and continues. "ignore" is
 *   for the two generated-column ALTERs whose only realistic failure is
 *   "already exists" on an older PostgreSQL.
 * @property {string} [warning] Message for the "warn" mode, without a prefix
 *   or a trailing "(non-fatal):" - the caller adds both.
 * @property {string} [notice] Logged once when the step actually ran (i.e. its
 *   guard let it through). Used by the self-healing foreign-key steps.
 * @property {string} [concurrentIndex] The index a CREATE INDEX CONCURRENTLY
 *   step builds. Its `sql` is that one statement; the runner skips it while
 *   the index is valid and drops an invalid leftover first.
 *
 * A step with neither a guard nor concurrentIndex is probed: ./applied-probe.mjs
 * derives a catalog query that says, without locking anything, whether its
 * DDL is already in place.
 */

/**
 * The bookkeeping table the schema-version check and the migrator share. It is
 * step zero because every other path (the boot version check before the
 * advisory lock, `npm run db:create`'s meta row) needs it to exist first, and
 * because it used to be written out by hand in three places.
 */
export const META_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS vulnradar_schema_meta (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    schema_version VARCHAR(20) NOT NULL,
    app_version     VARCHAR(20) NOT NULL,
    applied_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

/** @type {SchemaStep[]} */
export const SCHEMA_STEPS = Object.freeze([
  { id: "schema-meta", sql: META_TABLE_SQL },
  ...coreSchemaSteps,
  ...featureSchemaSteps,
  ...integrationSchemaSteps,
  ...constraintSchemaSteps,
]);

/** Every query text a step executes, as an array (a step may declare one). */
export function stepQueries(step) {
  if (!step.sql) return [];
  return Array.isArray(step.sql) ? step.sql : [step.sql];
}

/**
 * SQLSTATE 55P03, lock_not_available: what a statement raises when it waited
 * out lock_timeout. The boot path sets one (lib/database/boot/
 * apply-boot-schema.ts) so a long transaction elsewhere cannot hold the boot,
 * and every query queued behind the boot's lock request, indefinitely.
 */
export const LOCK_TIMEOUT_CODE = "55P03";

/**
 * How many times a step that timed out on a lock is tried before its onError
 * applies. Each try waits at most lock_timeout, so this bounds what one step
 * can add to a boot.
 */
export const LOCK_TIMEOUT_ATTEMPTS = 3;

function isLockTimeout(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    /** @type {{ code?: unknown }} */ (error).code === LOCK_TIMEOUT_CODE
  );
}

/** The guard's verdict: true when the step should run. */
async function guardSaysRun(executor, guard) {
  const result = await executor.query(guard.sql, guard.params);
  const row = /** @type {Record<string, unknown>|undefined} */ (result.rows[0]);
  const actual = row ? Boolean(Object.values(row)[0]) : false;
  return actual === (guard.runWhen ?? false);
}

/** 'valid', 'invalid' or null (no such index). */
async function indexState(executor, name) {
  const result = await executor.query(INDEX_STATE_SQL, [name]);
  const row = /** @type {{ state?: unknown }|undefined} */ (result.rows[0]);
  return row?.state === "valid" || row?.state === "invalid" ? row.state : null;
}

async function probeSaysApplied(executor, probe) {
  const result = await executor.query(probe.sql);
  const row = /** @type {{ applied?: unknown }|undefined} */ (result.rows[0]);
  return row?.applied === true;
}

/**
 * Whether the catalog already shows this step's effect. Asked after a lock
 * timeout: a step whose effect is in place (another booting process applied
 * it while this one waited, or all that was left was a backfill the next boot
 * reruns) is skipped rather than failed.
 *
 * @param {{query: (text: string, values?: unknown[]) => Promise<{rows: unknown[]}>}} executor
 * @param {SchemaStep} step
 */
export async function isStepApplied(executor, step) {
  if (step.guard) return !(await guardSaysRun(executor, step.guard));
  if (step.concurrentIndex) {
    return (await indexState(executor, step.concurrentIndex)) === "valid";
  }
  const probe = stepProbe(step);
  return probe ? probeSaysApplied(executor, probe) : false;
}

/**
 * One CREATE INDEX CONCURRENTLY step.
 *
 * CONCURRENTLY takes a SHARE UPDATE EXCLUSIVE lock, which writes do not wait
 * on, so building a new index on a large scan_history no longer blocks the
 * live app for the length of the build. The price is that it cannot run in a
 * transaction block (each query here is its own) and that an interrupted
 * build leaves an INVALID index behind under the same name, which IF NOT
 * EXISTS then treats as present for good: the planner never uses it and
 * every write still maintains it. So an invalid leftover is dropped, also
 * concurrently, and built again.
 *
 * @returns {Promise<string[]|null>} the queries run, or null when the index
 *   was already valid
 */
async function runConcurrentIndex(executor, step) {
  const state = await indexState(executor, step.concurrentIndex);
  if (state === "valid") return null;
  const queries = [];
  if (state === "invalid") {
    queries.push(`DROP INDEX CONCURRENTLY IF EXISTS ${step.concurrentIndex}`);
  }
  queries.push(...stepQueries(step));
  for (const sql of queries) await executor.query(sql);
  return queries;
}

/** Run one step. Returns the queries it ran, or null when it was skipped. */
async function runStep(executor, step, runModuleStep) {
  if (step.guard && !(await guardSaysRun(executor, step.guard))) return null;

  if (step.concurrentIndex) return runConcurrentIndex(executor, step);

  // A step whose DDL is already in place takes no lock on its tables: only
  // its row-level backfills, if it has any, still run.
  const probe = stepProbe(step);
  if (probe && (await probeSaysApplied(executor, probe))) {
    if (probe.rest.length === 0) return null;
    for (const sql of probe.rest) await executor.query(sql);
    return probe.rest;
  }

  if (step.moduleSource) {
    if (!runModuleStep) {
      throw new Error(
        `schema step "${step.id}" is owned by ${step.moduleSource} and needs a runModuleStep resolver`,
      );
    }
    return (await runModuleStep(step, executor)) || [];
  }

  const queries = stepQueries(step);
  for (const sql of queries) await executor.query(sql);
  return queries;
}

/**
 * Run the whole schema against `executor` (a pg Pool or Client).
 *
 * Identical for every caller: same steps, same order, same guards. The only
 * thing a caller supplies is how to report progress and how to resolve the
 * handful of steps whose DDL is owned by a TypeScript module.
 *
 * A step that fails on lock_timeout (only the boot path sets one) is tried up
 * to LOCK_TIMEOUT_ATTEMPTS times, and skipped as soon as the catalog shows its
 * effect is in place; only after that does its onError apply.
 *
 * @param {{query: (text: string, values?: unknown[]) => Promise<{rows: unknown[]}>}} executor
 * @param {object} [options]
 * @param {(step: SchemaStep, queries: string[]) => void} [options.onApplied]
 * @param {(step: SchemaStep) => void} [options.onSkipped]
 * @param {(message: string) => void} [options.onNotice]
 * @param {(step: SchemaStep, error: unknown) => void} [options.onWarn]
 * @param {(step: SchemaStep, executor: unknown) => Promise<string[]|void>} [options.runModuleStep]
 */
export async function applySchema(executor, options = {}) {
  const { onApplied, onSkipped, onNotice, onWarn, runModuleStep } = options;

  for (const step of SCHEMA_STEPS) {
    for (let attempt = 1; ; attempt++) {
      try {
        const queries = await runStep(executor, step, runModuleStep);
        if (queries === null) {
          onSkipped?.(step);
        } else {
          if (step.notice) onNotice?.(step.notice);
          onApplied?.(step, queries);
        }
        break;
      } catch (error) {
        if (isLockTimeout(error)) {
          const applied = await isStepApplied(executor, step).catch(
            () => false,
          );
          if (applied) {
            onNotice?.(
              `Schema step ${step.id} timed out waiting for a lock and is already applied; skipped.`,
            );
            onSkipped?.(step);
            break;
          }
          if (attempt < LOCK_TIMEOUT_ATTEMPTS) continue;
        }
        const mode = step.onError ?? "throw";
        if (mode === "throw") throw error;
        if (mode === "warn") onWarn?.(step, error);
        break;
      }
    }
  }
}
