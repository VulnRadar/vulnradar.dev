/**
 * "The previous scan" of a site, for the two things that diff against it: the
 * regression alert (lib/scanner/regression-alert.ts) and the "new since last
 * scan" diff stored on every scan (lib/scanner/execute-scan.ts). They used to
 * run one query each, and the two had drifted: the alert matched every stored
 * spelling of the URL and the stored diff only the canonical one, so after the
 * change to canonical URLs they disagreed about which scan came before.
 *
 * Matching the row is only half of it. A scan stored as "https://example.com"
 * before that change carries finding ids hashed from that spelling, and the
 * scan being diffed hashes "https://example.com/". Diffing by id would call
 * every finding new, so the first rescan of every site typed as a bare host
 * mailed all of its critical and high findings again. Each previous finding's
 * id is read through the same remap that carried triage over to the new ids
 * (lib/scanner/finding-id-remap.ts), so a finding the site still has is the
 * same finding under both spellings.
 */
import pool from "@/lib/database/db";
import type { Vulnerability } from "./types";
import { remapFindingKey } from "./finding-id-remap";
import { scanUrlLookupForms } from "./scan-identity";

export interface PreviousScan {
  id: number;
  /** As stored, which for a row from before canonical URLs is the old form. */
  url: string;
  /** With every id in the form the scanner produces now. */
  findings: Vulnerability[];
}

/**
 * Every stored spelling of `url`, for scan_history.url and the triage tables'
 * finding_url alike. Rows from before canonical URLs hold the root without its
 * slash, so a lookup by one spelling alone read the first scan after the
 * change as the site's first and re-alerted on everything already known.
 */
export function urlForms(url: string): string[] {
  const forms = scanUrlLookupForms(url);
  return forms.length > 0 ? forms : [url];
}

/**
 * `finding` with the id it would be given if it were found today, or as it is
 * when that is the id it already has (or the remap cannot tell).
 */
export function currentFindingId(
  finding: Vulnerability,
  storedUrl: string,
): string {
  if (typeof finding.id !== "string") return finding.id;
  const remapped = remapFindingKey(finding.id, storedUrl, {
    evidence: typeof finding.evidence === "string" ? finding.evidence : "",
    evidenceExcerpts: Array.isArray(finding.evidenceExcerpts)
      ? finding.evidenceExcerpts
      : undefined,
  });
  return remapped?.findingId ?? finding.id;
}

/**
 * The most recent other completed scan of this site for this user, or null
 * when there is none. `excludeScanId` is the scan being finalised, so a scan
 * never diffs against itself.
 */
export async function getPreviousCompletedScan(
  userId: number,
  url: string,
  excludeScanId: number,
): Promise<PreviousScan | null> {
  const result = await pool.query<{
    id: number;
    url: string;
    findings: unknown;
  }>(
    `SELECT id, url, findings FROM scan_history
     WHERE user_id = $1 AND url = ANY($2::text[]) AND id != $3
       AND status = 'completed'
     ORDER BY scanned_at DESC
     LIMIT 1`,
    [userId, urlForms(url), excludeScanId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const raw =
    typeof row.findings === "string" ? JSON.parse(row.findings) : row.findings;
  const stored = Array.isArray(raw) ? (raw as Vulnerability[]) : [];
  const storedUrl = typeof row.url === "string" ? row.url : url;
  return {
    id: row.id,
    url: storedUrl,
    findings: stored.map((f) => {
      if (!f || typeof f !== "object") return f;
      const id = currentFindingId(f, storedUrl);
      return id === f.id ? f : { ...f, id };
    }),
  };
}
