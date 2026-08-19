/**
 * Live dependency-vulnerability check via OSV.dev.
 *
 * lib/scanner/checks/page-checks/libraries.ts already flags a small, hand-
 * maintained table of library version ranges against a handful of CVEs
 * someone picked at one point in time. This check uses the exact same safe,
 * passive detection technique (read a version out of a script's own
 * filename or CDN-pinned URL, never execute anything) but queries OSV.dev
 * live for each detected library + version, so it reflects whatever OSV
 * currently knows -- not a frozen snapshot.
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

import { isPrivateHostname, safeFetch } from "./safe-fetch";
import { generateId } from "./_helpers";
import { getCheckDef } from "./registry";
import { computeCvssBaseScore, type CvssMetrics } from "./cvss";
import { queryOsv, type OsvVuln } from "./osv-lookup";
import type { Vulnerability, Category, Severity } from "./types";
import { APP_NAME, APP_URL } from "@/lib/config/constants";

const USER_AGENT = `${APP_NAME}/1.0 (Security Scanner; Dependency Check; +${APP_URL})`;
const REQUEST_TIMEOUT_MS = 8000;

/** Caps how many distinct libraries get an OSV.dev lookup per scan -- a page
 *  can reference far more script tags than any real site would load. */
const MAX_LIBRARIES_TO_CHECK = 15;
/** Caps findings per library: a widely-used, long-lived library like jQuery
 *  can carry dozens of historical advisories against old versions. Keeps
 *  the highest-severity ones (see the sort before slicing below) rather
 *  than flooding a single outdated dependency into dozens of findings. */
const MAX_VULNS_PER_LIBRARY = 5;

interface LibraryFingerprint {
  name: string;
  /** The exact OSV.dev/npm registry package name to query. */
  npmPackage: string;
  /** Matches the library's identity in the resolved script URL. */
  filePattern: RegExp;
  /** Extracts a full x.y.z version from the same resolved script URL. */
  versionPattern: RegExp;
}

// Same libraries and detection patterns as libraries.ts's static table,
// where a match exists, plus a few more well-known libraries whose CDN
// convention reliably pins a full semver into the URL (unpkg.com/jsdelivr's
// `package@x.y.z` path segment). Deliberately excludes libraries whose
// common CDN convention only encodes a MAJOR version (e.g. d3js.org's
// `d3.v7.min.js`) -- OSV.dev needs an exact version to match affected
// ranges precisely, and a wrong guess is worse than no detection.
const LIBRARY_FINGERPRINTS: LibraryFingerprint[] = [
  {
    name: "jQuery",
    npmPackage: "jquery",
    filePattern: /jquery(?!-ui)/i,
    versionPattern: /jquery[-.@]?(\d+\.\d+\.\d+)/i,
  },
  {
    name: "jQuery UI",
    npmPackage: "jquery-ui",
    filePattern: /jquery-ui/i,
    versionPattern: /jquery-ui[-.@]?(\d+\.\d+\.\d+)/i,
  },
  {
    name: "Bootstrap",
    npmPackage: "bootstrap",
    filePattern: /bootstrap/i,
    versionPattern: /bootstrap[-.@]?(\d+\.\d+\.\d+)/i,
  },
  {
    name: "Lodash",
    npmPackage: "lodash",
    filePattern: /lodash/i,
    versionPattern: /lodash[-.@]?(\d+\.\d+\.\d+)/i,
  },
  {
    name: "Moment.js",
    npmPackage: "moment",
    filePattern: /moment/i,
    versionPattern: /moment[-.@]?(\d+\.\d+\.\d+)/i,
  },
  {
    name: "Handlebars",
    npmPackage: "handlebars",
    filePattern: /handlebars/i,
    versionPattern: /handlebars[-.@]?(\d+\.\d+\.\d+)/i,
  },
  {
    name: "Underscore.js",
    npmPackage: "underscore",
    filePattern: /underscore/i,
    versionPattern: /underscore[-.@]?(\d+\.\d+\.\d+)/i,
  },
  {
    name: "Axios",
    npmPackage: "axios",
    filePattern: /axios/i,
    versionPattern: /axios[-.@]?(\d+\.\d+\.\d+)/i,
  },
  {
    name: "Vue.js",
    npmPackage: "vue",
    filePattern: /\bvue[@/.]/i,
    versionPattern: /vue[@/-]?(\d+\.\d+\.\d+)/i,
  },
  {
    name: "React",
    npmPackage: "react",
    filePattern: /\breact(?!-dom)[@/.]/i,
    versionPattern: /react[@/-]?(\d+\.\d+\.\d+)/i,
  },
  {
    name: "Alpine.js",
    npmPackage: "alpinejs",
    filePattern: /alpinejs/i,
    versionPattern: /alpinejs[@/-]?(\d+\.\d+\.\d+)/i,
  },
  {
    name: "GSAP",
    npmPackage: "gsap",
    filePattern: /\bgsap[@/.]/i,
    versionPattern: /gsap[@/-]?(\d+\.\d+\.\d+)/i,
  },
];

const SCRIPT_SRC_RE = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;

interface DetectedLibrary {
  name: string;
  npmPackage: string;
  version: string;
  scriptUrl: string;
}

// Exported so lib/scanner/software-inventory.ts can list the SAME client-side
// libraries in its inventory panel without re-implementing this detection.
// Export-only change: this remains the exact function osv-check itself uses,
// so OSV finding behavior is unchanged.
export function extractDetectedLibraries(
  html: string,
  baseUrl: string,
): DetectedLibrary[] {
  const seen = new Set<string>();
  const detected: DetectedLibrary[] = [];

  for (const m of html.matchAll(SCRIPT_SRC_RE)) {
    if (detected.length >= MAX_LIBRARIES_TO_CHECK) break;
    let resolved: URL;
    try {
      resolved = new URL(m[1], baseUrl);
    } catch {
      continue;
    }
    const src = resolved.toString();

    for (const fp of LIBRARY_FINGERPRINTS) {
      if (!fp.filePattern.test(src)) continue;
      const versionMatch = src.match(fp.versionPattern);
      if (!versionMatch) continue;
      const key = `${fp.npmPackage}@${versionMatch[1]}`;
      if (seen.has(key)) break;
      seen.add(key);
      detected.push({
        name: fp.name,
        npmPackage: fp.npmPackage,
        version: versionMatch[1],
        scriptUrl: src,
      });
      break; // one fingerprint match per script tag
    }
  }

  return detected;
}

const CVSS_METRIC_VALUES: Record<string, string[]> = {
  AV: ["N", "A", "L", "P"],
  AC: ["L", "H"],
  PR: ["N", "L", "H"],
  UI: ["N", "R"],
  S: ["U", "C"],
  C: ["N", "L", "H"],
  I: ["N", "L", "H"],
  A: ["N", "L", "H"],
};

/**
 * Parses a CVSS 3.x vector string (e.g.
 * "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", with or without the
 * leading "CVSS:3.x/" component) into computeCvssBaseScore's input shape.
 * Returns null when any required metric is missing or has an unrecognized
 * value, rather than guessing.
 */
function parseCvssVector(vector: string): CvssMetrics | null {
  const values: Record<string, string> = {};
  for (const part of vector.split("/")) {
    const [key, value] = part.split(":");
    if (key && value) values[key] = value;
  }
  for (const [key, allowed] of Object.entries(CVSS_METRIC_VALUES)) {
    if (!allowed.includes(values[key])) return null;
  }
  return {
    av: values.AV as CvssMetrics["av"],
    ac: values.AC as CvssMetrics["ac"],
    pr: values.PR as CvssMetrics["pr"],
    ui: values.UI as CvssMetrics["ui"],
    scope: values.S as CvssMetrics["scope"],
    c: values.C as CvssMetrics["c"],
    i: values.I as CvssMetrics["i"],
    a: values.A as CvssMetrics["a"],
  };
}

/** Same severity bands NVD uses for a CVSS score (see lib/scanner/cvss.ts's
 *  header comment): Critical 9.0-10.0, High 7.0-8.9, Medium 4.0-6.9, Low
 *  0.1-3.9, None 0.0. */
function severityFromCvssScore(score: number): Severity {
  if (score >= 9.0) return "critical";
  if (score >= 7.0) return "high";
  if (score >= 4.0) return "medium";
  if (score > 0) return "low";
  return "info";
}

interface ScoredVuln {
  vuln: OsvVuln;
  severity: Severity;
  cvssVector?: string;
  cvssScore?: number;
}

/**
 * Scores one OSV vuln from its own CVSS 3.x data when present (a REAL,
 * per-instance vector -- computeCvssBaseScore never invents one), falling
 * back to "high" (unscored but a confirmed exact-version advisory match,
 * the same uniform severity libraries.ts's static table already uses for
 * every one of its own hand-picked entries) when OSV gives no parseable
 * CVSS score for this advisory.
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
  return { vuln, severity: "high" };
}

function buildOsvFinding(
  url: string,
  lib: DetectedLibrary,
  scored: ScoredVuln,
): Vulnerability | null {
  const def = getCheckDef("osv-vulnerable-library");
  if (!def) return null;

  const { vuln, severity, cvssVector, cvssScore } = scored;
  const cveIds = vuln.aliases.filter((a) => /^CVE-\d{4}-\d{4,}$/i.test(a));
  const summary =
    vuln.summary ||
    vuln.details?.slice(0, 300) ||
    "See the OSV.dev advisory for details.";

  return {
    id: generateId(def.id, url, `${lib.npmPackage}@${lib.version}:${vuln.id}`),
    title: def.title,
    severity,
    category: def.category as Category,
    description: def.description,
    evidence: `${lib.name} ${lib.version} (loaded from ${lib.scriptUrl}) matches OSV advisory ${vuln.id}${cveIds.length ? ` (${cveIds.join(", ")})` : ""}: ${summary}`,
    riskImpact: def.riskImpact,
    explanation: def.explanation,
    fixSteps: def.fixSteps,
    codeExamples: def.codeExamples,
    references: [
      ...(def.references ?? []),
      `https://osv.dev/vulnerability/${vuln.id}`,
    ],
    confidence: 90,
    detectionMethod: "OSV.dev live dependency lookup",
    ...(def.cwe ? { cwe: def.cwe } : {}),
    ...(def.owasp ? { owasp: def.owasp } : {}),
    ...(cveIds.length ? { cveIds } : {}),
    ...(cvssVector ? { cvssVector, cvssScore } : {}),
  };
}

/**
 * Fetches `url`, extracts every recognizable client-side library + exact
 * version from its script tags (up to MAX_LIBRARIES_TO_CHECK), and queries
 * OSV.dev live for each one. Returns a finding per matching advisory, up to
 * MAX_VULNS_PER_LIBRARY per library, highest-severity first.
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

  let html: string;
  try {
    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const res = await safeFetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: cancelSignal
        ? AbortSignal.any([timeoutSignal, cancelSignal])
        : timeoutSignal,
    });
    if (!res.ok) return [];
    html = await res.text();
  } catch {
    return [];
  }

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
    const { lib, vulns } = result.value;
    const scored = vulns
      .map(scoreVuln)
      .sort((a, b) => (b.cvssScore ?? 0) - (a.cvssScore ?? 0))
      .slice(0, MAX_VULNS_PER_LIBRARY);
    for (const s of scored) {
      const finding = buildOsvFinding(url, lib, s);
      if (finding) findings.push(finding);
    }
  }

  return findings;
}
