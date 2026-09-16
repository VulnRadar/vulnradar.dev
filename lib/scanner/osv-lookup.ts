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
import { versionBelow } from "./library-fingerprints";
import type { Severity } from "./types";

const OSV_QUERY_URL = "https://api.osv.dev/v1/query";

export interface OsvSeverity {
  type: string;
  score: string;
}

/**
 * One affected interval for the queried package, flattened from OSV's event
 * list. `introduced` "0" means every version before the end. An interval
 * ends at `fixed` (exclusive) or `lastAffected` (inclusive, and means no
 * fixed release was recorded), or at neither when every later version is
 * still affected.
 */
export interface OsvAffectedInterval {
  introduced: string;
  fixed?: string;
  lastAffected?: string;
}

export interface OsvVuln {
  id: string;
  /** Other identifiers for the same advisory -- CVE IDs live here when OSV's
   *  own record (a GHSA, say) isn't itself a CVE. */
  aliases: string[];
  summary?: string;
  details?: string;
  severity: OsvSeverity[];
  /**
   * The advisory database's own rating, from database_specific.severity
   * (GitHub advisories: CRITICAL, HIGH, MODERATE, LOW). Many recent
   * advisories publish only a CVSS 4.0 vector, which is not scored here, and
   * this is what rates those.
   */
  databaseSeverity?: Severity;
  /** SEMVER and ECOSYSTEM intervals recorded for the queried package only. */
  affected: OsvAffectedInterval[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function parseAffected(
  raw: Record<string, unknown>,
  packageName: string,
): OsvAffectedInterval[] {
  const intervals: OsvAffectedInterval[] = [];
  const entries = Array.isArray(raw.affected) ? raw.affected : [];
  for (const entry of entries) {
    if (!isRecord(entry) || !isRecord(entry.package)) continue;
    const name = entry.package.name;
    if (typeof name !== "string") continue;
    if (name.toLowerCase() !== packageName.toLowerCase()) continue;
    const ranges = Array.isArray(entry.ranges) ? entry.ranges : [];
    const fromRanges = intervals.length;
    for (const range of ranges) {
      if (!isRecord(range)) continue;
      // GIT ranges are commit hashes, not versions.
      if (range.type !== "SEMVER" && range.type !== "ECOSYSTEM") continue;
      const events = Array.isArray(range.events) ? range.events : [];
      let open: string | null = null;
      for (const event of events) {
        if (!isRecord(event)) continue;
        if (typeof event.introduced === "string") {
          open = event.introduced;
        } else if (open !== null && typeof event.fixed === "string") {
          intervals.push({ introduced: open, fixed: event.fixed });
          open = null;
        } else if (open !== null && typeof event.last_affected === "string") {
          intervals.push({
            introduced: open,
            lastAffected: event.last_affected,
          });
          open = null;
        }
      }
      if (open !== null) intervals.push({ introduced: open });
    }
    // An advisory with no fixed release often lists the affected versions
    // and no ranges at all, as GHSA-q58r-hwc8-rm9j does for Bootstrap 3.4.1.
    // Each listed version is an interval with no fix, so fixedVersionFor
    // says "no fixed release" instead of not placing the version.
    if (intervals.length === fromRanges && Array.isArray(entry.versions)) {
      for (const v of entry.versions) {
        if (typeof v === "string") {
          intervals.push({ introduced: v, lastAffected: v });
        }
      }
    }
  }
  return intervals;
}

/**
 * The release that fixes `version` for this advisory: a version string when
 * OSV records one for the interval `version` falls in, null when it falls in
 * an interval with no fixed release, and undefined when OSV's ranges do not
 * place it at all (the advisory matched on its explicit version list).
 */
export function fixedVersionFor(
  vuln: OsvVuln,
  version: string,
): string | null | undefined {
  for (const interval of vuln.affected) {
    if (
      interval.introduced !== "0" &&
      versionBelow(version, interval.introduced)
    ) {
      continue;
    }
    if (interval.fixed !== undefined) {
      if (versionBelow(version, interval.fixed)) return interval.fixed;
      continue;
    }
    if (interval.lastAffected !== undefined) {
      if (!versionBelow(interval.lastAffected, version)) return null;
      continue;
    }
    return null;
  }
  return undefined;
}

const DATABASE_SEVERITY: Readonly<Record<string, Severity>> = {
  CRITICAL: "critical",
  HIGH: "high",
  MODERATE: "medium",
  MEDIUM: "medium",
  LOW: "low",
};

function databaseSeverityOf(
  raw: Record<string, unknown>,
): Severity | undefined {
  const specific = raw.database_specific;
  if (!isRecord(specific) || typeof specific.severity !== "string") {
    return undefined;
  }
  return DATABASE_SEVERITY[specific.severity.toUpperCase()];
}

function parseOsvVuln(raw: unknown, packageName: string): OsvVuln | null {
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
    databaseSeverity: databaseSeverityOf(raw),
    affected: parseAffected(raw, packageName),
  };
}

/**
 * Queries OSV.dev for every known vulnerability affecting this exact
 * package + version: the advisories, [] when OSV.dev has none, or null when
 * the lookup itself failed (network, timeout, non-ok status, malformed body).
 * It never throws.
 *
 * Failure used to be [] too, which made an OSV.dev outage indistinguishable
 * from a clean result: the scan reported the library check as done and found
 * nothing, for libraries it had never looked up.
 */
export async function queryOsv(
  ecosystem: string,
  packageName: string,
  version: string,
): Promise<OsvVuln[] | null> {
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
    if (!res.ok) return null;
    const data: unknown = await res.json();
    // OSV.dev answers {} for a version with no advisories.
    if (!isRecord(data)) return null;
    if (data.vulns === undefined) return [];
    if (!Array.isArray(data.vulns)) return null;
    return data.vulns
      .map((raw) => parseOsvVuln(raw, packageName))
      .filter((v): v is OsvVuln => v !== null);
  } catch (err) {
    console.error(
      `[${APP_NAME}] osv-lookup: query failed for ${ecosystem}/${packageName}@${version} (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
