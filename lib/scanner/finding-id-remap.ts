/**
 * One-time carry-over of triage to the finding ids the scanner now produces.
 *
 * Two rules in the id changed together. The URL is hashed in its canonical
 * spelling (lib/scanner/_helpers.ts's canonicalScanUrl), so "https://x.com"
 * and "https://x.com/" are one site with one set of ids. And a check that can
 * return several hits on one page folds the hit into every id it produces, not
 * only when it happened to find two (lib/scanner/engine.ts). Both were right,
 * and both moved ids that people had already triaged: a false-positive verdict
 * or a remediation status stored under the old id would stop applying on the
 * next scan, which is exactly the "triage did nothing" report they fix.
 *
 * So each scan_finding_feedback and finding_remediation row whose id or URL
 * would now be spelled differently gets a copy under the new spelling. The
 * original row stays: scans that already ran still carry the old ids in their
 * findings, and their views keep showing the verdict. Idempotent through the
 * tables' own (user_id, finding_id, finding_url) UNIQUE: a second run inserts
 * nothing, and a verdict the person has since given under the new id is never
 * overwritten.
 */
import type { Pool } from "pg";

/** The boot connection (lib/database/boot/apply-boot-schema.ts) or a pool. */
type RemapExecutor = Pick<Pool, "query">;
import { logError } from "@/lib/logging/log";
import {
  canonicalScanUrl,
  generateId,
  hitDistinguisher,
  legacyFindingId,
} from "./_helpers";
import { extractCheckId } from "./check-id";
import type { EvidenceExcerpt } from "./types";

/**
 * The checks that returned an array of hits when the id rule changed. A
 * historical fact for this one remap rather than a live registry: the engine
 * decides from the shape of each check's return value, and a check written
 * after the change never had an id in the old shape.
 */
export const MULTI_HIT_CHECKS_AT_REMAP: ReadonlySet<string> = new Set([
  "page-outdated-vulnerable-library",
]);

/** What the remap needs of the stored finding an old id belonged to. */
export interface StoredHit {
  evidence: string;
  evidenceExcerpts?: EvidenceExcerpt[];
}

export interface RemappedKey {
  findingId: string;
  findingUrl: string;
}

/**
 * Whether the id an old (finding_id, finding_url) pair needs a lookup of its
 * stored finding to be remapped: a multi-hit check's undistinguished id, or a
 * distinguished id on a URL whose spelling changed. Everything else is
 * decided from the pair alone.
 */
export function needsStoredHit(findingId: string, findingUrl: string): boolean {
  const checkId = extractCheckId(findingId);
  const undistinguished = findingId === legacyFindingId(checkId, findingUrl);
  if (undistinguished) return MULTI_HIT_CHECKS_AT_REMAP.has(checkId);
  return canonicalScanUrl(findingUrl) !== findingUrl;
}

/**
 * The key a stored triage row should also exist under, or null when it is
 * already right or cannot be worked out. `stored` is the finding the id was
 * given to, when the caller could find it.
 */
export function remapFindingKey(
  findingId: string,
  findingUrl: string,
  stored?: StoredHit | null,
): RemappedKey | null {
  const checkId = extractCheckId(findingId);
  const url = canonicalScanUrl(findingUrl);
  const distinguisher = stored
    ? hitDistinguisher({
        excerpts: stored.evidenceExcerpts,
        evidence: stored.evidence,
      })
    : undefined;

  let next: string;
  if (findingId === legacyFindingId(checkId, findingUrl)) {
    next =
      MULTI_HIT_CHECKS_AT_REMAP.has(checkId) && distinguisher
        ? generateId(checkId, url, distinguisher)
        : generateId(checkId, url);
  } else if (
    distinguisher &&
    findingId === legacyFindingId(checkId, findingUrl, distinguisher)
  ) {
    next = generateId(checkId, url, distinguisher);
  } else {
    return null;
  }

  if (next === findingId && url === findingUrl) return null;
  return { findingId: next, findingUrl: url };
}

const PAGE = 500;

function asStoredHit(raw: unknown): StoredHit | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as { evidence?: unknown; evidenceExcerpts?: unknown };
  if (typeof f.evidence !== "string") return null;
  return {
    evidence: f.evidence,
    evidenceExcerpts: Array.isArray(f.evidenceExcerpts)
      ? (f.evidenceExcerpts as EvidenceExcerpt[])
      : undefined,
  };
}

/**
 * The finding an old id was given to: on the scan the verdict was recorded
 * against when the row names one, otherwise on the person's most recent scan
 * of that URL that carried the id.
 */
async function findStoredHit(
  pool: RemapExecutor,
  userId: number,
  findingId: string,
  findingUrl: string,
  scanHistoryId: number | null,
): Promise<StoredHit | null> {
  const { rows } = await pool.query<{ finding: unknown }>(
    scanHistoryId !== null
      ? `SELECT f AS finding
           FROM scan_history sh, jsonb_array_elements(sh.findings) f
          WHERE sh.id = $1 AND f->>'id' = $2
          LIMIT 1`
      : `SELECT f AS finding
           FROM scan_history sh, jsonb_array_elements(sh.findings) f
          WHERE sh.user_id = $1 AND sh.url = $3 AND f->>'id' = $2
          ORDER BY sh.scanned_at DESC
          LIMIT 1`,
    scanHistoryId !== null
      ? [scanHistoryId, findingId]
      : [userId, findingId, findingUrl],
  );
  return asStoredHit(rows[0]?.finding);
}

async function keyFor(
  pool: RemapExecutor,
  row: {
    user_id: number;
    finding_id: string;
    finding_url: string;
    scan_history_id: number | null;
  },
): Promise<RemappedKey | null> {
  const stored = needsStoredHit(row.finding_id, row.finding_url)
    ? await findStoredHit(
        pool,
        row.user_id,
        row.finding_id,
        row.finding_url,
        row.scan_history_id,
      )
    : null;
  return remapFindingKey(row.finding_id, row.finding_url, stored);
}

export interface RemapCounts {
  feedback: number;
  remediation: number;
}

/**
 * Walk both triage tables by id and insert the copies. Rows with no user
 * (an account deleted since, SET NULL on feedback) are left alone: there is
 * nobody left for the verdict to apply to. Never throws: a failure is logged
 * and the counts so far are returned, and the next run picks up the rest.
 */
export async function remapLegacyFindingIds(
  pool: RemapExecutor,
): Promise<RemapCounts> {
  const counts: RemapCounts = { feedback: 0, remediation: 0 };
  try {
    let afterId = 0;
    for (;;) {
      const { rows } = await pool.query<{
        id: number;
        user_id: number;
        scan_history_id: number | null;
        finding_id: string;
        finding_url: string;
      }>(
        `SELECT id, user_id, scan_history_id, finding_id, finding_url
           FROM scan_finding_feedback
          WHERE id > $1 AND user_id IS NOT NULL
          ORDER BY id
          LIMIT $2`,
        [afterId, PAGE],
      );
      for (const row of rows) {
        const key = await keyFor(pool, row);
        if (!key) continue;
        const res = await pool.query(
          `INSERT INTO scan_finding_feedback
             (user_id, scan_history_id, finding_id, finding_url, verdict, notes, created_at)
           SELECT user_id, scan_history_id, $2, $3, verdict, notes, created_at
             FROM scan_finding_feedback
            WHERE id = $1
           ON CONFLICT (user_id, finding_id, finding_url) DO NOTHING`,
          [row.id, key.findingId, key.findingUrl],
        );
        counts.feedback += res.rowCount ?? 0;
      }
      if (rows.length < PAGE) break;
      afterId = rows[rows.length - 1].id;
    }

    afterId = 0;
    for (;;) {
      const { rows } = await pool.query<{
        id: number;
        user_id: number;
        finding_id: string;
        finding_url: string;
      }>(
        `SELECT id, user_id, finding_id, finding_url
           FROM finding_remediation
          WHERE id > $1
          ORDER BY id
          LIMIT $2`,
        [afterId, PAGE],
      );
      for (const row of rows) {
        const key = await keyFor(pool, { ...row, scan_history_id: null });
        if (!key) continue;
        const res = await pool.query(
          `INSERT INTO finding_remediation
             (user_id, finding_id, finding_url, status, note, assignee, due_at, created_at, updated_at)
           SELECT user_id, $2, $3, status, note, assignee, due_at, created_at, updated_at
             FROM finding_remediation
            WHERE id = $1
           ON CONFLICT (user_id, finding_id, finding_url) DO NOTHING`,
          [row.id, key.findingId, key.findingUrl],
        );
        counts.remediation += res.rowCount ?? 0;
      }
      if (rows.length < PAGE) break;
      afterId = rows[rows.length - 1].id;
    }
  } catch (err) {
    logError(
      "scan",
      "Failed to carry triage over to the new finding ids (non-fatal)",
      err,
      { ...counts },
    );
  }
  return counts;
}
