/**
 * Live dependency-vulnerability check via OSV.dev.
 *
 * Reads a library and exact version out of each script tag's URL (the shared
 * fingerprints in library-fingerprints.ts; passive, never executes anything)
 * and asks OSV.dev which published advisories affect that version, so the
 * answer reflects whatever OSV currently knows rather than a frozen snapshot.
 * checks/page-checks/libraries.ts answers the same question offline from a
 * small built-in list; both set the same `component` and share a dedupe
 * group, and this check's finding is the one kept.
 *
 * One finding per library and version, listing every advisory. It used to be
 * one finding per advisory, capped at five, so an old jQuery arrived as five
 * findings with the same fix, and the sixth advisory onward was dropped
 * without a word. The fix for all of them is one upgrade, which the finding
 * now names when OSV records a fixed release for every advisory it lists.
 *
 * Passive, not an active probe: this only ever reads the page once (a
 * request that already happens as part of a normal scan) and queries a
 * third-party advisory database, never the scanned target itself. Runs by
 * default under the "supply-chain" category, unlike lib/scanner/active-probes/.
 *
 * Fail-open by construction, matching every other external-service check in
 * this codebase: a page fetch failure, an unparseable response, or OSV.dev
 * being unreachable (a self-hosted instance with no outbound internet, say)
 * all degrade to returning [] rather than failing the scan.
 */

import { isPrivateHostname } from "./safe-fetch";
import { readPage } from "./page-fetch";
import { openTags } from "./checks/_tag-scan";
import { generateId } from "./_helpers";
import { getCheckDef } from "./registry";
import {
  computeCvssBaseScore,
  parseCvssVector,
  severityFromCvssScore,
} from "./cvss";
import { fixedVersionFor, queryOsv, type OsvVuln } from "./osv-lookup";
import {
  detectLibrary,
  libraryComponent,
  versionBelow,
} from "./library-fingerprints";
import type { Vulnerability, Category, Severity } from "./types";
import { SEVERITY_PRIORITY } from "@/lib/config/constants";

/** Caps how many distinct libraries get an OSV.dev lookup per scan -- a page
 *  can reference far more script tags than any real site would load. */
const MAX_LIBRARIES_TO_CHECK = 15;
/** How many advisories the evidence text spells out, worst first. The rest
 *  are counted, and every one of them is still in cveIds and references. */
const ADVISORIES_IN_EVIDENCE = 5;

/**
 * The src of every script tag, in document order.
 *
 * Was `<script\b[^>]*\bsrc=...[^>]*>`, the same unbounded splice shape
 * checks/_tag-scan.ts replaced everywhere else: on a body of unterminated
 * <script src=" it took 88 seconds at 32KB. This module is not in allChecks
 * either, so nothing measured it.
 */
const SCRIPT_SRC_ATTR = /\bsrc\s*=\s*["']([^"']+)["']/i;

interface DetectedLibrary {
  name: string;
  npmPackage: string;
  version: string;
  scriptUrl: string;
}

// Exported so lib/scanner/software-inventory.ts can list the SAME client-side
// libraries in its inventory panel without re-implementing this detection.
export function extractDetectedLibraries(
  html: string,
  baseUrl: string,
): DetectedLibrary[] {
  const seen = new Set<string>();
  const detected: DetectedLibrary[] = [];

  for (const tag of openTags(html, "script")) {
    if (detected.length >= MAX_LIBRARIES_TO_CHECK) break;
    const srcAttr = SCRIPT_SRC_ATTR.exec(tag);
    if (!srcAttr) continue;
    let resolved: URL;
    try {
      resolved = new URL(srcAttr[1], baseUrl);
    } catch {
      continue;
    }
    const scriptUrl = resolved.toString();
    const lib = detectLibrary(scriptUrl);
    if (!lib) continue;
    const key = libraryComponent(lib);
    if (seen.has(key)) continue;
    seen.add(key);
    detected.push({ ...lib, scriptUrl });
  }

  return detected;
}

interface ScoredVuln {
  vuln: OsvVuln;
  /** Absent when OSV gives no CVSS 3.x vector this module can score. */
  severity?: Severity;
  cvssVector?: string;
  cvssScore?: number;
}

/**
 * Scores one OSV advisory from its own CVSS 3.x vector when present (a REAL,
 * per-instance vector -- computeCvssBaseScore never invents one). Many
 * advisories carry only a CVSS 4.0 vector or none; those stay unscored rather
 * than being given a number.
 */
function scoreVuln(vuln: OsvVuln): ScoredVuln {
  for (const sev of vuln.severity) {
    if (sev.type !== "CVSS_V3") continue;
    const metrics = parseCvssVector(sev.score);
    if (!metrics) continue;
    const cvssScore = computeCvssBaseScore(metrics);
    return {
      vuln,
      severity: severityFromCvssScore(cvssScore),
      cvssVector: sev.score,
      cvssScore,
    };
  }
  return { vuln };
}

function cveIdsOf(vuln: OsvVuln): string[] {
  return vuln.aliases.filter((a) => /^CVE-\d{4}-\d{4,}$/i.test(a));
}

/**
 * The single finding for one library version: every advisory, the worst
 * scored severity, and the release that fixes all of them when OSV records
 * one for each. A library whose advisories are all unscored is reported as
 * high, since OSV has confirmed an advisory affects this exact version.
 */
function buildOsvFinding(
  url: string,
  lib: DetectedLibrary,
  vulns: OsvVuln[],
): Vulnerability | null {
  const def = getCheckDef("osv-vulnerable-library");
  if (!def) return null;

  const scored = vulns
    .map(scoreVuln)
    .sort((a, b) => (b.cvssScore ?? -1) - (a.cvssScore ?? -1));
  const worst = scored[0];
  const severity: Severity =
    scored.reduce<Severity | undefined>(
      (acc, s) =>
        s.severity &&
        (!acc || SEVERITY_PRIORITY[s.severity] > SEVERITY_PRIORITY[acc])
          ? s.severity
          : acc,
      undefined,
    ) ?? "high";

  const cveIds = [...new Set(scored.flatMap((s) => cveIdsOf(s.vuln)))];

  const fixes = scored.map((s) => fixedVersionFor(s.vuln, lib.version));
  const upgradeTo = fixes.every((f): f is string => typeof f === "string")
    ? fixes.reduce((highest, v) => (versionBelow(highest, v) ? v : highest))
    : null;
  const unfixed = fixes.filter((f) => f === null).length;

  const listed = scored
    .slice(0, ADVISORIES_IN_EVIDENCE)
    .map((s) => {
      const cves = cveIdsOf(s.vuln);
      const label = `${s.vuln.id}${cves.length ? ` (${cves.join(", ")})` : ""}`;
      const score =
        s.cvssScore !== undefined ? `, CVSS ${s.cvssScore.toFixed(1)}` : "";
      const summary =
        s.vuln.summary || s.vuln.details?.slice(0, 200) || "see the advisory";
      return `${label}${score}: ${summary}`;
    })
    .join("; ");
  const more =
    scored.length > ADVISORIES_IN_EVIDENCE
      ? ` Plus ${scored.length - ADVISORIES_IN_EVIDENCE} more, listed in the references.`
      : "";
  const one = scored.length === 1;
  const remedy = upgradeTo
    ? ` ${upgradeTo} or later fixes ${one ? "it" : "all of them"}.`
    : unfixed > 0
      ? ` OSV records no fixed release for ${unfixed === scored.length ? (one ? "it" : "any of them") : `${unfixed} of them`} on this version's line.`
      : "";

  return {
    id: generateId(def.id, url, libraryComponent(lib)),
    title: def.title,
    severity,
    category: def.category as Category,
    description: def.description,
    evidence: `${lib.name} ${lib.version} (loaded from ${lib.scriptUrl}) is affected by ${one ? "an OSV advisory" : `${scored.length} OSV advisories`}. ${listed}.${more}${remedy}`,
    riskImpact: def.riskImpact,
    explanation: def.explanation,
    fixSteps: def.fixSteps,
    codeExamples: def.codeExamples,
    references: [
      ...(def.references ?? []),
      ...scored.map((s) => `https://osv.dev/vulnerability/${s.vuln.id}`),
    ],
    confidence: 90,
    detectionMethod: "OSV.dev live dependency lookup",
    evidenceExcerpts: [{ label: "script src", value: lib.scriptUrl }],
    component: libraryComponent(lib),
    ...(def.cwe ? { cwe: def.cwe } : {}),
    ...(def.owasp ? { owasp: def.owasp } : {}),
    ...(cveIds.length ? { cveIds } : {}),
    ...(worst?.cvssVector
      ? { cvssVector: worst.cvssVector, cvssScore: worst.cvssScore }
      : {}),
  };
}

/**
 * Fetches `url`, extracts every recognizable client-side library + exact
 * version from its script tags (up to MAX_LIBRARIES_TO_CHECK), and queries
 * OSV.dev live for each one. Returns one finding per library version that
 * any advisory affects.
 *
 * Fails open (returns []) on any error at any stage: a missing page, an
 * unreachable target, or an OSV.dev outage. A failure here must never crash
 * the scan or produce a false positive.
 */
export async function checkOsvVulnerableLibraries(
  url: string,
  cancelSignal?: AbortSignal,
): Promise<Vulnerability[]> {
  if (cancelSignal?.aborted) return [];

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return [];
  if (isPrivateHostname(parsed.hostname)) return [];

  // The same fetch of the page the other async checks read (page-fetch.ts).
  const page = await readPage(url);
  if (!page || !page.ok) return [];
  const html = page.body;

  const libraries = extractDetectedLibraries(html, url);
  if (libraries.length === 0) return [];
  if (cancelSignal?.aborted) return [];

  const results = await Promise.allSettled(
    libraries.map(async (lib) => ({
      lib,
      vulns: await queryOsv("npm", lib.npmPackage, lib.version),
    })),
  );

  const findings: Vulnerability[] = [];
  for (const result of results) {
    if (result.status !== "fulfilled" || result.value.vulns.length === 0) {
      continue;
    }
    const finding = buildOsvFinding(url, result.value.lib, result.value.vulns);
    if (finding) findings.push(finding);
  }

  return findings;
}
