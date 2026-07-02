/**
 * Detection registry.
 *
 * Each detection category lives in its own file under ./checks/<category>.ts
 * (the detection function) and ./checks-data/<category>.json (the human-
 * readable metadata: title, description, fix steps, examples). This file
 * aggregates them into a single ordered list and exposes the standard
 * "filter by category" helper used by the scan orchestrator.
 *
 * Why split? With 1000+ checks on the roadmap a single Record<string,Fn>
 * becomes unreadable and unmergeable in source control. Per-category
 * files also make it cheap to run `eslint --fix` or unit-test just one
 * slice of the engine.
 */

import type { Category, Severity, Vulnerability } from "./types";
import { generateId, type EvidenceFn } from "./_helpers";

// ── Category metadata files (one JSON per Category) ─────────────────────────
// Static imports so Next can bundle them at build time. Each file exports
// an array of CheckDef entries.

import headersDefs from "./checks-data/headers.json";
import sslDefs from "./checks-data/ssl.json";
import tlsDefs from "./checks-data/tls.json";
import contentDefs from "./checks-data/content.json";
import cookiesDefs from "./checks-data/cookies.json";
import configurationDefs from "./checks-data/configuration.json";
import informationDisclosureDefs from "./checks-data/information-disclosure.json";
import dnsDefs from "./checks-data/dns.json";
import emailDefs from "./checks-data/email.json";
import apiDefs from "./checks-data/api.json";
import codeDefs from "./checks-data/code.json";
import secretsExtendedDefs from "./checks-data/secrets-extended.json";

// ── Per-category detector modules ──────────────────────────────────────────
// Each module exports a `detectors` Record<id, EvidenceFn> — detectors
// that return either null (no finding) or an evidence string. The registry
// wraps them with metadata to produce a full Vulnerability.

import { detectors as headerDetectors } from "./checks/headers";
import { detectors as sslDetectors } from "./checks/ssl";
import { detectors as contentDetectors } from "./checks/content";
import { detectors as cookiesDetectors } from "./checks/cookies";
import { detectors as configurationDetectors } from "./checks/configuration";
import { detectors as informationDisclosureDetectors } from "./checks/information-disclosure";
import { detectors as codeDetectors } from "./checks/code";
import { detectors as apiDetectors } from "./checks/api";
import { detectors as secretsExtendedDetectors } from "./checks/secrets-extended";

// `tls`, `dns`, `email` checks live in their own async modules because they
// need DNS/TLS sockets. Those modules export `run*Checks` entrypoints, not
// per-id functions. They are not imported here — the scan orchestrator
// invokes them directly.

// ── CheckFn shape ──────────────────────────────────────────────────────────
//
// CheckFn takes (url, headers, body) and returns a fully-formed Vulnerability
// (id, title, severity, evidence, fix steps) when the detector matched, or
// null otherwise. Most of the work happens in `buildCheck` below.

export type CheckFn = (
  url: string,
  headers: Headers,
  body: string,
) => Vulnerability | null;

// ── CheckDef schema (matches the JSON files) ───────────────────────────────

export interface CheckDef {
  id: string;
  type: string;
  title: string;
  category: Category;
  severity: Severity | string;
  description: string;
  evidence: string;
  riskImpact: string;
  explanation: string;
  fixSteps: string[];
  codeExamples: { label: string; language: string; code: string }[];
  references?: string[];
}

// ── Assemble the master list ───────────────────────────────────────────────

interface CategoryBundle {
  category: Category;
  defs: CheckDef[];
  detectors: Record<string, EvidenceFn>;
}

// Defs + detector pairs in display order. `tls`, `dns`, `email` only
// contribute defs (no per-id detector) because they are dispatched from
// async modules instead.
const BUNDLES: CategoryBundle[] = [
  {
    category: "headers",
    defs: headersDefs as CheckDef[],
    detectors: headerDetectors,
  },
  { category: "ssl", defs: sslDefs as CheckDef[], detectors: sslDetectors },
  {
    category: "tls",
    defs: tlsDefs as CheckDef[],
    detectors: {},
  },
  {
    category: "content",
    defs: contentDefs as CheckDef[],
    detectors: contentDetectors,
  },
  {
    category: "cookies",
    defs: cookiesDefs as CheckDef[],
    detectors: cookiesDetectors,
  },
  {
    category: "configuration",
    defs: configurationDefs as CheckDef[],
    detectors: configurationDetectors,
  },
  {
    category: "information-disclosure",
    defs: informationDisclosureDefs as CheckDef[],
    detectors: informationDisclosureDetectors,
  },
  { category: "dns", defs: dnsDefs as CheckDef[], detectors: {} },
  { category: "email", defs: emailDefs as CheckDef[], detectors: {} },
  { category: "api", defs: apiDefs as CheckDef[], detectors: apiDetectors },
  { category: "code", defs: codeDefs as CheckDef[], detectors: codeDetectors },
  {
    category: "secrets-extended",
    defs: secretsExtendedDefs as CheckDef[],
    detectors: secretsExtendedDetectors,
  },
];

// Flattened def list (defs only; detectors attached at build time).
export const allCheckDefs: CheckDef[] = BUNDLES.flatMap((b) => b.defs);

// Build a {id → detect} map for the registry and a {id → def} map for
// metadata lookups. Detectors that exist in JSON but lack an inline
// detector are still kept in `allCheckDefs` so /finding-types surfaces
// them — the scan orchestrator handles them via async dispatch.
const detectorMap: Record<string, EvidenceFn> = {};
for (const bundle of BUNDLES) {
  for (const [id, fn] of Object.entries(bundle.detectors)) {
    detectorMap[id] = fn as EvidenceFn;
  }
}

const defById: Record<string, CheckDef> = {};
for (const def of allCheckDefs) {
  defById[def.id] = def;
}

// ── Build executable CheckFn list (def + detector) ─────────────────────────

/**
 * Per-type confidence levels (0–100):
 *   header-missing / header-present — the header is either there or not: 100%
 *   header / header-value           — reliable value parsing: 97%
 *   combined                        — two or more conditions: 92%
 *   body-pattern / url-check        — regex; may over-fire on some pages: 82%
 *   stub / unknown                  — should not exist in production: 60%
 */
function confidenceForType(type: string): number {
  switch (type) {
    case "header-missing":
    case "header-present":
      return 100;
    case "header":
    case "header-value":
      return 97;
    case "combined":
      return 92;
    case "body-pattern":
    case "url-check":
      return 82;
    default:
      return 60;
  }
}

function buildCheck(def: CheckDef): CheckFn | null {
  const detect = detectorMap[def.id];
  if (!detect) return null;
  const confidence = confidenceForType(def.type);
  return (url, headers, body): Vulnerability | null => {
    const evidence = detect(url, headers, body);
    if (!evidence) return null;
    return {
      id: generateId(def.id, url),
      title: def.title,
      severity: (def.severity as string).toLowerCase() as Severity,
      category: def.category,
      description: def.description,
      evidence,
      riskImpact: def.riskImpact,
      explanation: def.explanation,
      fixSteps: def.fixSteps,
      codeExamples: def.codeExamples,
      references: def.references,
      confidence,
    };
  };
}

// All synchronous checks (def + detector present). The async modules
// (tls/dns/email) are dispatched from the scan orchestrator directly.
export const allChecks: CheckFn[] = allCheckDefs
  .map(buildCheck)
  .filter((fn): fn is CheckFn => fn !== null);

// ── Per-category helpers ────────────────────────────────────────────────────

const checksByCategoryCache = new Map<string, CheckFn[]>();

export function getChecksByCategory(categories: Category[]): CheckFn[] {
  if (!categories || categories.length === 0) return allChecks;
  const cacheKey = [...categories].sort().join(",");
  const cached = checksByCategoryCache.get(cacheKey);
  if (cached) return cached;
  const allowed = new Set<Category>(categories);
  const result = allCheckDefs
    .filter((d) => allowed.has(d.category))
    .map(buildCheck)
    .filter((fn): fn is CheckFn => fn !== null);
  checksByCategoryCache.set(cacheKey, result);
  return result;
}

export function getDefsByCategory(categories?: Category[] | null): CheckDef[] {
  if (!categories || categories.length === 0) return allCheckDefs;
  const allowed = new Set<Category>(categories);
  return allCheckDefs.filter((d) => allowed.has(d.category));
}

export function getCategoryCounts(): Record<Category, number> {
  const out = {} as Record<Category, number>;
  for (const cat of BUNDLES.map((b) => b.category)) out[cat] = 0;
  for (const def of allCheckDefs) {
    out[def.category] = (out[def.category] || 0) + 1;
  }
  return out;
}

export function getCheckDef(id: string): CheckDef | undefined {
  return defById[id];
}
