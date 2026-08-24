import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { getSession } from "@/lib/auth";
import { areTeammates } from "@/lib/support/ticket-access";

/**
 * Manage who a ticket is shared with. Owner-only, and a ticket can only be
 * shared with a TEAMMATE (someone who shares a team with the owner), one at a
 * time -- never a whole team, never an arbitrary account.
 *
 * GET    -> { shares: [...currently shared], eligible: [...teammates not yet shared] }
 * POST   { userId } -> share with that teammate
 * DELETE ?userId=N  -> stop sharing with that user
 */

function parseId(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function requireOwner(
  ticketId: number,
  userId: number,
): Promise<"ok" | "not_found" | "forbidden"> {
  const res = await pool.query<{ user_id: number }>(
    `SELECT user_id FROM support_tickets WHERE id = $1`,
    [ticketId],
  );
  const row = res.rows[0];
  if (!row) return "not_found";
  return row.user_id === userId ? "ok" : "forbidden";
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
  const gate = await requireOwner(id, session.userId);
  if (gate === "not_found") {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }
  if (gate === "forbidden") {
    return NextResponse.json(
      { error: "Only the ticket owner can manage sharing." },
      { status: 403 },
    );
  }

  const shares = await pool.query<{
    user_id: number;
    email: string;
    name: string | null;
  }>(
    `SELECT s.shared_with_user_id AS user_id, u.email, u.name
     FROM support_ticket_shares s
     JOIN users u ON u.id = s.shared_with_user_id
     WHERE s.ticket_id = $1
     ORDER BY u.email`,
    [id],
  );

  // Teammates (share a team with the owner) not already shared with.
  const eligible = await pool.query<{
    id: number;
    email: string;
    name: string | null;
  }>(
    `SELECT DISTINCT u.id, u.email, u.name
     FROM team_members mine
     JOIN team_members theirs
       ON theirs.team_id = mine.team_id AND theirs.user_id <> mine.user_id
     JOIN users u ON u.id = theirs.user_id
     WHERE mine.user_id = $1
       AND theirs.user_id NOT IN (
         SELECT shared_with_user_id FROM support_ticket_shares WHERE ticket_id = $2
       )
     ORDER BY u.email`,
    [session.userId, id],
  );

  return NextResponse.json({
    shares: shares.rows.map((r) => ({
      userId: r.user_id,
      email: r.email,
      name: r.name,
    })),
    eligible: eligible.rows.map((r) => ({
      userId: r.id,
      email: r.email,
      name: r.name,
    })),
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

  let body: { userId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }
  const targetId =
    typeof body.userId === "number" ? body.userId : Number(body.userId);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ error: "Invalid user." }, { status: 400 });
  }

  const gate = await requireOwner(id, session.userId);
  if (gate === "not_found") {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }
  if (gate === "forbidden") {
    return NextResponse.json(
      { error: "Only the ticket owner can share this ticket." },
      { status: 403 },
    );
  }
  if (targetId === session.userId) {
    return NextResponse.json(
      { error: "You already have access to your own ticket." },
      { status: 400 },
    );
  }
  if (!(await areTeammates(session.userId, targetId))) {
    return NextResponse.json(
      { error: "You can only share a ticket with a teammate." },
      { status: 400 },
    );
  }

  await pool.query(
    `INSERT INTO support_ticket_shares (ticket_id, shared_with_user_id, shared_by_user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (ticket_id, shared_with_user_id) DO NOTHING`,
    [id, targetId, session.userId],
  );
  return NextResponse.json({ shared: true }, { status: 201 });
}

export async function DELETE(
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
  const targetId = Number(request.nextUrl.searchParams.get("userId"));
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ error: "Invalid user." }, { status: 400 });
  }

  const gate = await requireOwner(id, session.userId);
  if (gate === "not_found") {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }
  if (gate === "forbidden") {
    return NextResponse.json(
      { error: "Only the ticket owner can change sharing." },
      { status: 403 },
    );
  }

  await pool.query(
    `DELETE FROM support_ticket_shares WHERE ticket_id = $1 AND shared_with_user_id = $2`,
    [id, targetId],
  );
  return NextResponse.json({ removed: true });
}
