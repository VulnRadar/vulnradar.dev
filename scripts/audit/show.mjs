#!/usr/bin/env node
/**
 * Show an audit's manifest + findings.
 *
 * Usage:
 *   node scripts/audit/show.mjs <audit-id> [--json]
 *
 * Prints the manifest then a per-finding table.
 */
import { loadFindings, loadManifest } from "../../lib/audit/index.mjs";

const id = process.argv[2];
if (!id) {
  console.error("Usage: node scripts/audit/show.mjs <audit-id>");
  process.exit(1);
}

const manifest = await loadManifest(id);
const findings = await loadFindings(id);

if (!manifest) {
  console.error(`Audit ${id} not found.`);
  process.exit(1);
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ manifest, findings }, null, 2));
  process.exit(0);
}

console.log(`# ${manifest.id} — ${manifest.title}\n`);
console.log(`- **Status:** ${manifest.status}`);
console.log(`- **Created:** ${manifest.createdAt}`);
if (manifest.closedAt) console.log(`- **Closed:** ${manifest.closedAt}`);
if (manifest.shipCommit)
  console.log(`- **Shipped in:** ${manifest.shipCommit}`);
console.log(`- **Scopes:** ${manifest.scopes.join(", ")}`);
console.log(`- **Findings:** ${findings.length}`);
console.log("");
console.log(`## Summary\n\n${manifest.summary}\n`);

if (findings.length === 0) {
  console.log("## Findings\n\n_none yet_\n");
  process.exit(0);
}

const sevOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const sorted = [...findings].sort(
  (a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9),
);
console.log("## Findings\n");
const pad = (s, n) => String(s).padEnd(n);
console.log(
  [
    pad("ID", 14),
    pad("SEV", 9),
    pad("SCOPE", 12),
    pad("FILES", 6),
    "TITLE",
  ].join(" "),
);
console.log("-".repeat(72));
for (const f of sorted) {
  console.log(
    [
      pad(`${manifest.id}#${f.id}`, 14),
      pad(f.severity, 9),
      pad(f.scope, 12),
      pad(f.files.length, 6),
      f.title,
    ].join(" "),
  );
}
console.log("");
