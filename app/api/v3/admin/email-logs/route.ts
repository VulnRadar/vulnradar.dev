import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { requireAdmin, logAction } from "@/lib/auth/authorization";
import { getClientIp } from "@/lib/api/request-utils";
import { parsePagination } from "@/lib/api/pagination";
import { withErrorHandling } from "@/lib/api/api-utils";
import { logError } from "@/lib/logging/log";
import {
  FAILURE_WINDOW_HOURS,
  getRecentFailureReasons,
} from "@/lib/email/failure-reasons";

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
  template: string | null;
  created_at: string;
}

/**
 * The whole row, which is only fetched when an admin opens one. Everything a
 * rejection needs to be traced back to its template and its stage lives here:
 * which template produced the message, which From address and relay it went
 * out through, and what the relay answered and at which command.
 */
interface EmailLogDetailRow extends EmailLogRow {
  redacted_html: string | null;
  from_address: string | null;
  smtp_host: string | null;
  smtp_code: number | null;
  smtp_command: string | null;
  smtp_response: string | null;
  error_code: string | null;
  message_id: string | null;
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
 * Neither `redacted_preview` nor `redacted_html` contains a working
 * link, code, or token (see redactEmailPreview and redactEmailHtml).
 *
 * Query params: page, limit, search (matches recipient, subject, template or
 * the error text, case-insensitive), status (sent|failed|
 * skipped_not_configured), `id` for the single-row detail the viewer opens,
 * or `reasons=1` for the failures of the last day grouped by what the relay
 * said.
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);

  // Failures grouped by the reply that caused them, so a burst of one
  // rejection reads as one line with a count (lib/email/failure-reasons.ts).
  if (searchParams.get("reasons") === "1") {
    try {
      return NextResponse.json({
        windowHours: FAILURE_WINDOW_HOURS,
        reasons: await getRecentFailureReasons(),
      });
    } catch (error) {
      logError("admin-email-logs", "could not summarise failures", error);
      return NextResponse.json(
        { error: "Failed to summarise email failures." },
        { status: 500 },
      );
    }
  }

  // The rendered copy of a message is kilobytes of markup, so it is fetched
  // one row at a time when an admin actually opens one. Returning it on the
  // list would put twenty of them in a payload the search box refetches on
  // every keystroke.
  const idParam = searchParams.get("id");
  if (idParam !== null) {
    const id = parseInt(idParam, 10);
    if (!Number.isInteger(id) || id < 1) {
      return NextResponse.json({ error: "Invalid id." }, { status: 400 });
    }
    try {
      const detailRes = await pool.query<EmailLogDetailRow>(
        `SELECT id, recipient, subject, status, error_message, redacted_preview, redacted_html,
                template, from_address, smtp_host, smtp_code, smtp_command, smtp_response,
                error_code, message_id, created_at
           FROM email_logs
          WHERE id = $1`,
        [id],
      );
      const log = detailRes.rows[0];
      if (!log) {
        return NextResponse.json({ error: "Not found." }, { status: 404 });
      }
      return NextResponse.json({ log });
    } catch (error) {
      logError("admin-email-logs", "could not fetch an email log", error, {
        logId: id,
      });
      return NextResponse.json(
        { error: "Failed to fetch email log." },
        { status: 500 },
      );
    }
  }

  const { page, limit, offset } = parsePagination(searchParams);
  const search = (searchParams.get("search") || "").trim();
  const statusParam = searchParams.get("status") || "";
  const status = VALID_STATUSES.has(statusParam) ? statusParam : "";

  try {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (search) {
      // Escape LIKE metacharacters so the search is exact-substring, not a
      // pattern. Without this a literal "_" matches any character and a bare
      // "%" degrades to a full scan of email_logs, one of the highest-volume
      // tables in the schema. Same one-liner the user and team searches use
      // (app/api/v3/admin/route.ts, app/api/v3/admin/teams/route.ts).
      //
      // error_message and template are searchable because a delivery problem
      // is found by what the relay said ("SpamAssassin") or by which message
      // it was, and neither is in the subject or the recipient.
      params.push(`%${search.replace(/[\\%_]/g, "\\$&")}%`);
      const like = `$${params.length} ESCAPE '\\'`;
      conditions.push(
        `(recipient ILIKE ${like} OR subject ILIKE ${like} OR template ILIKE ${like} OR error_message ILIKE ${like})`,
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
        `SELECT id, recipient, subject, status, error_message, redacted_preview, template, created_at
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
    logError("admin-email-logs", "could not fetch email logs", error);
    return NextResponse.json(
      { error: "Failed to fetch email logs." },
      { status: 500 },
    );
  }
});

/**
 * DELETE /api/v3/admin/email-logs
 *
 * Clears every logged email attempt. A real destructive action --
 * confirmed client-side (see
 * components/admin/features/email-logs-manager.tsx) before this ever
 * fires -- and recorded to admin_audit_log like every other admin
 * bulk-delete in this codebase.
 */
export const DELETE = withErrorHandling(async () => {
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
    logError("admin-email-logs", "could not clear email logs", error);
    return NextResponse.json(
      { error: "Failed to clear email logs." },
      { status: 500 },
    );
  }
});
