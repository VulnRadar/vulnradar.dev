#!/usr/bin/env node
/**
 * Append a finding to an existing audit.
 *
 * Usage:
 *   node scripts/audit/add-finding.mjs <audit-id> <finding-id> <severity> <scope> "<title>" "<summary>" "[<fix>]" "[<files...>]"
 *
 * Examples:
 *   node scripts/audit/add-finding.mjs AUDIT-001 auth-01 critical ssrf \
 *     "safeFetch follow redirect without re-validation" \
 *     "Cloud-metadata exfil via 302 to 169.254.169.254" \
 *     "Manual redirect loop with per-hop validateScanTarget" \
 *     "lib/scanner/safe-fetch.ts
 *
 * Finding IDs are scoped to the audit (e.g. `auth-01`, `crypto-02`).
 * Must be unique within the audit. The audit's findings.json is
 * rewritten atomically with the new finding appended.
 */
import path from "node:path";
import { appendFinding } from "../../lib/audit/index.mjs";

const [
  ,
  ,
  auditId,
  findingId,
  severity,
  scope,
  title,
  summary,
  fix = "",
  ...files
] = process.argv;

if (!auditId || !findingId || !severity || !scope || !title || !summary) {
  console.error(
    'Usage: node scripts/audit/add-finding.mjs <audit-id> <finding-id> <severity> <scope> "<title>" "<summary>" "[<fix>]" "[<files...>]"',
  );
  process.exit(1);
}
const validSeverity = ["critical", "high", "medium", "low", "info"];
if (!validSeverity.includes(severity)) {
  console.error(`Severity must be one of: ${validSeverity.join(", ")}`);
  process.exit(1);
}

const fileList = files
  .join(" ")
  .split(/\s+/)
  .map((f) => f.trim())
  .filter(Boolean);

await appendFinding(auditId, {
  id: findingId,
  severity,
  scope,
  title,
  summary,
  files: fileList,
  fix,
});

console.log(`Added ${auditId}#${findingId} (${severity}/${scope})`);
console.log(`  ${title}`);
