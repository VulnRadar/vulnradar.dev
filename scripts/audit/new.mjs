#!/usr/bin/env node
/**
 * Create a new audit.
 *
 * Usage:
 *   node scripts/audit/new.mjs "<title>" [--scope auth,crypto,...] [--notes "<short summary>"]
 *
 * Examples:
 *   node scripts/audit/new.mjs "Auth + session hardening" --scope auth,session,crypto
 *   node scripts/audit/new.mjs "Performance pass" --scope perf
 *
 * Allocates the next sequential AUDIT-NNN id from audits/registry.json,
 * writes audits/AUDIT-NNN/{manifest.json,findings.json,notes.md}, and
 * updates the registry summary. Idempotent on re-run within the same
 * directory (overwrites the empty templates).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import {
  nextAuditId,
  saveManifest,
  syncRegistrySummary,
  manifestPath,
  findingsPath,
  notesPath,
} from "../../lib/audit/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const NOTES_PATH = (id) => path.join(REPO, "audits", id, "notes.md");
const AUDIT_DIR = (id) => path.join(REPO, "audits", id);
const FINDINGS_PATH = (id) => path.join(AUDIT_DIR(id), "findings.json");

const args = process.argv.slice(2);
const title = args[0];
if (!title) {
  console.error(
    'Usage: node scripts/audit/new.mjs "<title>" [--scope ...] [--notes "..."]',
  );
  process.exit(1);
}
let scopeRaw = "misc";
let notes = "";
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--scope") scopeRaw = args[++i] ?? "misc";
  if (args[i] === "--notes") notes = args[++i] ?? "";
}
const scopes = scopeRaw
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const id = await nextAuditId();
const now = new Date().toISOString();

await fs.mkdir(AUDIT_DIR(id), { recursive: true });
await saveManifest({
  id,
  title,
  scopes,
  createdAt: now,
  status: "draft",
  summary: notes || "(no summary yet)",
});
await fs.writeFile(
  NOTES_PATH(id),
  `# ${title}\n\n` +
    `**ID:** ${id}\n` +
    `**Created:** ${now}\n` +
    `**Status:** draft\n` +
    `**Scopes:** ${scopes.join(", ")}\n\n` +
    `## Summary\n\n${notes || "_pending_"}\n\n` +
    `## Findings\n\n_run \`node scripts/audit/add-finding.mjs ${id} ...\` to append findings._\n`,
  "utf8",
);
// Write an empty findings.json so the audit is queryable from day one.
await fs.writeFile(
  FINDINGS_PATH(id),
  JSON.stringify({ auditId: id, findings: [] }, null, 2) + "\n",
  "utf8",
);
await syncRegistrySummary(
  {
    id,
    title,
    scopes,
    createdAt: now,
    status: "draft",
    summary: notes || "(no summary yet)",
  },
  0,
);

console.log(`Created ${id}`);
console.log(`  manifest: audits/${id}/manifest.json`);
console.log(`  notes:    audits/${id}/notes.md`);
console.log(`  findings: audits/${id}/findings.json`);
console.log(
  `Next: node scripts/audit/add-finding.mjs ${id} <finding-id> <severity> <scope> "<title>" "<summary>" "<fix>"`,
);
