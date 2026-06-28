#!/usr/bin/env node
/**
 * List all audits.
 *
 * Usage:
 *   node scripts/audit/list.mjs [--json]
 */
import { loadRegistry } from "../../lib/audit/index.mjs";

const reg = await loadRegistry();
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(reg, null, 2));
  process.exit(0);
}
if (reg.audits.length === 0) {
  console.log('No audits yet. Run: node scripts/audit/new.mjs "<title>"');
  process.exit(0);
}
const pad = (s, n) => String(s).padEnd(n);
console.log(
  [
    pad("ID", 10),
    pad("STATUS", 11),
    pad("SCOPES", 24),
    pad("FINDINGS", 9),
    pad("CREATED", 21),
    "TITLE",
  ].join(" "),
);
console.log("-".repeat(96));
for (const a of reg.audits) {
  console.log(
    [
      pad(a.id, 10),
      pad(a.status, 11),
      pad(a.scopes.join(","), 24),
      pad(a.findingsCount, 9),
      pad(a.createdAt.slice(0, 19), 21),
      a.title,
    ].join(" "),
  );
}
console.log("");
console.log(`Next ID: AUDIT-${String(reg.nextId).padStart(3, "0")}`);
