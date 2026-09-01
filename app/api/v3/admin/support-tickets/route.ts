import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { requirePermission } from "@/lib/auth/authorization";
import { STAFF_PERMISSIONS } from "@/lib/auth/permissions-client";
import {
  TICKET_STATUSES,
  type TicketStatus,
} from "@/lib/support/ticket-constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v3/admin/support-tickets
 *
 * Staff inbox: every user's support ticket, newest activity first. Gated on
 * MANAGE_SUPPORT_TICKETS (support role and up). Reading/replying to an
 * individual ticket goes through /api/v3/support-tickets/[id], which admits
 * staff too. Optional ?status=<one of TICKET_STATUSES> filter; by default it
 * hides resolved/closed so the queue shows what still needs attention.
 */
export async function GET(request: NextRequest) {
  const staff = await requirePermission(
    STAFF_PERMISSIONS.MANAGE_SUPPORT_TICKETS,
  );
  if (!staff) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }

  try {
    const statusParam = request.nextUrl.searchParams.get("status");
    let whereClause = `WHERE t.status IN ('open', 'awaiting_staff', 'awaiting_user')`;
    const values: unknown[] = [];
    if (statusParam === "all") {
      whereClause = "";
    } else if (
      statusParam &&
      TICKET_STATUSES.includes(statusParam as TicketStatus)
    ) {
      whereClause = `WHERE t.status = $1`;
      values.push(statusParam);
    }

    // perf: the GROUP BY count reads every support_tickets row and does not
    // depend on the listing, so it used to add a second full pass in series
    // with the page query on every inbox load. Independent queries, one wait.
    const [result, counts] = await Promise.all([
      pool.query(
        `SELECT t.id, t.subject, t.category, t.status, t.created_at, t.last_message_at,
              u.id AS owner_id, u.email AS owner_email, u.name AS owner_name,
              (SELECT COUNT(*)::int FROM support_ticket_messages m WHERE m.ticket_id = t.id) AS message_count,
              (SELECT m2.body FROM support_ticket_messages m2 WHERE m2.ticket_id = t.id ORDER BY m2.created_at DESC LIMIT 1) AS last_message
       FROM support_tickets t
       JOIN users u ON u.id = t.user_id
       ${whereClause}
       ORDER BY t.last_message_at DESC
       LIMIT 200`,
        values,
      ),
      pool.query<{ status: TicketStatus; n: number }>(
        `SELECT status, COUNT(*)::int AS n FROM support_tickets GROUP BY status`,
      ),
    ]);

    return NextResponse.json({
      tickets: result.rows,
      counts: Object.fromEntries(counts.rows.map((r) => [r.status, r.n])),
    });
  } catch (error) {
    console.error(
      "[admin/support-tickets] Failed to list tickets:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Failed to load support tickets." },
      { status: 500 },
    );
  }
}
