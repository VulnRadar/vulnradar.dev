/**
 * Audit framework — pure ESM JavaScript so both the CLI scripts
 * (`scripts/audit/*.mjs`) and any future server code can import
 * without a TS compilation step.
 *
 * Naming: every audit is identified by `AUDIT-NNN` (zero-padded
 * sequential). The date lives in `manifest.json`, never in the id —
 * so multiple audits per day are fine.
 *
 *   audits/
 *     registry.json           monotonic counter + summary list
 *     AUDIT-001/
 *       manifest.json         id, title, scopes, status, summary
 *       findings.json         list of Finding objects
 *       notes.md              free-form notes
 */

// ── Types (JSDoc only; no compile-time check) ────────────────────────────

/**
 * @typedef {"critical"|"high"|"medium"|"low"|"info"} AuditSeverity
 * @typedef {"draft"|"in-progress"|"closed"|"shipped"} AuditStatus
 * @typedef {"auth"|"session"|"crypto"|"ssrf"|"csrf"|"headers"|"rate-limit"|"db"|"secrets"|"scanner"|"api"|"infra"|"i18n"|"perf"|"a11y"|"deps"|"build"|"ci"|"misc"} AuditScope
 *
 * @typedef {Object} Finding
 * @property {string} id        Short slug scoped to the audit, e.g. "auth-01".
 * @property {AuditSeverity} severity
 * @property {AuditScope} scope
 * @property {string} title     Short, one line, no period.
 * @property {string} summary   One or two sentences.
 * @property {string[]} files
 * @property {string} fix       Free-form.
 * @property {string} [commit]  Ship commit, optional.
 *
 * @typedef {Object} AuditManifest
 * @property {string} id            `AUDIT-NNN`.
 * @property {string} title
 * @property {AuditScope[]} scopes
 * @property {string} createdAt     ISO 8601.
 * @property {string} [closedAt]
 * @property {AuditStatus} status
 * @property {string} summary
 * @property {string} [shipCommit]
 *
 * @typedef {Object} AuditSummary
 * @property {string} id
 * @property {string} title
 * @property {AuditScope[]} scopes
 * @property {string} createdAt
 * @property {string} [closedAt]
 * @property {AuditStatus} status
 * @property {number} findingsCount
 * @property {string} [shipCommit]
 *
 * @typedef {Object} AuditRegistry
 * @property {number} nextId
 * @property {AuditSummary[]} audits
 */

// ── ID helpers ─────────────────────────────────────────────────────────

export function formatAuditId(n) {
  return `AUDIT-${String(n).padStart(3, "0")}`;
}

export function parseAuditId(id) {
  const m = /^AUDIT-(\d+)$/.exec(id);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── Filesystem paths ───────────────────────────────────────────────────

import { promises as fs } from "node:fs";
import path from "node:path";

const REPO = process.cwd();
const AUDITS_DIR = path.join(REPO, "audits");
const REGISTRY_PATH = path.join(AUDITS_DIR, "registry.json");

export function auditDir(id) {
  if (!parseAuditId(id)) throw new Error(`Invalid audit id: ${id}`);
  return path.join(AUDITS_DIR, id);
}
export function manifestPath(id) {
  return path.join(auditDir(id), "manifest.json");
}
export function findingsPath(id) {
  return path.join(auditDir(id), "findings.json");
}
export function notesPath(id) {
  return path.join(auditDir(id), "notes.md");
}

// ── JSON helpers ───────────────────────────────────────────────────────

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// ── Registry ───────────────────────────────────────────────────────────

export async function loadRegistry() {
  const existing = await readJson(REGISTRY_PATH);
  if (existing) return existing;
  return { nextId: 1, audits: [] };
}

export async function saveRegistry(reg) {
  await writeJson(REGISTRY_PATH, reg);
}

export async function nextAuditId() {
  const reg = await loadRegistry();
  const id = formatAuditId(reg.nextId);
  reg.nextId += 1;
  await saveRegistry(reg);
  return id;
}

export async function loadManifest(id) {
  return readJson(manifestPath(id));
}

export async function loadFindings(id) {
  const data = await readJson(findingsPath(id));
  return data?.findings ?? [];
}

export async function appendFinding(id, finding) {
  const existing = await loadFindings(id);
  if (existing.some((f) => f.id === finding.id)) {
    throw new Error(
      `Finding ${finding.id} already exists in ${id}. Pick a new id.`,
    );
  }
  const updated = [...existing, finding];
  await writeJson(findingsPath(id), { auditId: id, findings: updated });
}

export async function saveManifest(manifest) {
  await writeJson(manifestPath(manifest.id), manifest);
}

export async function syncRegistrySummary(manifest, findingsCount) {
  const reg = await loadRegistry();
  const idx = reg.audits.findIndex((a) => a.id === manifest.id);
  const summary = {
    id: manifest.id,
    title: manifest.title,
    scopes: manifest.scopes,
    createdAt: manifest.createdAt,
    closedAt: manifest.closedAt,
    status: manifest.status,
    findingsCount,
    shipCommit: manifest.shipCommit,
  };
  if (idx >= 0) reg.audits[idx] = summary;
  else reg.audits.push(summary);
  await saveRegistry(reg);
}
