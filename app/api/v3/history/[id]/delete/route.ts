import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { resolveScanRow } from "@/lib/history/resolve-scan";

export async function DELETE(
  _request: NextRequest,
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

  // Get the scan to verify ownership (by opaque public_id, or a legacy id).
  const scan = await resolveScanRow(id);

  if (!scan) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }

  // Only the owner can delete their own scans
  if (scan.user_id !== session.userId) {
    return NextResponse.json(
      { error: "Only the scan owner can delete it" },
      { status: 403 },
    );
  }

  // Delete the scan from the database. The WHERE clause re-checks ownership
  // itself (not just the earlier if-check above) so a future refactor of the
  // guard above can't turn this into a delete-any-scan-by-id endpoint.
  try {
    // Purge the public reputation cache this scan populated BEFORE deleting the
    // scan row -- deleting scan_history first nulls host_reputation.source_scan_id
    // via cascade, orphaning the findings copy so it keeps serving on the
    // unauthenticated /host and reputation endpoints. Mirrors the private-toggle
    // purge in ../route.ts. No-op when this scan didn't source a reputation row.
    await pool.query(`DELETE FROM host_reputation WHERE source_scan_id = $1`, [
      scan.id,
    ]);
    await pool.query(
      `DELETE FROM scan_history WHERE id = $1 AND user_id = $2`,
      [scan.id, session.userId],
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete scan:", error);
    return NextResponse.json(
      { error: "Failed to delete scan" },
      { status: 500 },
    );
  }
}
