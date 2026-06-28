#!/usr/bin/env node
/**
 * Update an audit's status / close it / mark shipped.
 *
 * Usage:
 *   node scripts/audit/close.mjs <audit-id> [--status in-progress|closed|shipped] [--commit <sha>] [--summary "<text>"]
 *
 * Without --status, transitions to "closed".
 * Use --commit to record the ship commit (status becomes "shipped").
 */
import {
  loadManifest,
  saveManifest,
  syncRegistrySummary,
  loadFindings,
} from "../../lib/audit/index.mjs";

const id = process.argv[2];
if (!id) {
  console.error(
    'Usage: node scripts/audit/close.mjs <audit-id> [--status in-progress|closed|shipped] [--commit <sha>] [--summary "..."]',
  );
  process.exit(1);
}

let status;
let commit;
let summary;
for (let i = 3; i < process.argv.length; i++) {
  if (process.argv[i] === "--status") status = process.argv[++i];
  if (process.argv[i] === "--commit") commit = process.argv[++i];
  if (process.argv[i] === "--summary") summary = process.argv[++i];
}

const manifest = await loadManifest(id);
if (!manifest) {
  console.error(`Audit ${id} not found.`);
  process.exit(1);
}

const now = new Date().toISOString();
const next = {
  ...manifest,
  status: status ?? (commit ? "shipped" : "closed"),
  closedAt: now,
  summary: summary ?? manifest.summary,
  shipCommit: commit ?? manifest.shipCommit,
};
await saveManifest(next);
const findings = await loadFindings(id);
await syncRegistrySummary(next, findings.length);

console.log(`${id} -> ${next.status}`);
if (next.shipCommit) console.log(`  ship commit: ${next.shipCommit}`);
console.log(`  closed at: ${next.closedAt}`);
