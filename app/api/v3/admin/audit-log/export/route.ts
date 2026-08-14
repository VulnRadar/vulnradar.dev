import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { requireAdmin, logAction } from "@/lib/auth/authorization";
import { getClientIp } from "@/lib/api/request-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AuditExportRow {
  id: number;
  created_at: string;
  action: string;
  admin_id: number;
  admin_email: string;
  admin_name: string | null;
  target_user_id: number | null;
  target_email: string | null;
  target_name: string | null;
  ip_address: string | null;
  details: string | null;
}

const CSV_COLUMNS: readonly (keyof AuditExportRow)[] = [
  "id",
  "created_at",
  "action",
  "admin_id",
  "admin_email",
  "admin_name",
  "target_user_id",
  "target_email",
  "target_name",
  "ip_address",
  "details",
];

/** RFC 4180 field quoting: quote (and escape embedded quotes) only when
 * the value contains a comma, quote, or newline -- matches every other
 * plain-value CSV writer in this codebase's conventions. */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: AuditExportRow[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((col) => csvField(row[col])).join(","));
  }
  return lines.join("\r\n");
}

/**
 * GET /api/v3/admin/audit-log/export?format=csv|json
 *
 * AUDIT-010 admin-feature-gap: the audit log is VulnRadar's compliance
 * record of admin actions but previously had no export at all. Returns
 * the FULL admin_audit_log table (not just the current page the UI has
 * loaded) as a downloadable CSV or JSON file. Admin-gated (stricter than
 * the moderator+ read access the paginated audit view itself uses) since
 * a full-table export is a meaningfully bigger exposure than a filtered
 * page view. The export itself is recorded as an audit action.
 */
export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") === "csv" ? "csv" : "json";

  try {
    const result = await pool.query<AuditExportRow>(
      `SELECT al.id, al.created_at, al.action, al.admin_id,
        au.email as admin_email, au.name as admin_name,
        al.target_user_id, tu.email as target_email, tu.name as target_name,
        al.ip_address, al.details
      FROM admin_audit_log al
      LEFT JOIN users au ON al.admin_id = au.id
      LEFT JOIN users tu ON al.target_user_id = tu.id
      ORDER BY al.created_at DESC`,
    );

    const ip = await getClientIp();
    const count = result.rows.length;
    await logAction(
      admin.id,
      null,
      "audit_log_exported",
      `Exported ${count} audit log entr${count === 1 ? "y" : "ies"} as ${format.toUpperCase()}.`,
      ip,
    );

    const timestamp = new Date().toISOString().split("T")[0];
    const body =
      format === "csv"
        ? toCsv(result.rows)
        : JSON.stringify(result.rows, null, 2);
    const contentType =
      format === "csv"
        ? "text/csv; charset=utf-8"
        : "application/json; charset=utf-8";

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="vulnradar-audit-log-${timestamp}.${format}"`,
      },
    });
  } catch (error) {
    console.error(
      "[admin/audit-log/export] Failed to export audit log:",
      error,
    );
    return NextResponse.json(
      { error: "Failed to export audit log." },
      { status: 500 },
    );
  }
}
