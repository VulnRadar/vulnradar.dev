/**
 * Threat-intelligence reputation check: asks Google Web Risk whether the
 * scanned URL is a known malware/phishing/unwanted-software page.
 *
 * Invisible until configured (same pattern as AI_API_KEY, Turnstile, and
 * BrowserBase): a self-hosted instance with no WEB_RISK_API_KEY set simply
 * never runs this branch, rather than erroring or reporting a false "no
 * threats found" for every scan. See lib/scanner/async-checks.ts's
 * buildBranches for where this gate is applied.
 *
 * Uses Web Risk (https://cloud.google.com/web-risk/docs), not the plain
 * Safe Browsing API: Safe Browsing's ToS restricts the lookup API to
 * non-commercial use, while Web Risk is Google's own commercial-use
 * equivalent, needed since VulnRadar is a paid SaaS product surfacing
 * these results to customers.
 */

import type { Category, Vulnerability } from "./types";
import { generateId } from "./_helpers";
import { getCheckDef } from "./registry";

const WEB_RISK_ENDPOINT = "https://webrisk.googleapis.com/v1/uris:search";
const REQUEST_TIMEOUT_MS = 5000;

/** Web Risk's own threat-type enum, mapped to this project's check IDs. */
const THREAT_TYPE_TO_CHECK_ID: Record<string, string> = {
  MALWARE: "url-flagged-malware",
  SOCIAL_ENGINEERING: "url-flagged-social-engineering",
  UNWANTED_SOFTWARE: "url-flagged-unwanted-software",
};

interface WebRiskSearchResponse {
  threat?: {
    threatTypes?: string[];
    expireTime?: string;
  };
}

function buildFinding(checkId: string, url: string): Vulnerability | null {
  const def = getCheckDef(checkId);
  if (!def) return null;
  return {
    id: generateId(def.id, url),
    title: def.title,
    severity: def.severity as Vulnerability["severity"],
    category: def.category as Category,
    description: def.description,
    evidence: def.evidence,
    riskImpact: def.riskImpact,
    explanation: def.explanation,
    fixSteps: def.fixSteps,
    codeExamples: def.codeExamples,
    references: def.references ?? [],
    confidence: 98,
    detectionMethod: "Google Web Risk uris.search",
    ...(def.cwe ? { cwe: def.cwe } : {}),
    ...(def.owasp ? { owasp: def.owasp } : {}),
  };
}

/**
 * Queries Web Risk for `url` and returns any matching findings. Fails open
 * (returns []) on a missing API key, network error, timeout, or non-2xx
 * response, exactly like every other async check in this file's sibling
 * module (async-checks.ts) -- a threat-intel outage should never itself
 * become a false "this site is clean" signal or crash the scan.
 */
export async function checkReputation(url: string): Promise<Vulnerability[]> {
  const apiKey = process.env.WEB_RISK_API_KEY;
  if (!apiKey) return [];

  const params = new URLSearchParams({ key: apiKey, uri: url });
  for (const threatType of Object.keys(THREAT_TYPE_TO_CHECK_ID)) {
    params.append("threatTypes", threatType);
  }

  try {
    const res = await fetch(`${WEB_RISK_ENDPOINT}?${params.toString()}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(
        `[reputation] Web Risk API returned ${res.status} (non-fatal, skipping)`,
      );
      return [];
    }
    const data = (await res.json()) as WebRiskSearchResponse;
    const threatTypes = data.threat?.threatTypes ?? [];
    if (threatTypes.length === 0) return [];

    const findings: Vulnerability[] = [];
    for (const threatType of threatTypes) {
      const checkId = THREAT_TYPE_TO_CHECK_ID[threatType];
      if (!checkId) continue; // unknown/future threat type -- skip, don't crash
      const finding = buildFinding(checkId, url);
      if (finding) findings.push(finding);
    }
    return findings;
  } catch (err) {
    console.error(
      "[reputation] Web Risk lookup failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

/** True when WEB_RISK_API_KEY is set, so the caller can decide whether to
 *  plan/run the "reputation" async branch at all. */
export function isReputationCheckConfigured(): boolean {
  return !!process.env.WEB_RISK_API_KEY;
}
