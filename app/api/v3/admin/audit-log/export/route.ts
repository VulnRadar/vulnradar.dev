import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { requireAdmin, logAction } from "@/lib/auth/authorization";
import { getClientIp } from "@/lib/api/request-utils";
import { APP_SLUG } from "@/lib/config/constants";

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

function csvRows(rows: AuditExportRow[]): string {
  return rows
    .map((row) => CSV_COLUMNS.map((col) => csvField(row[col])).join(","))
    .join("\r\n");
}

/**
 * How many rows are read from the database at a time.
 *
 * The export is still the whole table. What changed is that the whole table is
 * no longer resident in this process at once. It used to be one unbounded
 * SELECT whose rows were then serialised into a single string, so a year of
 * admin history (retention is CONFIG_CLEANUP_ADMIN_AUDIT_LOG_RETENTION_DAYS,
 * 365 days) sat twice over in the heap of a single-process server before one
 * byte reached the client, and an admin pressing Export could take the site
 * down for everybody using it.
 */
const EXPORT_BATCH = 500;

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
  const ip = await getClientIp();

  /**
   * One page, keyset on the pair the rows are ordered by.
   *
   * Not OFFSET: it re-scans and discards everything already sent, so the last
   * page of a large export is the most expensive one. The pair rather than
   * created_at alone because created_at is not unique, and two actions
   * recorded in the same millisecond straddling a page boundary would
   * otherwise be emitted twice or not at all. Row comparison expresses that in
   * one index-friendly predicate.
   */
  const page = (after: { created_at: string; id: number } | null) =>
    pool.query<AuditExportRow>(
      `SELECT al.id, al.created_at, al.action, al.admin_id,
        au.email as admin_email, au.name as admin_name,
        al.target_user_id, tu.email as target_email, tu.name as target_name,
        al.ip_address, al.details
      FROM admin_audit_log al
      LEFT JOIN users au ON al.admin_id = au.id
      LEFT JOIN users tu ON al.target_user_id = tu.id
      WHERE $1::timestamptz IS NULL
         OR (al.created_at, al.id) < ($1::timestamptz, $2::int)
      ORDER BY al.created_at DESC, al.id DESC
      LIMIT $3`,
      [after?.created_at ?? null, after?.id ?? null, EXPORT_BATCH],
    );

  let firstPage;
  try {
    // Read the first page before the response starts. Once a chunk is out the
    // status is already 200 and a failure can only be delivered as truncated
    // output, so the one error a caller can actually be told about is this one.
    firstPage = await page(null);
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

  const encoder = new TextEncoder();
  let cursor: { created_at: string; id: number } | null = null;
  let pending: typeof firstPage | null = firstPage;
  let sent = 0;
  let finished = false;

  /**
   * Recorded when the stream ends rather than before it starts, because until
   * it drains nobody knows how much was actually exported, and the count is
   * the point of the entry: it says how much of the compliance record left the
   * building. A cancelled download logs what had already gone out.
   */
  const record = async () => {
    if (finished) return;
    finished = true;
    await logAction(
      admin.id,
      null,
      "audit_log_exported",
      `Exported ${sent} audit log entr${sent === 1 ? "y" : "ies"} as ${format.toUpperCase()}.`,
      ip,
    ).catch((err) =>
      console.error(
        "[admin/audit-log/export] Could not record the export:",
        err,
      ),
    );
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          format === "csv" ? `${CSV_COLUMNS.join(",")}\r\n` : "[\n",
        ),
      );
    },
    async pull(controller) {
      let rows: AuditExportRow[];
      try {
        rows = (pending ?? (await page(cursor))).rows;
      } catch (error) {
        console.error("[admin/audit-log/export] Failed mid-export:", error);
        // Aborts the response rather than closing it cleanly, so the client
        // sees a broken transfer instead of a file that looks complete and is
        // silently missing the rest of the record.
        controller.error(error);
        await record();
        return;
      }
      pending = null;

      if (rows.length === 0) {
        if (format === "json") controller.enqueue(encoder.encode("\n]\n"));
        controller.close();
        await record();
        return;
      }

      const last = rows[rows.length - 1];
      cursor = { created_at: last.created_at, id: last.id };

      if (format === "csv") {
        controller.enqueue(
          encoder.encode((sent === 0 ? "" : "\r\n") + csvRows(rows)),
        );
      } else {
        // Serialised row by row, so an array of every row never exists. The
        // result is still one valid JSON document.
        const body = rows.map((r) => JSON.stringify(r)).join(",\n  ");
        controller.enqueue(
          encoder.encode((sent === 0 ? "  " : ",\n  ") + body),
        );
      }
      sent += rows.length;
    },
    cancel: record,
  });

  const timestamp = new Date().toISOString().split("T")[0];
  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type":
        format === "csv"
          ? "text/csv; charset=utf-8"
          : "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${APP_SLUG}-audit-log-${timestamp}.${format}"`,
      // No Content-Length is known up front now, and buffering a streamed
      // download to compute one would undo the point of streaming it.
      "Cache-Control": "no-store",
    },
  });
}
