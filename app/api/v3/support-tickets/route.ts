import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { getSession } from "@/lib/auth";
import { getClientIP } from "@/lib/rate-limiting/rate-limit";
import { TURNSTILE_ENABLED } from "@/lib/config/constants";
import {
  confirmTicketToUser,
  notifyStaffOfTicketActivity,
} from "@/lib/support/ticket-notify";
import {
  TICKET_CATEGORIES,
  TICKET_SUBJECT_MAX,
  TICKET_MESSAGE_MAX,
  type TicketCategory,
} from "@/lib/support/ticket-constants";

/** Rows returned per request. Named so the response can report it. */
const TICKET_LIST_LIMIT = 100;

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

  // The caller's own tickets, plus any a teammate explicitly shared with them.
  // `shared` flags the latter; `shared_owner_name` names who opened it.
  const result = await pool.query(
    `SELECT t.id, t.subject, t.category, t.status, t.created_at, t.last_message_at,
            (SELECT COUNT(*)::int FROM support_ticket_messages m WHERE m.ticket_id = t.id) AS message_count,
            (t.user_id <> $1) AS shared,
            CASE WHEN t.user_id <> $1 THEN ownu.name ELSE NULL END AS shared_owner_name
     FROM support_tickets t
     JOIN users ownu ON ownu.id = t.user_id
     WHERE t.user_id = $1
        OR t.id IN (
          -- The teammate relationship is re-checked here, not just when the
          -- share row was written. Nothing deletes the row when the membership
          -- ends, so a bare shared_with_user_id lookup kept an ex-teammate's
          -- stale ticket in their own list forever. Same guard as
          -- resolveTicketAccess (lib/support/ticket-access.ts).
          SELECT s.ticket_id FROM support_ticket_shares s
           WHERE s.shared_with_user_id = $1
             AND EXISTS (
                   SELECT 1 FROM team_members a
                   JOIN team_members b ON a.team_id = b.team_id
                   WHERE a.user_id = t.user_id AND b.user_id = $1
                 )
        )
     ORDER BY t.last_message_at DESC
     LIMIT $2`,
    [session.userId, TICKET_LIST_LIMIT],
  );
  // The cap is reported rather than silently applied, so a long-running
  // account can be told its history is truncated instead of just seeing it
  // stop (AUDIT-014#magic-20).
  return NextResponse.json({
    tickets: result.rows,
    limit: TICKET_LIST_LIMIT,
    truncated: result.rows.length === TICKET_LIST_LIMIT,
  });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    subject?: unknown;
    category?: unknown;
    message?: unknown;
    turnstileToken?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  // Cloudflare Turnstile: bot/abuse gate on ticket creation, verified the same
  // way /api/v3/contact does. No-op when Turnstile isn't configured.
  if (TURNSTILE_ENABLED) {
    const turnstileToken =
      typeof body.turnstileToken === "string" ? body.turnstileToken.trim() : "";
    if (!turnstileToken) {
      return NextResponse.json(
        { error: "Captcha verification required." },
        { status: 400 },
      );
    }
    const ip = await getClientIP();
    const turnstileRes = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: process.env.TURNSTILE_SECRET_KEY,
          response: turnstileToken,
          remoteip: ip,
        }),
      },
    );
    const turnstileData = await turnstileRes.json();
    if (!turnstileData.success) {
      return NextResponse.json(
        { error: "Captcha verification failed. Please try again." },
        { status: 400 },
      );
    }
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
  // A throw inside a queueMicrotask callback is an UNCAUGHT exception, not a
  // rejection a .catch() can take: it reaches process level and can end the
  // worker. The notification is the least important thing happening on this
  // request, so it gets the guard.
  queueMicrotask(() => {
    try {
      void notifyStaffOfTicketActivity({
        ticketId: ticket.id,
        subject,
        category,
        fromEmail: session.email,
        body: message,
        isNew: true,
      });
      // The public contact form has always confirmed receipt; the in-app form
      // did not, so a user had no record of the ticket number at all.
      void confirmTicketToUser({
        ticketId: ticket.id,
        subject,
        category,
        ownerEmail: session.email,
        body: message,
      });
    } catch (err) {
      console.error("Ticket notifications failed:", err);
    }
  });

  return NextResponse.json({ ticket }, { status: 201 });
}
