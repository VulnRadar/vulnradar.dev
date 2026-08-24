import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { getSession } from "@/lib/auth";
import {
  hasStaffPermission,
  STAFF_PERMISSIONS,
} from "@/lib/auth/permissions-client";
import {
  notifyStaffOfTicketActivity,
  notifyUserOfStaffReply,
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
 * Staff status is taken from the session role (getSession re-reads it from the
 * users table), which is enough for a support surface -- the admin inbox list
 * route uses requirePermission for the stricter gate.
 */

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
  const isStaff = hasStaffPermission(
    session.role,
    STAFF_PERMISSIONS.MANAGE_SUPPORT_TICKETS,
  );
  const isOwner = ticket.user_id === session.userId;
  if (!isOwner && !isStaff) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }

  const messagesRes = await pool.query<{
    id: number;
    is_staff: boolean;
    body: string;
    created_at: string;
    author_name: string | null;
  }>(
    `SELECT m.id, m.is_staff, m.body, m.created_at, u.name AS author_name
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
    // A user viewing their own ticket sees staff replies as "Support", never a
    // staffer's real name. Staff viewers see everyone's name.
    authorName: m.is_staff && !isStaff ? null : m.author_name,
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
      ...(isStaff
        ? { ownerEmail: ticket.owner_email, ownerName: ticket.owner_name }
        : {}),
    },
    messages,
    viewerIsStaff: isStaff,
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

  const ticket = await loadTicket(id);
  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }
  const isStaff = hasStaffPermission(
    session.role,
    STAFF_PERMISSIONS.MANAGE_SUPPORT_TICKETS,
  );
  const isOwner = ticket.user_id === session.userId;
  if (!isOwner && !isStaff) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }
  if (ticket.status === "closed") {
    return NextResponse.json(
      { error: "This ticket is closed. Open a new ticket to continue." },
      { status: 409 },
    );
  }

  // A staffer replying to someone else's ticket acts as staff; a staffer
  // replying to their OWN ticket is just a user.
  const actingAsStaff = isStaff && !isOwner;
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
  const isStaff = hasStaffPermission(
    session.role,
    STAFF_PERMISSIONS.MANAGE_SUPPORT_TICKETS,
  );
  const isOwner = ticket.user_id === session.userId;
  if (!isOwner && !isStaff) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }
  // A ticket owner may only resolve or close their own ticket. Staff may move it
  // to any state (e.g. reopen to awaiting_user).
  if (!isStaff && status !== "resolved" && status !== "closed") {
    return NextResponse.json(
      { error: "You can only resolve or close your own ticket." },
      { status: 403 },
    );
  }

  await pool.query(
    `UPDATE support_tickets SET status = $1, updated_at = NOW() WHERE id = $2`,
    [status, id],
  );
  return NextResponse.json({ status });
}
