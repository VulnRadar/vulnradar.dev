import {
  isPrivateHostname,
  validateScanTarget,
  pinToResolvedIp,
} from "../safe-fetch";
import { generateId } from "../_helpers";
import { getCheckDef } from "../registry";
import type { Vulnerability, Category } from "../types";
import { probeSignal, USER_AGENT } from "./shared";

// Query-parameter names real applications commonly use for a post-action
// redirect target (post-login continuation, logout, SSO/OAuth callbacks,
// checkout flows). Matched case-insensitively against parameter names
// already present in links/forms the page itself references -- this check
// never guesses a redirect endpoint blindly, it only probes a parameter the
// target has already disclosed it accepts.
const REDIRECT_PARAM_NAMES = new Set(
  [
    "redirect",
    "redirect_uri",
    "redirect_url",
    "return",
    "return_to",
    "returnto",
    "returnurl",
    "next",
    "url",
    "target",
    "dest",
    "destination",
    "continue",
    "callback",
    "callback_url",
    "goto",
    "forward",
    "out",
  ].map((n) => n.toLowerCase()),
);

/** Caps how many distinct candidate redirect endpoints get an active probe
 *  per scan, the same "bound the blast radius of a page that references far
 *  more candidates than any real site would use" reasoning as
 *  MAX_BUCKET_LISTING_PROBES in async-checks.ts. */
const MAX_REDIRECT_CANDIDATES = 8;

// IANA-reserved TLD -- never a real domain -- used as the canary redirect
// target. A vulnerable endpoint that unconditionally redirects to whatever
// this parameter says sends the browser here instead of the caller's real
// destination.
const CANARY_ORIGIN = "https://openredirect-probe.vulnradar.test";
const CANARY_TARGET = `${CANARY_ORIGIN}/canary`;

const HREF_RE = /\b(?:href|action|src)\s*=\s*["']([^"'#\s]+)["']/gi;

interface RedirectCandidate {
  /** The absolute URL as it appears on the page, before substituting the
   *  canary value into its redirect parameter. */
  pageUrl: string;
  paramName: string;
}

function extractRedirectCandidates(
  html: string,
  baseUrl: string,
  hostname: string,
): RedirectCandidate[] {
  const seen = new Set<string>();
  const candidates: RedirectCandidate[] = [];

  for (const m of html.matchAll(HREF_RE)) {
    let target: URL;
    try {
      target = new URL(m[1], baseUrl);
    } catch {
      continue;
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") continue;
    if (target.hostname !== hostname) continue; // same-host only

    for (const paramName of target.searchParams.keys()) {
      if (!REDIRECT_PARAM_NAMES.has(paramName.toLowerCase())) continue;
      const key = `${target.origin}${target.pathname}:${paramName.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ pageUrl: target.toString(), paramName });
      if (candidates.length >= MAX_REDIRECT_CANDIDATES) return candidates;
    }
  }

  return candidates;
}

function buildFinding(
  url: string,
  distinguisher: string,
  evidence: string,
): Vulnerability | null {
  const def = getCheckDef("confirmed-open-redirect");
  if (!def) return null;
  return {
    id: generateId(def.id, url, distinguisher),
    title: def.title,
    severity: def.severity as Vulnerability["severity"],
    category: def.category as Category,
    description: def.description,
    evidence,
    riskImpact: def.riskImpact,
    explanation: def.explanation,
    fixSteps: def.fixSteps,
    codeExamples: def.codeExamples,
    references: def.references ?? [],
    confidence: 90,
    detectionMethod: "Active canary-redirect probe (GET, manual redirect)",
    ...(def.cwe ? { cwe: def.cwe } : {}),
    ...(def.owasp ? { owasp: def.owasp } : {}),
  };
}

/**
 * Fetches `url`, finds every same-host link or form action whose query
 * string already uses a well-known redirect-parameter name, and for each
 * one (up to MAX_REDIRECT_CANDIDATES) re-requests that exact endpoint with
 * the parameter's value replaced by a canary URL on an IANA-reserved TLD.
 * A candidate is flagged when the response is a 3xx redirect whose Location
 * header points at the canary origin -- proof the endpoint redirects to an
 * arbitrary attacker-controlled URL rather than validating it.
 *
 * Deliberately never guesses a redirect endpoint that isn't already
 * disclosed by the page itself: unlike the form-submission probes in this
 * directory, blindly appending redirect-shaped parameter names to arbitrary
 * URLs would hammer endpoints with no evidence they do anything with them.
 *
 * Fails open (returns []) on any error at any stage, the same contract as
 * every other probe in this directory.
 */
export async function checkOpenRedirectProbe(
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

  // isPrivateHostname above is a syntactic check on the hostname string
  // only. validateScanTarget additionally resolves DNS, so a hostname that
  // looked public when the scan started but has since been rebound to an
  // internal or cloud-metadata IP is still rejected before any probe fires.
  const safety = await validateScanTarget(url);
  if (!safety.safe) return [];

  let html: string;
  try {
    // Pin to the IP validateScanTarget just resolved so a DNS rebind can't
    // point the connect at a private/metadata IP (HTTP pinned + Host header;
    // HTTPS relies on the immediate re-resolution). Does not alter redirect
    // handling, so `redirect: "error"` still behaves as before.
    const pageTarget = pinToResolvedIp(url, safety.resolvedIp, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "error",
      signal: probeSignal(cancelSignal),
    });
    // Safe: pinned to the IP validateScanTarget(url) resolved above (private
    // IPs rejected); verified-owned domain. codeql[js/request-forgery]
    const res = await fetch(pageTarget.url, pageTarget.init);
    if (!res.ok) return [];
    html = await res.text();
  } catch {
    return [];
  }

  const candidates = extractRedirectCandidates(html, url, parsed.hostname);
  if (candidates.length === 0) return [];

  const findings: Vulnerability[] = [];

  for (const candidate of candidates) {
    if (cancelSignal?.aborted) break;

    let probeUrl: URL;
    try {
      probeUrl = new URL(candidate.pageUrl);
    } catch {
      continue;
    }
    probeUrl.searchParams.set(candidate.paramName, CANARY_TARGET);

    try {
      // probeUrl is the same host as `url` (validated above), so reuse its
      // resolved IP to pin the connect. redirect: "manual" is preserved, so
      // the cross-host canary 3xx is still returned for inspection.
      const probeTarget = pinToResolvedIp(
        probeUrl.toString(),
        safety.resolvedIp,
        {
          headers: { "User-Agent": USER_AGENT },
          redirect: "manual",
          signal: probeSignal(cancelSignal),
        },
      );
      // Safe: same host as `url` (validated above), pinned to its resolved
      // IP; only the redirect-shaped query param varies.
      // codeql[js/request-forgery]
      const res = await fetch(probeTarget.url, probeTarget.init);

      if (res.status < 300 || res.status >= 400) continue;
      const location = res.headers.get("location") ?? "";
      if (!location.startsWith(CANARY_ORIGIN)) continue;

      const finding = buildFinding(
        url,
        `${probeUrl.origin}${probeUrl.pathname}:${candidate.paramName}`,
        `Requesting ${probeUrl.origin}${probeUrl.pathname} with ${candidate.paramName}=${CANARY_TARGET} produced a ${res.status} redirect to Location: ${location}.`,
      );
      if (finding) findings.push(finding);
    } catch {
      continue;
    }
  }

  return findings;
}
