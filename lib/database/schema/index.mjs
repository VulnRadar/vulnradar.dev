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
 * Run the whole schema against `executor` (a pg Pool or Client).
 *
 * Identical for every caller: same steps, same order, same guards. The only
 * thing a caller supplies is how to report progress and how to resolve the
 * handful of steps whose DDL is owned by a TypeScript module.
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
    try {
      if (step.guard) {
        const result = await executor.query(step.guard.sql, step.guard.params);
        const row = /** @type {Record<string, unknown>|undefined} */ (
          result.rows[0]
        );
        const actual = row ? Boolean(Object.values(row)[0]) : false;
        if (actual !== (step.guard.runWhen ?? false)) {
          onSkipped?.(step);
          continue;
        }
      }

      let queries = stepQueries(step);
      if (step.moduleSource) {
        if (!runModuleStep) {
          throw new Error(
            `schema step "${step.id}" is owned by ${step.moduleSource} and needs a runModuleStep resolver`,
          );
        }
        queries = (await runModuleStep(step, executor)) || [];
      } else {
        for (const sql of queries) await executor.query(sql);
      }

      if (step.notice) onNotice?.(step.notice);
      onApplied?.(step, queries);
    } catch (error) {
      const mode = step.onError ?? "throw";
      if (mode === "throw") throw error;
      if (mode === "warn") onWarn?.(step, error);
    }
  }
}
