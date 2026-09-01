import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { resolveScanRow } from "@/lib/history/resolve-scan";
import { getScanResourceAccess } from "@/lib/teams/scan-teams";

/**
 * PUT /api/v3/history/[id]/share/publicly-listed
 *
 * Per-share override for the Public Scans directory listing
 * (scan_history.share_publicly_listed), independent of whatever the
 * account-level default (users.share_publicly_listed_by_default) set it to
 * when the share was first created. Powers the "List publicly" / "Unlist"
 * action in the Shared page's row menu (components/shares/shares-row.tsx).
 *
 * Ownership + team-admin check mirrors POST/DELETE
 * app/api/v3/history/[id]/share/route.ts exactly: the scan owner, or a team
 * admin/owner acting on the scan owner's behalf, may flip this. Anyone else
 * gets a generic 404 -- scan existence is never leaked via a 403.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const publiclyListed = (body as Record<string, unknown> | null)
    ?.publiclyListed;

  if (typeof publiclyListed !== "boolean") {
    return NextResponse.json(
      { error: "publiclyListed must be a boolean" },
      { status: 400 },
    );
  }

  const scan = await resolveScanRow(id);

  if (!scan) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }

  // Listing a share publicly is a write action, scoped to the teams the scan
  // is shared with (owner-only for a personal scan). See the share route's
  // POST.
  if (scan.user_id !== session.userId) {
    const access = await getScanResourceAccess(session.userId, scan);
    if (!access.canWrite) {
      return NextResponse.json({ error: "Scan not found" }, { status: 404 });
    }
  }

  if (!scan.share_token) {
    return NextResponse.json(
      { error: "This scan has no active share link to list or unlist." },
      { status: 400 },
    );
  }

  await pool.query(
    "UPDATE scan_history SET share_publicly_listed = $1 WHERE id = $2",
    [publiclyListed, scan.id],
  );

  return NextResponse.json({ publiclyListed });
}
