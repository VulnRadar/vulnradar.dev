/**
 * OSV.dev (Open Source Vulnerabilities) query client.
 *
 * OSV.dev aggregates GitHub Security Advisories, npm's own advisory
 * database, and other ecosystem-specific sources into one free, no-API-key
 * API, queryable by exact package name + version. Used by
 * lib/scanner/osv-check.ts to check a detected client-side library's exact
 * version against OSV.dev's live database, instead of relying only on
 * lib/scanner/checks/page-checks/libraries.ts's small, hand-maintained table
 * of known-vulnerable ranges.
 *
 * Not cached: unlike CISA's KEV catalog (lib/scanner/cve-enrichment.ts),
 * which is one big feed worth caching across scans, this is a lightweight
 * per-package query -- the same "queried live every time, no cache" treatment
 * that module's own EPSS lookups already use.
 *
 * Fail-open by construction: every request carries its own timeout and every
 * failure returns an empty array rather than throwing. This must never be
 * the reason a scan fails, and a self-hosted instance with no outbound
 * internet must degrade to "no OSV findings" silently.
 */

import { APP_NAME } from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";

const OSV_QUERY_URL = "https://api.osv.dev/v1/query";

export interface OsvSeverity {
  type: string;
  score: string;
}

export interface OsvVuln {
  id: string;
  /** Other identifiers for the same advisory -- CVE IDs live here when OSV's
   *  own record (a GHSA, say) isn't itself a CVE. */
  aliases: string[];
  summary?: string;
  details?: string;
  severity: OsvSeverity[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function parseOsvVuln(raw: unknown): OsvVuln | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  const aliases = Array.isArray(raw.aliases)
    ? raw.aliases.filter((a): a is string => typeof a === "string")
    : [];
  const severity = Array.isArray(raw.severity)
    ? raw.severity
        .filter(isRecord)
        .filter(
          (s): s is { type: string; score: string } =>
            typeof s.type === "string" && typeof s.score === "string",
        )
        .map((s) => ({ type: s.type, score: s.score }))
    : [];
  return {
    id: raw.id,
    aliases,
    summary: typeof raw.summary === "string" ? raw.summary : undefined,
    details: typeof raw.details === "string" ? raw.details : undefined,
    severity,
  };
}

/**
 * Queries OSV.dev for every known vulnerability affecting this exact
 * package + version. Returns [] on any error (network, timeout, malformed
 * response, or genuinely no vulnerabilities found) -- callers cannot
 * distinguish "none found" from "lookup failed", the same fail-open
 * contract as every other external call in the scanner.
 */
export async function queryOsv(
  ecosystem: string,
  packageName: string,
  version: string,
): Promise<OsvVuln[]> {
  try {
    const timeoutMs = await getSetting("SCANNER_THREAT_INTEL_API_TIMEOUT_MS");
    const res = await fetch(OSV_QUERY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": `${APP_NAME}/1.0 (Dependency Vulnerability Lookup)`,
      },
      body: JSON.stringify({
        version,
        package: { name: packageName, ecosystem },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    const vulns = isRecord(data) && Array.isArray(data.vulns) ? data.vulns : [];
    return vulns.map(parseOsvVuln).filter((v): v is OsvVuln => v !== null);
  } catch (err) {
    console.error(
      `[${APP_NAME}] osv-lookup: query failed for ${ecosystem}/${packageName}@${version} (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
