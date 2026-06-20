#!/usr/bin/env node
/**
 * Cross-check every v2 table column between instrumentation.ts and the
 * migration's _snippets.mjs. Exits 0 if all 15 v2 tables match exactly,
 * exits 1 with a drift report otherwise.
 *
 * Run from repo root:  npm run audit:v2-tables
 */
import { readFileSync } from "node:fs";

const ROOT = ".";
const TABLES = [
  "billing_history",
  "access_rules",
  "admin_notifications",
  "admin_user_notes",
  "badges",
  "user_badges",
  "billing_verification_codes",
  "broadcast_messages",
  "broadcast_recipients",
  "discord_connections",
  "gifted_subscriptions",
  "security_alerts",
  "staff_activity",
  "subdomain_cache",
  "system_settings",
];

/**
 * Extract column names from a CREATE TABLE block. Returns null if the
 * table isn't found. Skips constraint keywords, quoted identifiers, and
 * the type-modifier `)` / `,` at the end of column lines.
 */
function extractColumns(text, table) {
  const re = new RegExp(
    `CREATE TABLE IF NOT EXISTS ${table}\\s*\\((.*?)\\)\\s*[;\`]`,
    "is",
  );
  const m = text.match(re);
  if (!m) return null;
  const body = m[1];
  const cols = [];
  for (const rawLine of body.split("\n")) {
    const s = rawLine.trim().replace(/,$/, "");
    if (!s || s.startsWith("--") || s.startsWith("/*")) continue;
    let first = s.split(/\s+/)[0];
    if (
      ["PRIMARY", "FOREIGN", "UNIQUE", "CHECK", "CONSTRAINT", "INDEX"].includes(
        first.toUpperCase(),
      )
    ) {
      continue;
    }
    if (first.startsWith('"') || first.startsWith("`")) continue;
    if (first.endsWith(")") || first.endsWith(",")) {
      first = first.replace(/[),]+$/, "");
    }
    cols.push(first);
  }
  return cols;
}

const inst = readFileSync(`${ROOT}/instrumentation.ts`, "utf8");
const mig = readFileSync(
  `${ROOT}/scripts/migrate/versions/_snippets.mjs`,
  "utf8",
);

let issues = 0;
for (const t of TABLES) {
  const insCols = extractColumns(inst, t);
  const migCols = extractColumns(mig, t);
  console.log(`\n--- ${t} ---`);
  console.log(
    `  instrumentation.ts (${insCols ? insCols.length : 0}): ${insCols}`,
  );
  console.log(
    `  migration          (${migCols ? migCols.length : 0}): ${migCols}`,
  );
  if (insCols === null) {
    console.log("  !! instrumentation.ts: TABLE NOT FOUND");
    issues++;
    continue;
  }
  if (migCols === null) {
    console.log("  !! migration: TABLE NOT FOUND");
    issues++;
    continue;
  }
  const insSet = new Set(insCols.map((c) => c.toLowerCase()));
  const migSet = new Set(migCols.map((c) => c.toLowerCase()));
  const onlyIns = [...insSet].filter((x) => !migSet.has(x)).sort();
  const onlyMig = [...migSet].filter((x) => !insSet.has(x)).sort();
  if (onlyIns.length) {
    console.log(`  !! in instrumentation.ts but NOT in migration: ${onlyIns}`);
    issues++;
  }
  if (onlyMig.length) {
    console.log(`  !! in migration but NOT in instrumentation.ts: ${onlyMig}`);
    issues++;
  }
  if (!onlyIns.length && !onlyMig.length) {
    console.log("  OK: columns match");
  }
}
console.log();
console.log(`Total issues: ${issues}`);
process.exit(issues === 0 ? 0 : 1);
