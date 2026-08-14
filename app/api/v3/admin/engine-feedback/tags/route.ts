import { NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { requirePermission } from "@/lib/auth/authorization";
import { STAFF_PERMISSIONS } from "@/lib/auth/permissions-client";
import { getSetting } from "@/lib/config/runtime-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TagRuleCountRow {
  tag: string;
  applied_count: number;
  dismissed_count: number;
}

export interface TagDismissalEntry {
  tag: string;
  /** Every scan this auto-tag rule has ever fired on, dismissed or not. */
  totalFired: number;
  dismissedCount: number;
  /** 0-100, one decimal place. */
  dismissalRate: number;
  flagged: boolean;
}

/**
 * GET /api/v3/admin/engine-feedback/tags
 *
 * Aggregates auto_tag_dismissals (see app/api/v3/scan/tags/route.ts's
 * "remove" branch) into a per-auto-tag-rule dismissal rate: of every scan
 * this lib/tags/auto-tags.ts rule ever fired on, what fraction did a real
 * user tell us was wrong. A human-in-the-loop signal for retuning that
 * rule's CWE/category/severity match, never applied automatically.
 *
 * Dismissing an auto tag DELETES its scan_tags row (see that route), so
 * "how many times did this rule ever fire" can't be read off scan_tags
 * alone -- it undercounts by exactly the dismissed ones. totalFired adds
 * the still-attached count (scan_tags) back to the dismissed count
 * (auto_tag_dismissals) to reconstruct it.
 */
export async function GET() {
  const admin = await requirePermission(
    STAFF_PERMISSIONS.MANAGE_ENGINE_FEEDBACK,
  );
  if (!admin) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }

  const [thresholdPercent, minSampleSize] = await Promise.all([
    getSetting("ENGINE_FEEDBACK_NOISE_THRESHOLD_PERCENT"),
    getSetting("ENGINE_FEEDBACK_MIN_SAMPLE_SIZE"),
  ]);

  try {
    const result = await pool.query<TagRuleCountRow>(
      `WITH applied AS (
         SELECT tag, COUNT(*)::int AS applied_count
         FROM scan_tags WHERE source = 'auto' GROUP BY tag
       ), dismissed AS (
         SELECT tag, COUNT(*)::int AS dismissed_count
         FROM auto_tag_dismissals GROUP BY tag
       )
       SELECT COALESCE(a.tag, d.tag) AS tag,
              COALESCE(a.applied_count, 0) AS applied_count,
              COALESCE(d.dismissed_count, 0) AS dismissed_count
       FROM applied a
       FULL OUTER JOIN dismissed d ON a.tag = d.tag`,
    );

    const tags: TagDismissalEntry[] = result.rows.map((row) => {
      const totalFired = row.applied_count + row.dismissed_count;
      const dismissalRate =
        totalFired > 0
          ? Math.round((row.dismissed_count / totalFired) * 1000) / 10
          : 0;
      return {
        tag: row.tag,
        totalFired,
        dismissedCount: row.dismissed_count,
        dismissalRate,
        flagged:
          totalFired >= minSampleSize && dismissalRate >= thresholdPercent,
      };
    });

    tags.sort(
      (a, b) =>
        b.dismissalRate - a.dismissalRate || b.totalFired - a.totalFired,
    );

    return NextResponse.json({ tags, thresholdPercent, minSampleSize });
  } catch (error) {
    console.error(
      "[admin/engine-feedback/tags] Failed to aggregate auto-tag dismissals:",
      error,
    );
    return NextResponse.json(
      { error: "Failed to load auto-tag dismissal data." },
      { status: 500 },
    );
  }
}
