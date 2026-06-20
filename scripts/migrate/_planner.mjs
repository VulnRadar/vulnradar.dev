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

import { c, log, info, success, warn, error } from "../_lib/_lib.output.mjs";
import { pathToFileURL } from "node:url";
import { transitions, findVersionFile, isUpgrade } from "./_registry.mjs";

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
    allSteps.push(...planSteps);
  }

  return { steps: allSteps, transitions: stepsChain };
}

/**
 * Turn a compact plan object ({ addTables, dropTables, ... }) into flat
 * step objects the runner can iterate.
 */
function expandPlan(plan, step) {
  const steps = [];
  const dataLossItems = plan.dataLoss || [];

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

  // Indexes to add
  for (const i of plan.addIndexes || []) {
    const sql = `CREATE INDEX IF NOT EXISTS ${i.name} ON "${i.table}"${i.using ? ` USING ${i.using}` : ""}(${i.columns})${i.where ? ` WHERE ${i.where}` : ""}`;
    steps.push({
      kind: "createIndex",
      sql,
      label: `CREATE INDEX ${i.name} ON ${i.table}`,
      destructive: false,
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
