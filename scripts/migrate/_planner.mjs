/**
 * VulnRadar — Migration planner.
 *
 * Loads the version files for a given transition chain and assembles a
 * flat, ordered list of DDL steps to execute. The plan is rendered to
 * the user for approval BEFORE any DDL runs, so destructive drops are
 * obvious.
 *
 * Each plan step has:
 *   { kind: "createTable"|"dropTable"|"addColumn"|"dropColumn"|"createIndex",
 *     sql: string,                    // raw SQL the runner will execute
 *     label: string,                  // human-readable for the preview
 *     destructive: boolean,           // true for drops
 *     dataLoss: { table, column, nonNullRows } | null,
 *     versionStep: { from, to } }     // which transition this came from
 */

import { c, log, info, success, warn } from "../_lib/_lib.output.mjs";
import { pathToFileURL } from "node:url";
import { transitions, findVersionFile, isUpgrade } from "./_registry.mjs";
import { splitStatements } from "../_lib/_lib.schema-parity.mjs";

/**
 * Build a plan from `from` to `to` (or just `from` if same). If
 * `direction` is omitted, it's inferred from the versions.
 *
 * @returns { steps: PlanStep[], transition: { from, to, direction } }
 */
export async function buildPlan(from, to, direction = null) {
  if (from === to) {
    return { steps: [], transitions: [] };
  }

  const inferredDirection =
    direction || (isUpgrade(from, to) ? "upgrade" : "downgrade");
  const stepsChain = transitions(from, to).filter(
    (s) => s.direction === inferredDirection,
  );
  if (stepsChain.length === 0) {
    throw new Error(
      `No ${inferredDirection} transitions registered from ${from} to ${to}.`,
    );
  }

  const allSteps = [];
  for (const step of stepsChain) {
    const file = findVersionFile(step);
    let mod;
    try {
      mod = await import(pathToFileURL(file).href);
    } catch (err) {
      throw new Error(
        `Could not load version file for ${step.from} → ${step.to}: ${err.message}`,
      );
    }
    const planExport =
      step.direction === "upgrade" ? mod.upgrade : mod.downgrade;
    if (!planExport) {
      throw new Error(
        `Version file for ${step.from} → ${step.to} doesn't export a '${inferredDirection}' plan.`,
      );
    }
    const planSteps = expandPlan(planExport, step);
    assertStepOrdering(planSteps, step);
    allSteps.push(...planSteps);
  }

  return { steps: allSteps, transitions: stepsChain };
}

/**
 * Turn a compact plan object ({ addTables, dropTables, ... }) into flat
 * step objects the runner can iterate.
 */
export function expandPlan(plan, step) {
  const steps = [];

  // Tables to add
  for (const t of plan.addTables || []) {
    const sql = t.sql;
    steps.push({
      kind: "createTable",
      sql,
      label: `CREATE TABLE ${t.name || extractTableName(sql)}`,
      destructive: false,
      dataLoss: null,
      versionStep: step,
    });
  }

  // Tables to drop
  for (const t of plan.dropTables || []) {
    const name = typeof t === "string" ? t : t.name;
    const sql = `DROP TABLE IF EXISTS "${name}" CASCADE`;
    steps.push({
      kind: "dropTable",
      sql,
      label: `DROP TABLE ${name}`,
      destructive: true,
      dataLoss: {
        table: name,
        kind: "table",
        nonNullRows: t?.nonNullRows ?? null,
      },
      versionStep: step,
    });
  }

  // Columns to add
  for (const c of plan.addColumns || []) {
    const sql = `ALTER TABLE "${c.table}" ADD COLUMN IF NOT EXISTS ${c.column} ${c.definition || ""}`;
    steps.push({
      kind: "addColumn",
      sql,
      label: `ALTER TABLE ${c.table} ADD COLUMN ${c.column}`,
      destructive: false,
      dataLoss: null,
      versionStep: step,
    });
  }

  // Columns to drop
  for (const c of plan.dropColumns || []) {
    const sql = `ALTER TABLE "${c.table}" DROP COLUMN IF EXISTS "${c.column}"`;
    steps.push({
      kind: "dropColumn",
      sql,
      label: `ALTER TABLE ${c.table} DROP COLUMN ${c.column}`,
      destructive: true,
      dataLoss: {
        table: c.table,
        column: c.column,
        kind: "column",
        nonNullRows: c.nonNullRows ?? null,
      },
      versionStep: step,
    });
  }

  // Indexes to add. `unique: true` emits CREATE UNIQUE INDEX (AUDIT-013
  // migrate-06): without it, two indexes with the same NAME but different
  // uniqueness existed, one here and one in instrumentation.ts, and since
  // IF NOT EXISTS matches on the name alone whichever path ran first
  // silently decided whether the constraint existed at all.
  for (const i of plan.addIndexes || []) {
    const sql = `CREATE ${i.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${i.name} ON "${i.table}"${i.using ? ` USING ${i.using}` : ""}(${i.columns})${i.where ? ` WHERE ${i.where}` : ""}`;
    steps.push({
      kind: "createIndex",
      sql,
      label: `CREATE ${i.unique ? "UNIQUE " : ""}INDEX ${i.name} ON ${i.table}`,
      destructive: false,
      dataLoss: null,
      versionStep: step,
    });
  }

  // Indexes to drop. Not marked destructive: dropping an index never loses
  // data, only query speed, unlike dropTable/dropColumn above. Needed for
  // index-only transitions (see versions/2.0.0-to-3.0.0.mjs's performance
  // indexes) where the downgrade has no table or column to CASCADE the
  // index away with.
  for (const i of plan.dropIndexes || []) {
    const name = typeof i === "string" ? i : i.name;
    const sql = `DROP INDEX IF EXISTS "${name}"`;
    steps.push({
      kind: "dropIndex",
      sql,
      label: `DROP INDEX ${name}`,
      destructive: false,
      dataLoss: null,
      versionStep: step,
    });
  }

  // Data-only steps: a raw SQL statement for a version bump that changes
  // row *values*, not table shape (e.g. backfilling a role, unlike every
  // other kind above which is schema DDL). Introduced for
  // versions/2.0.0-to-3.0.0.mjs's super_admin backfill: there was
  // previously no way to express "run this UPDATE" through the plan
  // format. Not marked
  // destructive by default: a well-written data migration should be
  // conditioned to be idempotent (e.g. guarded by NOT EXISTS), not a blind
  // overwrite. Pass `destructive: true` explicitly if a given step can
  // discard data.
  for (const d of plan.dataUpdates || []) {
    steps.push({
      kind: "dataUpdate",
      sql: d.sql,
      label: d.label,
      destructive: d.destructive ?? false,
      dataLoss: null,
      versionStep: step,
    });
  }

  return steps;
}

function extractTableName(sql) {
  const m = sql.match(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(\w+)/i);
  return m ? m[1] : "?";
}

// ── Ordering guard ──────────────────────────────────────────────────────
//
// expandPlan runs every kind in a fixed order (tables, columns, indexes,
// data), so where a statement sits in a version file says nothing about
// when it executes. gap-migration-upgrade-path-1: 2.0.0-to-3.0.0 put the
// scan_history_teams backfill inside its addTables SQL, where it read
// scan_history.team_id some sixty steps before addColumns created it. The
// runner wraps a plan in one transaction, so that single statement rolled
// back every v1 and v2 upgrade, and nothing caught it because the unit tier
// never executes the SQL. Checking the text here fails the plan before any
// statement runs, on any machine, with or without a database.
//
// Only createTable and createIndex steps are checked: those are the kinds
// whose position the planner decides. dataUpdates run last in the order the
// file lists them, and some of them probe information_schema for a column
// on purpose before a later entry adds it.

const IDENTIFIER = /[a-z_][a-z0-9_]*/g;
const ADD_COLUMN =
  /\badd\s+(?!constraint\b|primary\b|unique\b|foreign\b|check\b|exclude\b)(?:column\s+)?(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/g;

/**
 * Strings blanked, quoted identifiers unquoted, comments dropped, lowercased.
 * What is left is identifiers, keywords and punctuation, which is all the
 * reference check reads. A string literal is never a column reference, and
 * leaving one in would match a column name written in a RAISE message.
 */
function normalizeSql(stmt) {
  return stmt
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/"([^"]+)"/g, "$1")
    .toLowerCase();
}

/** "table.column" for every column an ALTER TABLE ... ADD in this SQL creates. */
function columnsAddedBy(sql) {
  const out = [];
  for (const stmt of splitStatements(sql)) {
    const text = normalizeSql(stmt);
    const alter =
      /^\s*alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([a-z_][a-z0-9_]*)/.exec(
        text,
      );
    if (!alter) continue;
    for (const m of text.matchAll(ADD_COLUMN)) out.push(`${alter[1]}.${m[1]}`);
  }
  return out;
}

/**
 * Every "table.column" one statement may read, erring towards too many.
 *
 * A CREATE TABLE reads another table only through a foreign key, which names
 * the columns it points at; the rest of its body defines columns rather than
 * reading them. A CREATE INDEX reads its own table's columns and predicate.
 * Anything else (an INSERT ... SELECT, an UPDATE, a DO block) is read
 * coarsely: every identifier in it is paired with every table it names, which
 * over-reports, and an over-report here only ever asks for a step to move.
 */
function columnReferences(stmt) {
  const text = normalizeSql(stmt);
  const refs = new Set();
  const pair = (table, body) => {
    for (const id of body.match(IDENTIFIER) ?? []) refs.add(`${table}.${id}`);
  };
  for (const m of text.matchAll(
    /\breferences\s+([a-z_][a-z0-9_]*)\s*\(([^)]*)\)/g,
  )) {
    pair(m[1], m[2]);
  }
  if (/^\s*create\s+(?:unlogged\s+)?table\b/.test(text)) return refs;

  const index =
    /^\s*create\s+(?:unique\s+)?index\b[\s\S]*?\bon\s+(?:only\s+)?([a-z_][a-z0-9_]*)([\s\S]*)$/.exec(
      text,
    );
  if (index) {
    pair(index[1], index[2]);
    return refs;
  }

  for (const m of text.matchAll(
    /\b(?:from|join|update|into|table|on)\s+(?:only\s+)?(?:if\s+(?:not\s+)?exists\s+)?([a-z_][a-z0-9_]*)/g,
  )) {
    pair(m[1], text);
  }
  return refs;
}

/**
 * Every place a createTable or createIndex step reads a column that a LATER
 * step of the same transition adds. A later ADD COLUMN IF NOT EXISTS is the
 * version file saying the column may be missing until then, so an earlier
 * read is a failure on exactly the databases that need the add, even when an
 * earlier CREATE TABLE in the same plan happens to define it.
 *
 * @returns {{ step: { kind: string, label: string }, column: string, addedBy: { kind: string, label: string } }[]}
 */
export function findOrderingViolations(steps) {
  const added = steps.map((s) => columnsAddedBy(s.sql));
  const violations = [];
  steps.forEach((step, at) => {
    if (step.kind !== "createTable" && step.kind !== "createIndex") return;
    const addedLater = new Map();
    for (let j = steps.length - 1; j > at; j--) {
      for (const column of added[j]) addedLater.set(column, steps[j]);
    }
    if (addedLater.size === 0) return;
    const reported = new Set();
    for (const stmt of splitStatements(step.sql)) {
      for (const column of columnReferences(stmt)) {
        const addedBy = addedLater.get(column);
        if (!addedBy || reported.has(column)) continue;
        reported.add(column);
        violations.push({ step, column, addedBy });
      }
    }
  });
  return violations;
}

function assertStepOrdering(steps, transition) {
  const violations = findOrderingViolations(steps);
  if (violations.length === 0) return;
  const lines = violations.map(
    (v) =>
      `  - "${v.step.label}" reads ${v.column}, which "${v.addedBy.label}" only adds later`,
  );
  throw new Error(
    `Version file for ${transition.from} → ${transition.to} reads a column before the step that adds it:\n` +
      `${lines.join("\n")}\n` +
      "Steps run tables, then columns, then indexes, then dataUpdates, whatever order the file lists them in. " +
      "Move the statement that reads the column into dataUpdates.",
  );
}

/**
 * Render a plan to the terminal for user approval. Returns the count of
 * destructive steps so the caller can warn accordingly.
 */
export function renderPlan(plan, meta) {
  if (plan.steps.length === 0) {
    success("No changes needed. Schema is already at the target version.");
    return 0;
  }

  info(
    `Plan: ${plan.transitions.length} transition(s), ${plan.steps.length} step(s).`,
  );
  log("");
  for (let i = 0; i < plan.steps.length; i++) {
    const s = plan.steps[i];
    const tag = s.destructive
      ? `${c.red}DROP${c.reset}`
      : `${c.green}ADD${c.reset}`;
    log(
      `  ${c.bold}${String(i + 1).padStart(2)}.${c.reset}  ${tag}  ${s.label}`,
    );
  }
  log("");

  const destructive = plan.steps.filter((s) => s.destructive);
  if (destructive.length > 0) {
    warn(`${destructive.length} step(s) are destructive.`);
    for (const s of destructive) {
      const dl = s.dataLoss;
      if (dl?.kind === "table") {
        const rows =
          dl.nonNullRows == null
            ? "rows unknown"
            : `${dl.nonNullRows} row(s) will be lost`;
        log(`    ${c.red}!${c.reset}  ${s.label} — ${rows}`);
      } else if (dl?.kind === "column") {
        const rows =
          dl.nonNullRows == null
            ? "non-null values unknown"
            : `${dl.nonNullRows} non-null value(s) will be lost`;
        log(`    ${c.red}!${c.reset}  ${s.label} — ${rows}`);
      }
    }
    log("");
  }

  return destructive.length;
}
