/**
 * Multi-source threat-intelligence reputation checks.
 *
 * The scanned host is checked against several independent threat-intel /
 * blocklist sources. Every source is best-effort: it has its own try/catch,
 * its own bounded timeout, and its own per-host cache, and it NEVER throws or
 * fails the scan. A source is reported as exactly one of three states, and
 * "unavailable" is never presented as "clean":
 *
 *   - clean:       reached the source, the host is not listed.
 *   - flagged:     reached the source, the host IS listed (with what it flagged).
 *   - unavailable: no key, network error, timeout, or an error/blocked
 *                  response the source itself returned.
 *
 * Sources wired:
 *   1. Google Web Risk    -- key-gated (WEB_RISK_API_KEY), optional, UNCHANGED
 *                            from the single-source version: same endpoint,
 *                            same threat-type mapping, same registry-backed
 *                            findings, same "invisible until configured" rule.
 *                            Omitted from the summary entirely when no key is
 *                            set, so a keyless deployment never shows it.
 *   2. URLhaus (abuse.ch) -- free host lookup (POST the host to a fixed API
 *                            URL), flags known malware/phishing distribution.
 *                            No key required; an optional URLHAUS_AUTH_KEY is
 *                            sent when set (abuse.ch has been tightening to
 *                            per-key auth), and an unauthorized/error response
 *                            degrades to "unavailable", never a false "clean".
 *   3. Spamhaus DBL       -- free domain DNS blocklist queried over node:dns
 *                            (<host>.dbl.spamhaus.org). A 127.0.1.x answer is a
 *                            real listing; a 127.255.255.x answer is one of
 *                            Spamhaus's own "query blocked / via public
 *                            resolver / excessive volume" error codes and is
 *                            treated as "unavailable", never "clean".
 *
 * Deliberately NOT wired (documented so the choice is explicit): PhishTank
 * needs an API key, and OpenPhish's community feed is a large flat text list
 * meant to be mirrored/cached wholesale, not polled per scan. Both are a poor
 * fit for a per-scan, no-key, best-effort probe and would add the exact
 * "hammer an external service" load this module is built to avoid.
 *
 * SSRF: only the scanned host's own name is ever used, and only as data.
 * URLhaus is a POST of the host string to a FIXED api URL (the host itself is
 * never fetched), and the DBL lookup only prepends the host label under the
 * fixed .dbl.spamhaus.org suffix (no fetch at all). The host-based sources are
 * skipped for raw IP literals and refused for any private/internal hostname,
 * and the host is validated to a DNS-label charset before use.
 */

import * as dns from "dns/promises";
import { isIP } from "net";
import type { Category, Severity, Vulnerability } from "./types";
import { generateId } from "./_helpers";
import { getCheckDef } from "./registry";
import { getSetting } from "@/lib/config/runtime-config";
import { isPrivateHostname } from "@/lib/scanner/safe-fetch";

const WEB_RISK_ENDPOINT = "https://webrisk.googleapis.com/v1/uris:search";
const URLHAUS_HOST_ENDPOINT = "https://urlhaus-api.abuse.ch/v1/host/";

/** Web Risk's own threat-type enum, mapped to this project's check IDs. */
const THREAT_TYPE_TO_CHECK_ID: Record<string, string> = {
  MALWARE: "url-flagged-malware",
  SOCIAL_ENGINEERING: "url-flagged-social-engineering",
  UNWANTED_SOFTWARE: "url-flagged-unwanted-software",
};

/** Web Risk's threat-type enum, mapped to the shared threat-category tokens
 *  used across the aggregated summary and blocklist finding. */
const THREAT_TYPE_TO_CATEGORY: Record<string, string> = {
  MALWARE: "malware",
  SOCIAL_ENGINEERING: "phishing",
  UNWANTED_SOFTWARE: "unwanted-software",
};

/** The threat-category tokens that make a listing exploitation-grade rather
 *  than reputation/abuse-grade, and so raise the aggregated finding to
 *  critical. */
const SEVERE_CATEGORIES = new Set(["malware", "phishing", "botnet"]);

// ── Public types ────────────────────────────────────────────────────────────

export type ThreatIntelVerdict = "clean" | "flagged" | "unavailable";

export interface ThreatIntelSource {
  /** Human name shown in evidence and the panel, e.g. "URLhaus (abuse.ch)". */
  source: string;
  verdict: ThreatIntelVerdict;
  /** Threat categories this source flagged (e.g. ["malware"]). Only set when
   *  verdict is "flagged". */
  categories?: string[];
  /** Short human-readable note: why it was unavailable, or listing detail. */
  detail?: string;
}

export interface ThreatIntelSummary {
  host: string;
  checkedAt: string;
  sources: ThreatIntelSource[];
  /** Sources whose verdict is "flagged". */
  flaggedCount: number;
  /** Sources actually reached (verdict "clean" or "flagged"). "unavailable"
   *  does NOT count, so the UI can say "checked against N sources" honestly. */
  reachableCount: number;
}

// ── Web Risk (source 1, key-gated, UNCHANGED behavior) ──────────────────────

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
 * Query Web Risk for `url`. Returns both the registry-backed findings (exactly
 * as the single-source version did) and a per-source verdict for the summary.
 * `source` is null when no API key is configured, so an unconfigured Web Risk
 * stays invisible instead of appearing as "unavailable" on every keyless
 * deployment.
 */
async function queryWebRisk(
  url: string,
  timeoutMs: number,
): Promise<{ source: ThreatIntelSource | null; findings: Vulnerability[] }> {
  const apiKey = process.env.WEB_RISK_API_KEY;
  if (!apiKey) return { source: null, findings: [] };

  const params = new URLSearchParams({ key: apiKey, uri: url });
  for (const threatType of Object.keys(THREAT_TYPE_TO_CHECK_ID)) {
    params.append("threatTypes", threatType);
  }

  try {
    const res = await fetch(`${WEB_RISK_ENDPOINT}?${params.toString()}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.error(
        `[reputation] Web Risk API returned ${res.status} (non-fatal, skipping)`,
      );
      return {
        source: {
          source: "Google Web Risk",
          verdict: "unavailable",
          detail: `API returned HTTP ${res.status}`,
        },
        findings: [],
      };
    }
    const data = (await res.json()) as WebRiskSearchResponse;
    const threatTypes = data.threat?.threatTypes ?? [];
    if (threatTypes.length === 0) {
      return {
        source: { source: "Google Web Risk", verdict: "clean" },
        findings: [],
      };
    }

    const findings: Vulnerability[] = [];
    const categories: string[] = [];
    for (const threatType of threatTypes) {
      const checkId = THREAT_TYPE_TO_CHECK_ID[threatType];
      if (!checkId) continue; // unknown/future threat type -- skip, don't crash
      const finding = buildFinding(checkId, url);
      if (finding) findings.push(finding);
      const category = THREAT_TYPE_TO_CATEGORY[threatType];
      if (category) categories.push(category);
    }

    // Every returned threat type was unknown to us: treat as clean rather than
    // inventing a flag, matching the single-source version's "ignore unknown
    // threatType" behavior (it returned no findings in that case).
    if (findings.length === 0) {
      return {
        source: { source: "Google Web Risk", verdict: "clean" },
        findings: [],
      };
    }

    return {
      source: {
        source: "Google Web Risk",
        verdict: "flagged",
        categories: Array.from(new Set(categories)),
      },
      findings,
    };
  } catch (err) {
    console.error(
      "[reputation] Web Risk lookup failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
    return {
      source: {
        source: "Google Web Risk",
        verdict: "unavailable",
        detail: "network error or timeout",
      },
      findings: [],
    };
  }
}

// ── URLhaus (source 2, free, no key) ────────────────────────────────────────

interface UrlhausResponse {
  query_status?: string;
  urls?: Array<{ threat?: string | null; url_status?: string | null }>;
}

interface CacheEntry {
  result: ThreatIntelSource;
  at: number;
}

const SOURCE_CACHE_TTL_MS = 10 * 60 * 1000;
const urlhausCache = new Map<string, CacheEntry>();
const dblCache = new Map<string, CacheEntry>();

function readCache(cache: Map<string, CacheEntry>, host: string): ThreatIntelSource | undefined {
  const entry = cache.get(host);
  if (!entry) return undefined;
  if (Date.now() - entry.at > SOURCE_CACHE_TTL_MS) {
    cache.delete(host);
    return undefined;
  }
  return entry.result;
}

function writeCache(
  cache: Map<string, CacheEntry>,
  host: string,
  result: ThreatIntelSource,
): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.at > SOURCE_CACHE_TTL_MS) cache.delete(key);
  }
  cache.set(host, { result, at: now });
}

function normalizeUrlhausThreat(threat: string | null | undefined): string {
  const t = (threat ?? "").toLowerCase();
  if (t.includes("malware")) return "malware";
  if (t.includes("phish")) return "phishing";
  if (t.includes("botnet")) return "botnet";
  if (!t) return "malware"; // URLhaus is a malware/abuse feed; a listing with
  // no threat label is still a malware-distribution listing.
  return t;
}

/**
 * URLhaus host lookup. Cached per host. Best-effort: any failure resolves to
 * an "unavailable" verdict, never a throw and never a false "clean".
 */
export async function queryUrlhaus(
  host: string,
  timeoutMs: number,
): Promise<ThreatIntelSource> {
  const cached = readCache(urlhausCache, host);
  if (cached) return cached;

  const result = await queryUrlhausUncached(host, timeoutMs);
  writeCache(urlhausCache, host, result);
  return result;
}

async function queryUrlhausUncached(
  host: string,
  timeoutMs: number,
): Promise<ThreatIntelSource> {
  const name = "URLhaus (abuse.ch)";
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    const authKey = process.env.URLHAUS_AUTH_KEY;
    if (authKey) headers["Auth-Key"] = authKey;

    const res = await fetch(URLHAUS_HOST_ENDPOINT, {
      method: "POST",
      headers,
      body: new URLSearchParams({ host }).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      return { source: name, verdict: "unavailable", detail: `API returned HTTP ${res.status}` };
    }
    const data = (await res.json()) as UrlhausResponse;
    const status = data.query_status;
    if (status === "no_results") {
      return { source: name, verdict: "clean" };
    }
    if (status === "ok") {
      const urls = Array.isArray(data.urls) ? data.urls : [];
      if (urls.length === 0) return { source: name, verdict: "clean" };
      const categories = Array.from(
        new Set(urls.map((u) => normalizeUrlhausThreat(u?.threat))),
      );
      return {
        source: name,
        verdict: "flagged",
        categories,
        detail: `${urls.length} malicious URL(s) on this host`,
      };
    }
    // "invalid_host", "" or any other status: we could not get a real
    // clean/flagged answer, so it is unavailable, never "clean".
    return {
      source: name,
      verdict: "unavailable",
      detail: status ? `query_status: ${status}` : "no query_status",
    };
  } catch (err) {
    return {
      source: name,
      verdict: "unavailable",
      detail: err instanceof Error && err.name === "TimeoutError" ? "timeout" : "network error",
    };
  }
}

// ── Spamhaus DBL (source 3, free, no key, DNS) ──────────────────────────────

/** Map a DBL return-code address (127.0.1.x) to a threat category. Returns
 *  null for anything that is not a real listing code -- in particular the
 *  127.255.255.x error codes, which the caller treats as "unavailable". */
function dblCategory(ip: string): string | null {
  const m = /^127\.0\.1\.(\d+)$/.exec(ip);
  if (!m) return null;
  switch (Number(m[1])) {
    case 2:
    case 102:
    case 103:
      return "spam";
    case 4:
    case 104:
      return "phishing";
    case 5:
    case 105:
      return "malware";
    case 6:
    case 106:
      return "botnet";
    default:
      return "abuse";
  }
}

/**
 * Spamhaus DBL domain-blocklist lookup over DNS. Cached per host. Best-effort:
 * a genuine "not listed" (NXDOMAIN) is "clean"; a listing code is "flagged";
 * a Spamhaus error/blocked code, a timeout, or a transient DNS error is
 * "unavailable" -- never a false "clean".
 */
export async function querySpamhausDbl(
  host: string,
  timeoutMs: number,
): Promise<ThreatIntelSource> {
  const cached = readCache(dblCache, host);
  if (cached) return cached;

  const result = await querySpamhausDblUncached(host, timeoutMs);
  writeCache(dblCache, host, result);
  return result;
}

async function querySpamhausDblUncached(
  host: string,
  timeoutMs: number,
): Promise<ThreatIntelSource> {
  const name = "Spamhaus DBL";
  // Spamhaus blocks the public dbl.spamhaus.org zone from shared/cloud resolvers
  // (it answers 127.255.255.x, "query blocked"). A free Data Query Service key
  // routes the same lookup through the authenticated DQS zone, which returns
  // real listings. Falls back to the public zone when no key is set.
  const dqsKey = process.env.SPAMHAUS_DQS_KEY;
  const query = dqsKey
    ? `${host}.${dqsKey}.dbl.dq.spamhaus.net`
    : `${host}.dbl.spamhaus.org`;
  let ips: string[];
  try {
    ips = await Promise.race([
      dns.resolve4(query),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), timeoutMs),
      ),
    ]);
  } catch (err: unknown) {
    const code =
      err && typeof err === "object" && "code" in err
        ? (err as { code: string }).code
        : "";
    // NXDOMAIN / no record: the domain is genuinely not on the DBL.
    if (code === "ENOTFOUND" || code === "ENODATA" || code === "ENOENT") {
      return { source: name, verdict: "clean" };
    }
    // Timeout, SERVFAIL, or any other transient error: cannot determine.
    return {
      source: name,
      verdict: "unavailable",
      detail:
        err instanceof Error && err.message === "timeout" ? "timeout" : "DNS error",
    };
  }

  const listed = Array.from(
    new Set(ips.map(dblCategory).filter((c): c is string => c !== null)),
  );
  if (listed.length > 0) {
    return { source: name, verdict: "flagged", categories: listed };
  }
  // A successful resolve that is not a listing code is one of Spamhaus's error
  // return codes (e.g. 127.255.255.254 = queried via a public/open resolver,
  // 127.255.255.252 = anonymous query blocked). That is an availability
  // problem on our side, not a clean verdict for the host.
  return {
    source: name,
    verdict: "unavailable",
    detail: "query blocked or rate-limited by Spamhaus",
  };
}

// ── Aggregated blocklist finding ────────────────────────────────────────────

function buildBlocklistFinding(
  host: string,
  keyUrl: string,
  flagged: ThreatIntelSource[],
): Vulnerability {
  const categories = Array.from(
    new Set(flagged.flatMap((s) => s.categories ?? [])),
  );
  const severity: Severity = categories.some((c) => SEVERE_CATEGORIES.has(c))
    ? "critical"
    : "high";
  const sourceNames = flagged.map((s) => s.source).join(", ");
  const categoryLabel = categories.length > 0 ? categories.join(", ") : "abuse";

  const perSource = flagged
    .map((s) => {
      const cats = (s.categories ?? ["abuse"]).join(", ");
      const note = s.detail ? ` (${s.detail})` : "";
      return `${s.source}: listed for ${cats}${note}`;
    })
    .join(". ");

  const references = Array.from(
    new Set(
      flagged.flatMap((s) => {
        if (s.source.startsWith("URLhaus")) {
          return ["https://urlhaus.abuse.ch/"];
        }
        if (s.source.startsWith("Spamhaus")) {
          return ["https://www.spamhaus.org/dbl/", "https://check.spamhaus.org/"];
        }
        return [];
      }),
    ),
  );

  return {
    // Keyed on the host, not the page URL: a blocklist listing is a property of
    // the whole host, so the finding id stays stable across different paths on
    // it (and so its remediation status carries across rescans of any page).
    id: generateId("host-listed-threat-intel", host),
    title: "Host Listed on a Threat-Intelligence Blocklist",
    severity,
    category: "reputation",
    description: `One or more independent threat-intelligence sources list ${host} as associated with ${categoryLabel}. This is evidence gathered outside this scan: the host appears in a public malware, phishing, or abuse blocklist.`,
    evidence: `${sourceNames} flagged ${host}. ${perSource}.`,
    riskImpact:
      "Browsers, mail servers, and enterprise web filters that consume these feeds may warn visitors, block the page, or reject mail from this domain. If this is your own site, a listing usually means it was compromised or is being abused, and it actively drives away real users and damages trust in the domain.",
    explanation:
      "Reputation feeds only list a host after independent evidence of malicious use (serving malware, hosting a phishing page, or sending spam), not from this scan's own probing. Different feeds cover different abuse types, so appearing on any one of them is significant on its own.",
    fixSteps: [
      "Confirm the listing directly with each source named above before acting.",
      "If the site was compromised, audit for injected scripts, unauthorized uploads, or a vulnerable plugin or CMS version, then rotate all credentials.",
      "Request delisting from each source once the host is clean. URLhaus and Spamhaus both publish a removal process, and a listing clears once the feed re-confirms the host is no longer abusive.",
    ],
    codeExamples: [],
    references,
    confidence: 95,
    detectionMethod: "Aggregated threat-intel blocklist lookup",
    cwe: "CWE-506",
    owasp: "A03:2021",
  };
}

// ── Per-host summary side channel ───────────────────────────────────────────
//
// checkReputation runs inside the async-branch orchestration, whose only
// return channel is a flat Vulnerability[]. The structured per-source summary
// (for the "Threat intelligence" panel) has no room to ride back through that,
// so -- exactly like lib/scanner/ssl-grade.ts and dns-records.ts -- it is
// stashed here keyed by hostname, and execute-scan.ts / execute-crawl-scan.ts
// read it back when they assemble result_meta. Entries expire by TTL on write
// so the map can never grow unbounded; reads peek (never delete) so concurrent
// readers of one host each see the value.

const SUMMARY_TTL_MS = 5 * 60 * 1000;
const summaryStore = new Map<string, { summary: ThreatIntelSummary; at: number }>();

/** Stash a freshly computed summary for `host` (called from checkReputation). */
export function recordThreatIntel(host: string, summary: ThreatIntelSummary): void {
  const now = Date.now();
  for (const [key, entry] of summaryStore) {
    if (now - entry.at > SUMMARY_TTL_MS) summaryStore.delete(key);
  }
  summaryStore.set(host.toLowerCase(), { summary, at: now });
}

/** Read back the summary recorded for `host`, or undefined if none/stale. */
export function readThreatIntel(host: string): ThreatIntelSummary | undefined {
  const entry = summaryStore.get(host.toLowerCase());
  if (!entry) return undefined;
  if (Date.now() - entry.at > SUMMARY_TTL_MS) {
    summaryStore.delete(host.toLowerCase());
    return undefined;
  }
  return entry.summary;
}

// ── Main entry ──────────────────────────────────────────────────────────────

/** A DNS-label-safe hostname we are willing to hand to a blocklist source. */
function usableHostForBlocklists(url: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!hostname) return null;
  // Blocklist sources here are DOMAIN-based; a raw IP literal has no domain
  // reputation to look up, so skip the host-based sources for it.
  if (isIP(hostname)) return null;
  // Defence in depth: never build a blocklist query out of an internal host.
  if (isPrivateHostname(hostname)) return null;
  // Only a plain DNS-label charset, so we never construct a weird DNS name or
  // POST body out of unexpected input.
  if (!/^[a-z0-9.-]+$/.test(hostname) || hostname.length > 253) return null;
  return hostname;
}

/**
 * Check `url` against every configured/available threat-intel source, emit any
 * resulting findings, and stash a structured per-source summary for the
 * "Threat intelligence" panel. Fails open in every branch: a missing key, a
 * network error, a timeout, or an unreachable source can never crash the scan
 * or turn into a false "this host is clean". Returns [] when nothing flagged
 * the host (matching the single-source version's clean-result behavior); the
 * "checked against N sources, none flagged it" story lives in the summary
 * panel rather than as an info finding, so the findings list is unchanged for
 * a clean host.
 */
export async function checkReputation(url: string): Promise<Vulnerability[]> {
  const timeoutMs = await getSetting("SCANNER_THREAT_INTEL_API_TIMEOUT_MS");
  const host = usableHostForBlocklists(url);

  // Run every source concurrently; allSettled so one rejecting source can
  // never reject the batch. Each query already swallows its own errors, so a
  // rejection here would only be a genuine bug, and it still degrades to "no
  // contribution" rather than failing the scan.
  const [webRiskSettled, urlhausSettled, dblSettled] = await Promise.allSettled([
    queryWebRisk(url, timeoutMs),
    host
      ? queryUrlhaus(host, timeoutMs)
      : Promise.resolve<ThreatIntelSource | null>(null),
    host
      ? querySpamhausDbl(host, timeoutMs)
      : Promise.resolve<ThreatIntelSource | null>(null),
  ]);

  const findings: Vulnerability[] = [];
  const sources: ThreatIntelSource[] = [];

  const webRisk =
    webRiskSettled.status === "fulfilled"
      ? webRiskSettled.value
      : { source: null, findings: [] as Vulnerability[] };
  findings.push(...webRisk.findings);
  if (webRisk.source) sources.push(webRisk.source);

  const hostSources: ThreatIntelSource[] = [];
  const urlhaus =
    urlhausSettled.status === "fulfilled" ? urlhausSettled.value : null;
  if (urlhaus) hostSources.push(urlhaus);
  const dbl = dblSettled.status === "fulfilled" ? dblSettled.value : null;
  if (dbl) hostSources.push(dbl);
  sources.push(...hostSources);

  // Emit ONE aggregated finding for the host-based sources when any of them
  // flagged the host (Web Risk keeps its own registry-backed per-threat
  // findings above). Keyed on the host so the finding is stable per host.
  const flaggedHostSources = hostSources.filter((s) => s.verdict === "flagged");
  if (flaggedHostSources.length > 0 && host) {
    findings.push(buildBlocklistFinding(host, url, flaggedHostSources));
  }

  // Record the structured summary whenever any source contributed a verdict,
  // so the panel can show exactly what was checked and what each source said.
  if (sources.length > 0) {
    const reachableCount = sources.filter(
      (s) => s.verdict === "clean" || s.verdict === "flagged",
    ).length;
    const flaggedCount = sources.filter((s) => s.verdict === "flagged").length;
    let summaryHost = host;
    if (!summaryHost) {
      try {
        summaryHost = new URL(url).hostname.toLowerCase();
      } catch {
        summaryHost = url;
      }
    }
    recordThreatIntel(summaryHost, {
      host: summaryHost,
      checkedAt: new Date().toISOString(),
      sources,
      flaggedCount,
      reachableCount,
    });
  }

  return findings;
}

/** True when WEB_RISK_API_KEY is set. Web Risk is the only key-gated source;
 *  the other sources run without any configuration, so the reputation branch
 *  itself is no longer gated on this (see lib/scanner/async-checks.ts). Kept
 *  for callers that specifically need to know whether Web Risk is configured. */
export function isReputationCheckConfigured(): boolean {
  return !!process.env.WEB_RISK_API_KEY;
}

/** Test-only: clear the per-source caches and the summary side channel so
 *  cases don't leak cached verdicts into each other. */
export function __resetReputationCachesForTests(): void {
  urlhausCache.clear();
  dblCache.clear();
  summaryStore.clear();
}
