import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { getSession } from "@/lib/auth";
import { notifyStaffOfTicketActivity } from "@/lib/support/ticket-notify";
import {
  TICKET_CATEGORIES,
  TICKET_SUBJECT_MAX,
  TICKET_MESSAGE_MAX,
  type TicketCategory,
} from "@/lib/support/ticket-constants";

/**
 * GET  /api/v3/support-tickets  -> the signed-in user's own tickets (newest first)
 * POST /api/v3/support-tickets  -> open a new ticket (available to every plan)
 *
 * A single ticket + its thread lives at /api/v3/support-tickets/[id]; the
 * staff-wide inbox is /api/v3/admin/support-tickets.
 */

// A user may not stockpile open tickets. Resolved/closed ones don't count.
const MAX_OPEN_TICKETS_PER_USER = 20;

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await pool.query(
    `SELECT t.id, t.subject, t.category, t.status, t.created_at, t.last_message_at,
            (SELECT COUNT(*)::int FROM support_ticket_messages m WHERE m.ticket_id = t.id) AS message_count
     FROM support_tickets t
     WHERE t.user_id = $1
     ORDER BY t.last_message_at DESC
     LIMIT 100`,
    [session.userId],
  );
  return NextResponse.json({ tickets: result.rows });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { subject?: unknown; category?: unknown; message?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const category = (
    typeof body.category === "string" ? body.category : "other"
  ) as TicketCategory;

  if (!subject) {
    return NextResponse.json(
      { error: "A subject is required." },
      { status: 400 },
    );
  }
  if (subject.length > TICKET_SUBJECT_MAX) {
    return NextResponse.json(
      { error: `Subject must be ${TICKET_SUBJECT_MAX} characters or fewer.` },
      { status: 400 },
    );
  }
  if (!message) {
    return NextResponse.json(
      { error: "A message is required." },
      { status: 400 },
    );
  }
  if (message.length > TICKET_MESSAGE_MAX) {
    return NextResponse.json(
      { error: `Message must be ${TICKET_MESSAGE_MAX} characters or fewer.` },
      { status: 400 },
    );
  }
  if (!TICKET_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "Invalid category." }, { status: 400 });
  }

  const openCount = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM support_tickets
     WHERE user_id = $1 AND status IN ('open', 'awaiting_staff', 'awaiting_user')`,
    [session.userId],
  );
  if ((openCount.rows[0]?.n ?? 0) >= MAX_OPEN_TICKETS_PER_USER) {
    return NextResponse.json(
      {
        error:
          "You have too many open tickets. Please wait for a reply before opening another.",
      },
      { status: 429 },
    );
  }

  const inserted = await pool.query(
    `INSERT INTO support_tickets (user_id, subject, category, status)
     VALUES ($1, $2, $3, 'open')
     RETURNING id, subject, category, status, created_at, last_message_at`,
    [session.userId, subject, category],
  );
  const ticket = inserted.rows[0];

  await pool.query(
    `INSERT INTO support_ticket_messages (ticket_id, author_user_id, is_staff, body)
     VALUES ($1, $2, FALSE, $3)`,
    [ticket.id, session.userId, message],
  );

  // Fire-and-forget so the response returns immediately (same shape the
  // /api/v3/contact route uses for its outbound mail).
  queueMicrotask(() => {
    void notifyStaffOfTicketActivity({
      ticketId: ticket.id,
      subject,
      category,
      fromEmail: session.email,
      body: message,
      isNew: true,
    });
  });

  return NextResponse.json({ ticket }, { status: 201 });
}
