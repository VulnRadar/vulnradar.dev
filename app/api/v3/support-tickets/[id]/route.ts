import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { getSession } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { resolveTicketAccess } from "@/lib/support/ticket-access";
import { requirePermission } from "@/lib/auth/authorization";
import { STAFF_PERMISSIONS } from "@/lib/auth/permissions-client";
import {
  notifyStaffOfTicketActivity,
  notifyUserOfStaffReply,
  notifyUserOfTicketStatus,
} from "@/lib/support/ticket-notify";
import {
  TICKET_MESSAGE_MAX,
  TICKET_STATUSES,
  type TicketCategory,
  type TicketStatus,
} from "@/lib/support/ticket-constants";

/**
 * GET   /api/v3/support-tickets/[id]  -> a ticket + its full message thread
 * POST  /api/v3/support-tickets/[id]  -> add a reply
 * PATCH /api/v3/support-tickets/[id]  -> change status (resolve/close/reopen)
 *
 * Access: the ticket's owner, or any staffer with MANAGE_SUPPORT_TICKETS.
 * Staff status goes through requirePermission, the same gate the admin inbox
 * list route uses. It used to be read straight off the session role, which
 * skipped passesTwoFactorEnforcement: with ENFORCE_STAFF_2FA on, a staff
 * account without 2FA was locked out of /api/v3/admin but could still read
 * every customer's thread here (owner email included) and reply to customers
 * as "Support". That is exactly the blast radius the toggle exists to close.
 */

/**
 * Whether the CURRENT caller is support staff for ticket purposes, with the
 * ENFORCE_STAFF_2FA gate applied. requirePermission returns null both for a
 * non-staff account and for a staff account the 2FA enforcement is blocking,
 * which is the behaviour we want here: neither gets staff reach.
 */
async function viewerIsSupportStaff(): Promise<boolean> {
  const staff = await requirePermission(
    STAFF_PERMISSIONS.MANAGE_SUPPORT_TICKETS,
  );
  return staff !== null;
}

interface TicketRow {
  id: number;
  user_id: number;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  owner_email: string;
  owner_name: string | null;
}

async function loadTicket(id: number): Promise<TicketRow | null> {
  const res = await pool.query<TicketRow>(
    `SELECT t.id, t.user_id, t.subject, t.category, t.status, t.created_at,
            t.updated_at, t.last_message_at,
            u.email AS owner_email, u.name AS owner_name
     FROM support_tickets t
     JOIN users u ON u.id = t.user_id
     WHERE t.id = $1`,
    [id],
  );
  return res.rows[0] ?? null;
}

function parseId(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (id === null) {
    return NextResponse.json({ error: "Invalid ticket id." }, { status: 400 });
  }

  const ticket = await loadTicket(id);
  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }
  const access = await resolveTicketAccess({
    ticketOwnerId: ticket.user_id,
    ticketId: id,
    viewerId: session.userId,
    isStaff: await viewerIsSupportStaff(),
  });
  if (!access.canView) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }

  const messagesRes = await pool.query<{
    id: number;
    is_staff: boolean;
    body: string;
    created_at: string;
    author_name: string | null;
    author_user_id: number | null;
  }>(
    `SELECT m.id, m.is_staff, m.body, m.created_at, m.author_user_id, u.name AS author_name
     FROM support_ticket_messages m
     LEFT JOIN users u ON u.id = m.author_user_id
     WHERE m.ticket_id = $1
     ORDER BY m.created_at ASC`,
    [id],
  );

  const messages = messagesRes.rows.map((m) => ({
    id: m.id,
    isStaff: m.is_staff,
    body: m.body,
    createdAt: m.created_at,
    // The viewer's own messages render as "You"; a shared teammate or the owner
    // sees each other's names on the non-staff replies.
    mine: m.author_user_id === session.userId,
    // A non-staff viewer sees staff replies as "Support", never a staffer's real
    // name. Staff viewers see everyone's name.
    authorName: m.is_staff && !access.isStaff ? null : m.author_name,
  }));

  return NextResponse.json({
    ticket: {
      id: ticket.id,
      subject: ticket.subject,
      category: ticket.category,
      status: ticket.status,
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at,
      lastMessageAt: ticket.last_message_at,
      // Owner identity is only exposed to staff.
      ...(access.isStaff
        ? { ownerEmail: ticket.owner_email, ownerName: ticket.owner_name }
        : {}),
    },
    messages,
    viewerIsStaff: access.isStaff,
    viewerIsOwner: access.isOwner,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (id === null) {
    return NextResponse.json({ error: "Invalid ticket id." }, { status: 400 });
  }

  let body: { message?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
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

  // Each reply emails the other party (staff or the owner), so cap how fast one
  // user can post replies. Per-user, not per-IP: replies are authenticated.
  const rl = await checkRateLimit({
    key: `ticket-reply:${session.userId}`,
    ...RATE_LIMITS.api,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: `Too many replies. Please wait ${Math.ceil(
          rl.retryAfterSeconds / 60,
        )} minute(s) and try again.`,
      },
      { status: 429 },
    );
  }

  const ticket = await loadTicket(id);
  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }
  const access = await resolveTicketAccess({
    ticketOwnerId: ticket.user_id,
    ticketId: id,
    viewerId: session.userId,
    isStaff: await viewerIsSupportStaff(),
  });
  if (!access.canView) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }
  if (ticket.status === "closed") {
    return NextResponse.json(
      { error: "This ticket is closed. Open a new ticket to continue." },
      { status: 409 },
    );
  }

  // A staffer replying to someone else's ticket acts as staff; the owner and any
  // shared teammate reply as ordinary participants.
  const actingAsStaff = access.isStaff && !access.isOwner;
  // Staff reply -> waiting on the user. User reply -> waiting on staff (and a
  // reply on a resolved ticket reopens it).
  const newStatus: TicketStatus = actingAsStaff
    ? "awaiting_user"
    : "awaiting_staff";

  const inserted = await pool.query<{
    id: number;
    is_staff: boolean;
    body: string;
    created_at: string;
  }>(
    `INSERT INTO support_ticket_messages (ticket_id, author_user_id, is_staff, body)
     VALUES ($1, $2, $3, $4)
     RETURNING id, is_staff, body, created_at`,
    [id, session.userId, actingAsStaff, message],
  );
  await pool.query(
    `UPDATE support_tickets SET status = $1, last_message_at = NOW(), updated_at = NOW() WHERE id = $2`,
    [newStatus, id],
  );

  queueMicrotask(() => {
    try {
      if (actingAsStaff) {
        void notifyUserOfStaffReply({
          ticketId: id,
          subject: ticket.subject,
          ownerUserId: ticket.user_id,
          ownerEmail: ticket.owner_email,
          body: message,
        });
      } else {
        void notifyStaffOfTicketActivity({
          ticketId: id,
          subject: ticket.subject,
          category: ticket.category,
          fromEmail: session.email,
          body: message,
          isNew: false,
        });
      }
    } catch (err) {
      console.error("Ticket reply notification failed:", err);
    }
  });

  const m = inserted.rows[0];
  return NextResponse.json(
    {
      message: {
        id: m.id,
        isStaff: m.is_staff,
        body: m.body,
        createdAt: m.created_at,
        authorName: actingAsStaff ? null : (session.name ?? null),
      },
      status: newStatus,
    },
    { status: 201 },
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (id === null) {
    return NextResponse.json({ error: "Invalid ticket id." }, { status: 400 });
  }

  let body: { status?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }
  const status = body.status as TicketStatus;
  if (!TICKET_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  const ticket = await loadTicket(id);
  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }
  const access = await resolveTicketAccess({
    ticketOwnerId: ticket.user_id,
    ticketId: id,
    viewerId: session.userId,
    isStaff: await viewerIsSupportStaff(),
  });
  if (!access.canView) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }
  // Only the owner or staff change status; a shared teammate can read/reply but
  // not resolve, close, or reopen someone else's ticket.
  if (!access.isOwner && !access.isStaff) {
    return NextResponse.json(
      { error: "Only the ticket owner can change its status." },
      { status: 403 },
    );
  }
  // A ticket owner may resolve or close their own ticket, and may reopen one
  // they resolved. Staff may move it to any state.
  //
  // The reopen arm is not a new capability: POST on this route already sets
  // awaiting_staff when the owner replies, and its own comment calls that
  // "a reply on a resolved ticket reopens it". The owner could therefore
  // always reopen a resolved ticket, just never without typing a message
  // first, and the UI offered no way to say "this is not fixed" on its own
  // (AUDIT-011#drift-21). `closed` stays terminal for the owner on purpose:
  // that state is signposted as final ("Open a new ticket to continue") and
  // POST refuses to reply to it, so only staff bring one back.
  const ownerMayReopen =
    ticket.status === "resolved" && status === "awaiting_staff";
  if (
    !access.isStaff &&
    status !== "resolved" &&
    status !== "closed" &&
    !ownerMayReopen
  ) {
    return NextResponse.json(
      { error: "You can only resolve or close your own ticket." },
      { status: 403 },
    );
  }

  await pool.query(
    `UPDATE support_tickets SET status = $1, updated_at = NOW() WHERE id = $2`,
    [status, id],
  );

  // The mirror of the arm below. Staff resolving or closing a ticket without a
  // final reply is the commonest way a ticket ends, and it was silent: the
  // owner learned about it only by reopening the page, and never learned that
  // replying reopens it. Only a staff-initiated change sends, because an owner
  // who resolved their own ticket does not need to be told they did.
  if (access.isStaff && !access.isOwner) {
    queueMicrotask(() => {
      try {
        void notifyUserOfTicketStatus({
          ticketId: id,
          subject: ticket.subject,
          ownerEmail: ticket.owner_email,
          status,
        });
      } catch (err) {
        console.error("Ticket status notification failed:", err);
      }
    });
  }

  // A reopen with no message would otherwise slide back into the queue with
  // nothing to announce it: the reply path notifies staff, so this one has to
  // as well or "reopen" means "hope somebody rechecks the list". Fire and
  // forget, exactly like the reply path's own notification.
  if (ownerMayReopen) {
    queueMicrotask(() => {
      void notifyStaffOfTicketActivity({
        ticketId: id,
        subject: ticket.subject,
        category: ticket.category,
        fromEmail: session.email,
        body: "Reopened this ticket: the issue is not resolved.",
        isNew: false,
      });
    });
  }

  return NextResponse.json({ status });
}
