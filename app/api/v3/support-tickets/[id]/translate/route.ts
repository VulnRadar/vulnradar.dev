import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { getSession } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import {
  resolveTicketAccess,
  viewerIsSupportStaff,
} from "@/lib/support/ticket-access";
import {
  translateTicketMessage,
  type TicketMessageRow,
} from "@/lib/support/translate";
import { getUserLocale } from "@/lib/i18n/translate";
import { isLocale } from "@/lib/i18n/config";

/**
 * POST /api/v3/support-tickets/[id]/translate
 *
 * One message of this ticket, in the caller's language. Answers from the
 * cache when the message has already been translated into it (see
 * lib/support/translate.ts), and stores what it generates so the next reader
 * of that language pays nothing and reads the same words.
 *
 * Whoever can read the ticket can translate it: the owner, a teammate it was
 * shared with, and support staff. The reply itself is never changed, so this
 * grants no one anything they could not already read.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: rawId } = await params;
  const ticketId = Number.parseInt(rawId, 10);
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return NextResponse.json({ error: "Invalid ticket id." }, { status: 400 });
  }

  let body: { messageId?: unknown; locale?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }
  const messageId = Number(body.messageId);
  if (!Number.isInteger(messageId) || messageId <= 0) {
    return NextResponse.json({ error: "Invalid message id." }, { status: 400 });
  }

  // The caller's own language unless they asked for another one, which is
  // what lets a staffer read a Japanese ticket in German if that is their
  // language.
  const target = isLocale(body.locale)
    ? body.locale
    : await getUserLocale(session.userId);

  const ticketRes = await pool.query<{ user_id: number }>(
    "SELECT user_id FROM support_tickets WHERE id = $1",
    [ticketId],
  );
  const ticket = ticketRes.rows[0];
  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }

  const access = await resolveTicketAccess({
    ticketOwnerId: ticket.user_id,
    ticketId,
    viewerId: session.userId,
    isStaff: await viewerIsSupportStaff(),
  });
  if (!access.canView) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }

  const messageRes = await pool.query<TicketMessageRow>(
    `SELECT id, body, body_locale, translations
       FROM support_ticket_messages
      WHERE id = $1 AND ticket_id = $2`,
    [messageId, ticketId],
  );
  const message = messageRes.rows[0];
  if (!message) {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }

  // Only a translation that has to be generated costs anything, so the limit
  // is checked after the cache, not before it.
  const cached = message.translations?.[target];
  if (!cached) {
    const rl = await checkRateLimit({
      key: `support-translate:${session.userId}`,
      ...RATE_LIMITS.aiSummary,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        {
          error: `Too many translations at once. Try again in ${Math.ceil(
            rl.retryAfterSeconds / 60,
          )} minute(s).`,
        },
        { status: 429 },
      );
    }
  }

  const result = await translateTicketMessage(message, target);
  if (!result) {
    return NextResponse.json(
      {
        error:
          "This message could not be translated. It is shown as it was written.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    messageId,
    locale: target,
    text: result.text,
    cached: result.cached,
  });
}
