import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { requireAdmin, logAction } from "@/lib/auth/authorization";
import { getClientIp } from "@/lib/api/request-utils";
import {
  CONFIG_PAGINATION_DEFAULT_PAGE_SIZE,
  CONFIG_PAGINATION_MAX_PAGE_SIZE,
} from "@/lib/config/config-values";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set(["sent", "failed", "skipped_not_configured"]);

interface EmailLogRow {
  id: number;
  recipient: string;
  subject: string;
  status: string;
  error_message: string | null;
  redacted_preview: string | null;
  created_at: string;
}

/**
 * GET /api/v3/admin/email-logs
 *
 * Paginated, most-recent-first record of every outbound email attempt
 * (AUDIT-010). Written by lib/email/email.ts's sendEmail() for every
 * email this app sends, so this is a complete record, not a sample.
 * `status` reflects the SMTP server's own accept/reject response --
 * plain SMTP gives no true inbox-delivery or read-receipt signal, so
 * "sent" means "accepted for delivery", not "the user has read it".
 * `redacted_preview` never contains a working link, code, or token (see
 * redactEmailPreview).
 *
 * Query params: page, limit, search (matches recipient or subject,
 * case-insensitive), status (sent|failed|skipped_not_configured).
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
  const statusParam = searchParams.get("status") || "";
  const status = VALID_STATUSES.has(statusParam) ? statusParam : "";
  const offset = (page - 1) * limit;

  try {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (search) {
      // Escape LIKE metacharacters so the search is exact-substring, not a
      // pattern. Without this a literal "_" matches any character and a bare
      // "%" degrades to a full scan of email_logs, one of the highest-volume
      // tables in the schema. Same one-liner the user and team searches use
      // (app/api/v3/admin/route.ts, app/api/v3/admin/teams/route.ts).
      params.push(`%${search.replace(/[\\%_]/g, "\\$&")}%`);
      conditions.push(
        `(recipient ILIKE $${params.length} ESCAPE '\\' OR subject ILIKE $${params.length} ESCAPE '\\')`,
      );
    }
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    // perf: COUNT(*) scans the whole matching set regardless of the sibling
    // LIMIT, so running it before the page query doubled the wall time of
    // every keystroke-driven reload. They are independent: run them together.
    const [countRes, rowsRes] = await Promise.all([
      pool.query<{ count: string }>(
        `SELECT COUNT(*) FROM email_logs ${whereClause}`,
        params,
      ),
      pool.query<EmailLogRow>(
        `SELECT id, recipient, subject, status, error_message, redacted_preview, created_at
       FROM email_logs
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
    ]);
    const total = parseInt(countRes.rows[0]?.count || "0", 10);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return NextResponse.json({
      logs: rowsRes.rows,
      page,
      totalPages,
      total,
    });
  } catch (error) {
    console.error("[admin/email-logs] Failed to fetch email logs:", error);
    return NextResponse.json(
      { error: "Failed to fetch email logs." },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/v3/admin/email-logs
 *
 * Clears every logged email attempt. A real destructive action --
 * confirmed client-side (see
 * components/admin/features/email-logs-manager.tsx) before this ever
 * fires -- and recorded to admin_audit_log like every other admin
 * bulk-delete in this codebase.
 */
export async function DELETE() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }

  try {
    const ip = await getClientIp();
    const result = await pool.query("DELETE FROM email_logs");
    const deletedCount = result.rowCount || 0;

    await logAction(
      admin.id,
      null,
      "email_logs_cleared",
      `Cleared ${deletedCount} email log entr${deletedCount === 1 ? "y" : "ies"}.`,
      ip,
    );

    return NextResponse.json({ success: true, deletedCount });
  } catch (error) {
    console.error("[admin/email-logs] Failed to clear email logs:", error);
    return NextResponse.json(
      { error: "Failed to clear email logs." },
      { status: 500 },
    );
  }
}
