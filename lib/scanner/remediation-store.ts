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
 * The finding ids this owner has marked a false positive.
 *
 * Split out of attachFalsePositiveVerdicts so the lookup can be issued
 * alongside getRemediationMap rather than after it. Same query, same
 * best-effort contract: a failed read returns an empty set, so the caller
 * shows every finding, which is the safe direction.
 */
export async function getFalsePositiveIds(
  userId: number,
): Promise<Set<string>> {
  try {
    const res = await pool.query<{ finding_id: string }>(
      `SELECT finding_id FROM scan_finding_feedback
       WHERE user_id = $1 AND verdict = 'false_positive'`,
      [userId],
    );
    return new Set(res.rows.map((row) => row.finding_id));
  } catch (err) {
    console.error(
      "Failed to read false-positive verdicts:",
      err instanceof Error ? err.message : err,
    );
    return new Set();
  }
}

/**
 * Everything the OWNER of a scan sees on their own findings that is not in the
 * scan row: remediation status, and whether they have called a finding a false
 * positive.
 *
 * Three routes wanted both - the scan detail, the report export and the scan
 * status poll - and all three wrote the same nested pair, each awaiting the
 * remediation lookup and then passing its result into the verdict lookup. That
 * chain reads like a dependency and is not one: both key off `finding.id`, and
 * neither changes an id, so the second was simply waiting on the first for no
 * reason. Two sequential round trips per call, three times over, on the paths
 * a user hits most.
 *
 * Both lookups go out together here and both are applied in one pass. Owner-
 * only by construction, which is the other reason this belongs in one place:
 * remediation and false-positive verdicts are private to the person who
 * recorded them, and a teammate viewing the same scan must not receive either.
 */
export async function attachOwnerFindingState(
  userId: number,
  findingUrl: string,
  findings: Vulnerability[],
): Promise<Vulnerability[]> {
  if (!Array.isArray(findings) || findings.length === 0) return findings;

  const [remediationMap, suppressed] = await Promise.all([
    getRemediationMap(userId, findingUrl),
    getFalsePositiveIds(userId),
  ]);

  if (remediationMap.size === 0 && suppressed.size === 0) return findings;

  return findings.map((f) => {
    const remediation = remediationMap.get(f.id);
    if (!remediation && !suppressed.has(f.id)) return f;
    return {
      ...f,
      ...(remediation ? { remediation } : {}),
      ...(suppressed.has(f.id) ? { suppressed: true } : {}),
    };
  });
}
