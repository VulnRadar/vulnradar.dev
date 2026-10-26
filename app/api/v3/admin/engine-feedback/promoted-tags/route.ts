import { NextRequest } from "next/server";
import { logAction, requirePermission } from "@/lib/auth/authorization";
import { STAFF_PERMISSIONS } from "@/lib/auth/permissions-client";
import { ApiResponse, withErrorHandling } from "@/lib/api/api-utils";
import { getClientIp } from "@/lib/api/request-utils";
import { logError } from "@/lib/logging/log";
import {
  deletePromotedRule,
  listPromotedRules,
} from "@/lib/tags/promoted-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** promoted_auto_tag_rules.id is a SERIAL: anything past this is not a rule, and would be a Postgres error rather than a 404. */
const MAX_RULE_ID = 2_147_483_647;

/**
 * GET/DELETE /api/v3/admin/engine-feedback/promoted-tags
 *
 * The other half of ./ai-tag-candidates: that route turns an AI tag into an
 * auto-tag rule (POST), this one shows the rules now in effect and
 * takes one back out. A promoted rule labels every future scan of every user,
 * and it used to be a one-way door: an admin who saved the wrong CWE had no
 * list to see it in and no control to remove it.
 */
export const GET = withErrorHandling(async () => {
  const admin = await requirePermission(
    STAFF_PERMISSIONS.MANAGE_ENGINE_FEEDBACK,
  );
  if (!admin) return ApiResponse.forbidden("Admin access required.");

  try {
    return ApiResponse.success({ rules: await listPromotedRules() });
  } catch (error) {
    logError("admin", "failed to list promoted auto-tag rules", error, {
      adminId: admin.id,
    });
    return ApiResponse.serverError("Failed to load promoted rules.");
  }
});

/**
 * DELETE ?id=<rule id>. New scans stop receiving the tag; scans that already
 * carry it keep it. If enough AI-tagged scans still stand behind the tag it
 * returns to the candidate list, which is how a rule saved with the wrong
 * fields gets redone.
 */
export const DELETE = withErrorHandling(async (request: NextRequest) => {
  const admin = await requirePermission(
    STAFF_PERMISSIONS.MANAGE_ENGINE_FEEDBACK,
  );
  if (!admin) return ApiResponse.forbidden("Admin access required.");

  const raw = new URL(request.url).searchParams.get("id");
  const id = raw !== null && /^\d{1,10}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(id) || id <= 0 || id > MAX_RULE_ID) {
    return ApiResponse.badRequest("A valid rule id is required.");
  }

  let removed;
  try {
    removed = await deletePromotedRule(id);
  } catch (error) {
    logError("admin", "failed to remove a promoted auto-tag rule", error, {
      adminId: admin.id,
      ruleId: id,
    });
    return ApiResponse.serverError("Failed to remove the rule.");
  }
  if (!removed) return ApiResponse.notFound("No promoted rule with that id.");

  // The rule is gone and its cache dropped by now, so the audit write is
  // best-effort exactly as it is on promotion: a failed audit insert must not
  // report a removal that happened as one that did not. It is logged, because
  // this row is the only record of what the rule used to be. The target user
  // is null: the change is site-wide, not about one account.
  try {
    await logAction(
      admin.id,
      null,
      "demote_ai_tag",
      `Removed the promoted auto-tag rule "${removed.tag}" (min severity ${removed.minSeverity}, min count ${removed.minCount}, CWEs: ${removed.cwes.join(", ") || "none"}, categories: ${removed.categories.join(", ") || "none"})`,
      await getClientIp(),
    );
  } catch (error) {
    logError(
      "admin",
      "failed to write the demote_ai_tag audit row after removing a rule",
      error,
      { adminId: admin.id, ruleId: id },
    );
  }

  return ApiResponse.success({ success: true });
});
