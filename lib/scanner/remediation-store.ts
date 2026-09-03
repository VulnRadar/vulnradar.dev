/**
 * Server-only read/merge helpers for finding remediation status.
 *
 * Split from lib/scanner/remediation.ts (which is pure and client-safe)
 * because this imports the DB pool. Used by the OWNER result-load paths
 * (app/api/v3/history/[id]/route.ts and app/api/v3/scan/status/[id]/route.ts)
 * to attach each finding's current remediation status by its stable
 * finding_id, so a finding marked "fixed" on an earlier scan of a target
 * shows as "fixed" on a later scan of the same target.
 *
 * Owner-only: the caller passes its own authenticated user id, and the
 * public /shared/[token] and /host/[hostname] pages never call this, so a
 * user's private remediation tracking never leaks onto a shared view.
 */

import pool from "@/lib/database/db";
import type { FindingRemediation, RemediationStatus } from "./remediation";
import type { Vulnerability } from "./types";

interface RemediationRow {
  finding_id: string;
  status: RemediationStatus;
  note: string | null;
  assignee: string | null;
  due_at: string | null;
}

/**
 * All of a user's remediation rows for one scanned URL, keyed by finding_id.
 * Best-effort: a missing table (fresh boot before migration) or any DB error
 * returns an empty map rather than throwing, so a result page never fails to
 * load just because remediation couldn't be read.
 */
export async function getRemediationMap(
  userId: number,
  findingUrl: string,
): Promise<Map<string, FindingRemediation>> {
  const map = new Map<string, FindingRemediation>();
  try {
    const res = await pool.query<RemediationRow>(
      `SELECT finding_id, status, note, assignee, due_at
         FROM finding_remediation
        WHERE user_id = $1 AND finding_url = $2`,
      [userId, findingUrl],
    );
    for (const row of res.rows) {
      map.set(row.finding_id, {
        status: row.status,
        note: row.note,
        assignee: row.assignee,
        dueAt: row.due_at,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Table not migrated yet is expected and silent; anything else is worth
    // a log but still non-fatal.
    if (!msg.includes("finding_remediation")) {
      console.error("[remediation] Failed to load remediation map:", msg);
    }
  }
  return map;
}

/**
 * Returns a copy of `findings` with each finding's current remediation
 * status attached (by stable finding_id) where the user has set one. Leaves
 * findings without a stored status untouched. Owner-only -- callers must
 * pass the authenticated owner's user id.
 */
export async function attachRemediation(
  userId: number,
  findingUrl: string,
  findings: Vulnerability[],
): Promise<Vulnerability[]> {
  if (!Array.isArray(findings) || findings.length === 0) return findings;
  const map = await getRemediationMap(userId, findingUrl);
  if (map.size === 0) return findings;
  return findings.map((f) => {
    const remediation = map.get(f.id);
    return remediation ? { ...f, remediation } : f;
  });
}

/**
 * Flag the findings this owner has marked a false positive.
 *
 * Reads the same table and the same predicate as
 * lib/scanner/recompute-scan-score.ts, which excludes these from summary,
 * findings_count and dangerScore. Keeping one source for both is the point:
 * a second rule would let the numbers and the list drift apart again.
 *
 * Owner-only, like attachRemediation. A teammate viewing the scan sees the
 * findings as scanned, since the verdict is the owner's own triage.
 */
export async function attachFalsePositiveVerdicts(
  userId: number,
  findings: Vulnerability[],
): Promise<Vulnerability[]> {
  if (!Array.isArray(findings) || findings.length === 0) return findings;
  try {
    const res = await pool.query<{ finding_id: string }>(
      `SELECT finding_id FROM scan_finding_feedback
       WHERE user_id = $1 AND verdict = 'false_positive'`,
      [userId],
    );
    if (res.rows.length === 0) return findings;
    const suppressed = new Set(res.rows.map((row) => row.finding_id));
    return findings.map((f) =>
      suppressed.has(f.id) ? { ...f, suppressed: true } : f,
    );
  } catch (err) {
    // Best effort: a failed lookup must not cost the user their findings.
    // The list then shows every finding, which is the safe direction.
    console.error(
      "Failed to attach false-positive verdicts:",
      err instanceof Error ? err.message : err,
    );
    return findings;
  }
}
