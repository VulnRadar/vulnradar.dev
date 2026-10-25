import { NextRequest, NextResponse } from "next/server";
import { prepareMessageTranslation } from "@/lib/support/translate";
import { getUserLocale } from "@/lib/i18n/translate";
import pool from "@/lib/database/db";
import { getSession } from "@/lib/auth";
import { withErrorHandling } from "@/lib/api/api-utils";
import { getClientIp } from "@/lib/api/request-utils";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { TURNSTILE_ENABLED } from "@/lib/config/constants";
import {
  confirmTicketToUser,
  notifyStaffOfTicketActivity,
} from "@/lib/support/ticket-notify";
import {
  countTicketsAgainstCap,
  MAX_OPEN_TICKETS_PER_USER,
} from "@/lib/support/ticket-limits";
import {
  TICKET_CATEGORIES,
  TICKET_SUBJECT_MAX,
  TICKET_MESSAGE_MAX,
  type TicketCategory,
} from "@/lib/support/ticket-constants";
import { logError } from "@/lib/logging/log";

/** Rows returned per request. Named so the response can report it. */
const TICKET_LIST_LIMIT = 100;

/**
 * GET  /api/v3/support-tickets  -> the signed-in user's own tickets (newest first)
 * POST /api/v3/support-tickets  -> open a new ticket (available to every plan)
 *
 * A single ticket + its thread lives at /api/v3/support-tickets/[id]; the
 * staff-wide inbox is /api/v3/admin/support-tickets.
 */

export const GET = withErrorHandling(async () => {
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
});

export const POST = withErrorHandling(async (request: NextRequest) => {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Each ticket emails staff and the opener, and runs a language-detection
  // call on the operator's AI key, so how fast one account can open them is
  // bounded before anything else is paid for. Per user, not per IP: opening a
  // ticket needs a verified account. Checked ahead of Turnstile so a throttled
  // caller does not also cost a siteverify round trip per attempt.
  const rl = await checkRateLimit({
    key: `ticket-create:${session.userId}`,
    ...RATE_LIMITS.supportTicketCreate,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: `You are opening tickets too quickly. Please wait ${Math.ceil(
          rl.retryAfterSeconds / 60,
        )} minute(s) and try again.`,
      },
      { status: 429 },
    );
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
    const ip = await getClientIp();
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

  // Open tickets, plus the ones closed in the last day: closing a ticket does
  // not give its slot back, or open-close-open would never reach the cap.
  if (
    (await countTicketsAgainstCap(session.userId)) >= MAX_OPEN_TICKETS_PER_USER
  ) {
    return NextResponse.json(
      {
        error:
          "You have too many open or recently closed tickets. Please wait for a reply, or try again tomorrow.",
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

  const firstMessage = await pool.query<{ id: number }>(
    `INSERT INTO support_ticket_messages (ticket_id, author_user_id, is_staff, body)
     VALUES ($1, $2, FALSE, $3)
     RETURNING id`,
    [ticket.id, session.userId, message],
  );

  // Work out what language this was written in and put it in front of staff
  // in theirs, before anyone opens the ticket (lib/support/translate.ts).
  // Fire-and-forget: the ticket is filed either way.
  queueMicrotask(() => {
    void (async () => {
      await prepareMessageTranslation({
        messageId: firstMessage.rows[0].id,
        body: message,
        authorLocale: await getUserLocale(session.userId),
        // Staff have no single language, so this falls back to the
        // deployment's default one.
        counterpartLocales: [],
      });
    })().catch((err) => {
      logError("support", "ticket translation failed", err, {
        ticketId: ticket.id,
        messageId: firstMessage.rows[0]?.id,
      });
    });
  });

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
      logError("support", "ticket notifications failed", err, {
        ticketId: ticket.id,
      });
    }
  });

  return NextResponse.json({ ticket }, { status: 201 });
});
