import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { CONFIG_MAX_TAG_LENGTH } from "@/lib/config/config-values";
import { logAction, requirePermission } from "@/lib/auth/authorization";
import { STAFF_PERMISSIONS } from "@/lib/auth/permissions-client";
import { withErrorHandling } from "@/lib/api/api-utils";
import { getClientIp } from "@/lib/api/request-utils";
import { logError } from "@/lib/logging/log";
import {
  invalidatePromotedRulesCache,
  RESERVED_AUTO_TAG_NAMES,
} from "@/lib/tags/auto-tags";
import {
  loadAiTagCandidates,
  MAX_CANDIDATES,
  MIN_CANDIDATE_SCANS,
  RULE_SEVERITIES,
} from "@/lib/tags/ai-tag-candidates";
import {
  ALL_CATEGORIES,
  type Category,
  type Severity,
} from "@/lib/scanner/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/v3/admin/engine-feedback/ai-tag-candidates
 *
 * The admin-facing half of the layered auto-tag design (see
 * lib/tags/auto-tags.ts and lib/ai/auto-tag-suggest.ts's own comments).
 * GET lists the `scan_tags` rows with `source = 'ai'` -- tags
 * lib/ai/auto-tag-suggest.ts generated for a scan whose findings matched
 * none of the ~50 hardcoded AUTO_TAG_RULES -- grouped by tag text, so an
 * admin can see which AI-suggested concepts keep recurring across
 * distinct scans rather than showing up once and never again (the
 * aggregation is lib/tags/ai-tag-candidates.ts). POST
 * ("Promote") turns one candidate into a row in
 * `promoted_auto_tag_rules`: from then on, computeAutoTags matches it as a
 * real, free, deterministic rule (see lib/tags/auto-tags.ts's
 * loadPromotedRules), and lib/ai/auto-tag-suggest.ts never needs to be
 * called for that concept again (well, until a genuinely new scan trips a
 * concept the hardcoded rules AND every promoted rule still miss). A
 * promoted rule is listed, and can be removed, at ./promoted-tags.
 */

export const GET = withErrorHandling(async () => {
  const admin = await requirePermission(
    STAFF_PERMISSIONS.MANAGE_ENGINE_FEEDBACK,
  );
  if (!admin) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }

  try {
    const candidates = await loadAiTagCandidates();
    return NextResponse.json({
      candidates,
      minCandidateScans: MIN_CANDIDATE_SCANS,
      maxCandidates: MAX_CANDIDATES,
    });
  } catch (error) {
    logError("admin", "failed to load AI tag candidates", error, {
      adminId: admin.id,
    });
    return NextResponse.json(
      { error: "Failed to load AI tag candidates." },
      { status: 500 },
    );
  }
});

/** POST body for promoting a candidate into a rule. */
interface PromoteBody {
  tag?: unknown;
  cwes?: unknown;
  categories?: unknown;
  requireBoth?: unknown;
  minSeverity?: unknown;
  minCount?: unknown;
}

// Was a hardcoded 50, against a column the scan-tags route caps at the
// admin-editable MAX_TAG_LENGTH setting (shipped default 30). Three limits
// existed for one scan_tags.tag column (30 here, 40 in the AI suggester, 50
// in this route), and this was the copy that told the operator the wrong
// number in its own validation message.
const MAX_TAG_LENGTH = CONFIG_MAX_TAG_LENGTH;

export const POST = withErrorHandling(async (request: NextRequest) => {
  const admin = await requirePermission(
    STAFF_PERMISSIONS.MANAGE_ENGINE_FEEDBACK,
  );
  if (!admin) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }

  let body: PromoteBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const tag = typeof body.tag === "string" ? body.tag.trim() : "";
  if (!tag || tag.length > MAX_TAG_LENGTH) {
    return NextResponse.json(
      { error: `A tag name (1-${MAX_TAG_LENGTH} characters) is required.` },
      { status: 400 },
    );
  }
  // A promoted rule sharing a tag name (case-insensitively) with a
  // hardcoded rule or a holistic tag ("Critical Exposure"/"Clean"/"Needs
  // Hardening") builds a scan_tags INSERT with two rows for the same
  // (scan_id, tag) on any scan matching both -- Postgres rejects that
  // outright, silently leaving the scan stuck at pending/running forever
  // with its results discarded (computeAutoTags dedupes as a backstop,
  // but rejecting the collision here is clearer: at promotion time, not
  // whenever a scan happens to trip it).
  if (RESERVED_AUTO_TAG_NAMES.has(tag.toLowerCase())) {
    return NextResponse.json(
      {
        error: `"${tag}" is already a built-in tag name. Choose a different name for this rule.`,
      },
      { status: 400 },
    );
  }

  const cwes = Array.isArray(body.cwes)
    ? body.cwes.filter(
        (c): c is string => typeof c === "string" && /^CWE-\d+$/.test(c),
      )
    : [];
  const categories = Array.isArray(body.categories)
    ? body.categories.filter((c): c is Category =>
        ALL_CATEGORIES.includes(c as Category),
      )
    : [];

  if (cwes.length === 0 && categories.length === 0) {
    return NextResponse.json(
      { error: "At least one CWE or category is required." },
      { status: 400 },
    );
  }

  const minSeverity = body.minSeverity as Severity;
  if (!RULE_SEVERITIES.includes(minSeverity)) {
    return NextResponse.json(
      { error: "A valid minSeverity is required." },
      { status: 400 },
    );
  }

  const minCount =
    typeof body.minCount === "number" &&
    Number.isInteger(body.minCount) &&
    body.minCount > 0
      ? body.minCount
      : 1;

  try {
    await pool.query(
      `INSERT INTO promoted_auto_tag_rules
         (tag, cwes, categories, require_both, min_severity, min_count, source_ai_tag, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tag) DO UPDATE SET
         cwes = EXCLUDED.cwes,
         categories = EXCLUDED.categories,
         require_both = EXCLUDED.require_both,
         min_severity = EXCLUDED.min_severity,
         min_count = EXCLUDED.min_count`,
      [
        tag,
        cwes.length > 0 ? JSON.stringify(cwes) : null,
        categories.length > 0 ? JSON.stringify(categories) : null,
        Boolean(body.requireBoth),
        minSeverity,
        minCount,
        tag,
        admin.id,
      ],
    );

    // So the very next scan already sees this rule, instead of waiting out
    // lib/tags/auto-tags.ts's DB_RULES_CACHE_TTL_MS.
    invalidatePromotedRulesCache();

    // Promoting a tag changes what the scanner labels every future scan
    // with, for every user, and the ON CONFLICT above silently rewrites an
    // existing rule. promoted_auto_tag_rules.created_by keeps the original
    // author and is not touched on an update, so without this row the
    // second person to edit a rule left no trace at all. A target user id
    // would be meaningless: the change is site-wide, not about one account.
    //
    // Written after the rule and best-effort, the same shape the backup
    // route uses: the promotion has already committed by this point, so a
    // failed audit write must not be reported as a failed promotion.
    try {
      await logAction(
        admin.id,
        null,
        "promote_ai_tag",
        `Promoted the AI tag "${tag}" to an auto-tag rule (min severity ${minSeverity}, min count ${minCount}, CWEs: ${cwes.join(", ") || "none"}, categories: ${categories.join(", ") || "none"})`,
        await getClientIp(),
      );
    } catch (err) {
      logError(
        "admin",
        "failed to write the promote_ai_tag audit row after promoting a rule",
        err,
        { adminId: admin.id },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logError("admin", "failed to promote an AI tag to a rule", error, {
      adminId: admin.id,
    });
    return NextResponse.json(
      { error: "Failed to promote tag." },
      { status: 500 },
    );
  }
});
