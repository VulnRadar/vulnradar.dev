import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import {
  requirePermission,
  requireAdmin,
  logAction,
} from "@/lib/auth/authorization";
import { STAFF_PERMISSIONS } from "@/lib/auth/permissions-client";
import { getClientIp } from "@/lib/api/request-utils";
import {
  CONFIG_PAGINATION_DEFAULT_PAGE_SIZE,
  CONFIG_PAGINATION_MAX_PAGE_SIZE,
} from "@/lib/config/config-values";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ErrorLogRow {
  id: number;
  message: string;
  detail: string | null;
  created_at: string;
}

/**
 * GET /api/v3/admin/error-logs
 *
 * Paginated, most-recent-first list of captured console.error calls. See
 * lib/database/error-log-capture.ts for the console.error interception
 * that populates system_error_logs. Powers Admin > System > Error Logs so
 * staff can see real application errors without shell/SSH access to the
 * server (see lib/database/cleanup.ts's "routine console.log status
 * drowns out errors" problem this whole feature exists to solve).
 *
 * Query params: page, limit, search (matches message or detail text,
 * case-insensitive).
 */
export async function GET(request: NextRequest) {
  const admin = await requirePermission(STAFF_PERMISSIONS.VIEW_ERROR_LOGS);
  if (!admin) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const requestedLimit = parseInt(
    searchParams.get("limit") || String(CONFIG_PAGINATION_DEFAULT_PAGE_SIZE),
    10,
  );
  const limit = Math.min(
    CONFIG_PAGINATION_MAX_PAGE_SIZE,
    Math.max(1, requestedLimit || CONFIG_PAGINATION_DEFAULT_PAGE_SIZE),
  );
  const search = (searchParams.get("search") || "").trim();
  const offset = (page - 1) * limit;

  try {
    const whereClause = search
      ? "WHERE message ILIKE $1 OR detail ILIKE $1"
      : "";
    const whereParams = search ? [`%${search}%`] : [];

    const countRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM system_error_logs ${whereClause}`,
      whereParams,
    );
    const total = parseInt(countRes.rows[0]?.count || "0", 10);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const rowsRes = await pool.query<ErrorLogRow>(
      `SELECT id, message, detail, created_at FROM system_error_logs
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${whereParams.length + 1} OFFSET $${whereParams.length + 2}`,
      [...whereParams, limit, offset],
    );

    return NextResponse.json({
      logs: rowsRes.rows,
      page,
      totalPages,
      total,
    });
  } catch (error) {
    console.error("[admin/error-logs] Failed to fetch error logs:", error);
    return NextResponse.json(
      { error: "Failed to fetch error logs." },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/v3/admin/error-logs
 *
 * Clears every captured error log row. A real destructive action --
 * confirmed client-side (see
 * components/admin/features/error-logs-manager.tsx) before this ever
 * fires -- and recorded to admin_audit_log like every other admin
 * bulk-delete in this codebase.
 */
export async function DELETE() {
  // Wiping the error-log trail is a destructive, audit-relevant action, so it
  // requires full admin -- not the VIEW_ERROR_LOGS read grant (which the
  // non-admin `ops` role holds and which correctly gates the GET above). A
  // view-only role must not be able to erase the log it can only read.
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }

  try {
    const ip = await getClientIp();
    const result = await pool.query("DELETE FROM system_error_logs");
    const deletedCount = result.rowCount || 0;

    await logAction(
      admin.id,
      null,
      "error_logs_cleared",
      `Cleared ${deletedCount} error log entr${deletedCount === 1 ? "y" : "ies"}.`,
      ip,
    );

    return NextResponse.json({ success: true, deletedCount });
  } catch (error) {
    console.error("[admin/error-logs] Failed to clear error logs:", error);
    return NextResponse.json(
      { error: "Failed to clear error logs." },
      { status: 500 },
    );
  }
}
