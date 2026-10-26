import pool from "@/lib/database/db";
import { maskEmail } from "@/lib/auth/authorization";
import { invalidatePromotedRulesCache } from "@/lib/tags/auto-tags";
import type { Category, Severity } from "@/lib/scanner/types";

/**
 * Admin-promoted auto-tag rules as an admin sees them: what is in effect, who
 * put it there, and the way to take it back out. The evaluation side (the
 * cached read that computeAutoTags merges into every scan) is
 * loadPromotedRules in lib/tags/auto-tags.ts; this is the management side,
 * served by app/api/v3/admin/engine-feedback/promoted-tags/route.ts.
 *
 * A promoted rule is the one place an admin can change what every future scan
 * of every user is labelled with, and for a long time it could be created and
 * never listed or removed, so a rule saved with the wrong CWE tagged scans
 * until someone deleted the row in SQL.
 */

export interface PromotedRule {
  id: number;
  tag: string;
  cwes: string[];
  categories: Category[];
  requireBoth: boolean;
  minSeverity: Severity;
  minCount: number;
  /** Display name of whoever promoted it, or null once that account is gone. */
  createdBy: string | null;
  createdAt: string;
}

/** What the audit row needs to record about a rule that no longer exists. */
export interface RemovedRule {
  tag: string;
  cwes: string[];
  categories: Category[];
  minSeverity: Severity;
  minCount: number;
}

interface PromotedRuleRow {
  id: number;
  tag: string;
  cwes: string[] | null;
  categories: Category[] | null;
  require_both: boolean;
  min_severity: Severity;
  min_count: number;
  created_at: Date | string;
  created_by_name: string | null;
  created_by_email: string | null;
}

interface RemovedRuleRow {
  tag: string;
  cwes: string[] | null;
  categories: Category[] | null;
  min_severity: Severity;
  min_count: number;
}

/**
 * Newest first, so the rule an admin just promoted is the first row they see.
 * That is the opposite of the order loadPromotedRules reads them in (oldest
 * first, which is the order they are applied); this list is for reading, not
 * for evaluation.
 *
 * The promoter shows by name, falling back to a masked address for an account
 * that never set one. LEFT JOIN because created_by is ON DELETE SET NULL: the
 * rule outlives the person.
 */
export async function listPromotedRules(): Promise<PromotedRule[]> {
  const { rows } = await pool.query<PromotedRuleRow>(
    `SELECT r.id, r.tag, r.cwes, r.categories, r.require_both,
            r.min_severity, r.min_count, r.created_at,
            u.name AS created_by_name, u.email AS created_by_email
       FROM promoted_auto_tag_rules r
       LEFT JOIN users u ON u.id = r.created_by
      ORDER BY r.created_at DESC, r.id DESC`,
  );
  return rows.map((row) => ({
    id: row.id,
    tag: row.tag,
    cwes: row.cwes ?? [],
    categories: row.categories ?? [],
    requireBoth: row.require_both,
    minSeverity: row.min_severity,
    minCount: row.min_count,
    createdBy: row.created_by_name?.trim()
      ? row.created_by_name.trim()
      : row.created_by_email
        ? maskEmail(row.created_by_email)
        : null,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
  }));
}

/**
 * Removes one rule and returns what it was, or null when no such rule exists.
 *
 * The row is deleted with RETURNING rather than read first and deleted after,
 * so two admins removing the same rule cannot both think they did it, and the
 * audit row can say what was removed from the one statement that removed it.
 *
 * The rule cache is dropped here, not by the caller: forgetting it would leave
 * the removed rule tagging scans for up to the cache's five minutes, and "it
 * is still tagging" is exactly the complaint removing a wrong rule is for.
 * The cache is per process, so on a deployment with several processes the
 * others pick the removal up when their own cache expires.
 *
 * Scans that already carry the tag keep it. Auto tags are written once, when
 * a scan completes, and are never recomputed.
 */
export async function deletePromotedRule(
  id: number,
): Promise<RemovedRule | null> {
  const { rows } = await pool.query<RemovedRuleRow>(
    `DELETE FROM promoted_auto_tag_rules
      WHERE id = $1
      RETURNING tag, cwes, categories, min_severity, min_count`,
    [id],
  );
  if (rows.length === 0) return null;
  invalidatePromotedRulesCache();
  const row = rows[0];
  return {
    tag: row.tag,
    cwes: row.cwes ?? [],
    categories: row.categories ?? [],
    minSeverity: row.min_severity,
    minCount: row.min_count,
  };
}
