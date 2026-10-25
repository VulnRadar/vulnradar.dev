import { NextRequest, NextResponse } from "next/server";
import { logAction, requirePermission } from "@/lib/auth/authorization";
import {
  hasStaffPermission,
  STAFF_PERMISSIONS,
} from "@/lib/auth/permissions-client";
import { withErrorHandling } from "@/lib/api/api-utils";
import { getClientIp } from "@/lib/api/request-utils";
import { getAdminScanDetail } from "@/lib/admin/scan-detail";
import { logError } from "@/lib/logging/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v3/admin/scans/[id]
 *
 * One scan as staff see it: status, why it failed, the raw error, timings,
 * source, result_meta and the first findings. [id] is a public_id or a numeric
 * id, the same two shapes the owner's history routes accept.
 *
 * GET /api/v3/history/[id] answers 404 to anyone who is not the owner or a
 * teammate, staff included, so until this existed a "my scan failed" report
 * could not be looked at without database access. Gated on VIEW_ALL_SCANS,
 * the grant that already decides who may see another account's scans.
 *
 * Every read is audited as view_scan. A scan is what somebody chose to point a
 * scanner at, so opening one is the same kind of read as opening an account's
 * full record and gets the same trail. The audit write is best-effort: a
 * failed row must not turn a read into an error page, but it is logged.
 */
export const GET = withErrorHandling(
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const admin = await requirePermission(STAFF_PERMISSIONS.VIEW_ALL_SCANS);
    if (!admin) {
      return NextResponse.json(
        { error: "Admin access required." },
        { status: 403 },
      );
    }

    const { id } = await params;
    const scan = await getAdminScanDetail(id, {
      // The ops role may inspect scans but is deliberately kept away from
      // account data, so the owner is a bare id for it.
      includeUser: hasStaffPermission(admin.role, STAFF_PERMISSIONS.VIEW_USERS),
    });
    if (!scan) {
      return NextResponse.json({ error: "Scan not found." }, { status: 404 });
    }

    try {
      await logAction(
        admin.id,
        scan.user.id,
        "view_scan",
        `Inspected scan #${scan.id}`,
        await getClientIp(),
      );
    } catch (err) {
      logError("admin-scans", "Could not record a scan inspection", err, {
        scanId: scan.id,
        adminId: admin.id,
      });
    }

    return NextResponse.json({ scan });
  },
);
