import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { getSession } from "@/lib/auth";
import { requireStaff } from "@/lib/auth/authorization";

// POST: upsert a conversation (called by chat widget after each exchange)
export async function POST(req: NextRequest) {
  let body: {
    sessionId?: string;
    messages?: Array<{ role: string; content: string }>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const { sessionId, messages } = body;
  if (!sessionId || !Array.isArray(messages)) {
    return NextResponse.json(
      { error: "sessionId and messages are required." },
      { status: 400 },
    );
  }

  if (JSON.stringify(messages).length > 100_000) {
    return NextResponse.json(
      { error: "Conversation too large." },
      { status: 413 },
    );
  }

  // UUID format check
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      sessionId,
    )
  ) {
    return NextResponse.json(
      { error: "Invalid sessionId format." },
      { status: 400 },
    );
  }

  const session = await getSession();
  const userId = session?.userId ?? null;

  const result = await pool.query(
    `INSERT INTO ai_conversations (session_id, user_id, messages, created_at, last_message_at)
     VALUES ($1, $2, $3::jsonb, NOW(), NOW())
     ON CONFLICT (session_id) DO UPDATE
       SET messages = $3::jsonb,
           last_message_at = NOW()
     RETURNING id, session_id`,
    [sessionId, userId, JSON.stringify(messages)],
  );

  const row = result.rows[0] as { id: number; session_id: string };
  return NextResponse.json({ id: row.id, sessionId: row.session_id });
}

// GET: admin-only list or single conversation
export async function GET(req: NextRequest) {
  const staff = await requireStaff();
  if (!staff) {
    return NextResponse.json({ error: "Staff only." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (id) {
    const convId = parseInt(id, 10);
    if (!Number.isFinite(convId)) {
      return NextResponse.json({ error: "Invalid id." }, { status: 400 });
    }
    const result = await pool.query(
      `SELECT c.id, c.session_id, c.user_id, c.messages, c.created_at, c.last_message_at,
              u.name AS user_name, u.email AS user_email
       FROM ai_conversations c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.id = $1`,
      [convId],
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    const row = result.rows[0] as {
      id: number;
      session_id: string;
      user_id: number | null;
      messages: Array<{ role: string; content: string }>;
      created_at: string;
      last_message_at: string;
      user_name: string | null;
      user_email: string | null;
    };
    return NextResponse.json({
      id: row.id,
      sessionId: row.session_id,
      userId: row.user_id,
      userName: row.user_name,
      userEmail: row.user_email,
      messages: row.messages,
      createdAt: row.created_at,
      lastMessageAt: row.last_message_at,
    });
  }

  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(
    200,
    Math.max(1, parseInt(searchParams.get("limit") || "50", 10)),
  );
  const userIdFilter = searchParams.get("userId");
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (userIdFilter) {
    params.push(parseInt(userIdFilter, 10));
    conditions.push(`c.user_id = $${params.length}`);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const [listResult, countResult] = await Promise.all([
    pool.query(
      `SELECT c.id, c.session_id, c.user_id, c.created_at, c.last_message_at,
              jsonb_array_length(c.messages) AS message_count,
              u.name AS user_name, u.email AS user_email
       FROM ai_conversations c
       LEFT JOIN users u ON u.id = c.user_id
       ${where}
       ORDER BY c.last_message_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    ),
    pool.query(`SELECT COUNT(*) FROM ai_conversations c ${where}`, params),
  ]);

  return NextResponse.json({
    conversations: listResult.rows.map((r) => ({
      id: r.id as number,
      sessionId: r.session_id as string,
      userId: r.user_id as number | null,
      userName: r.user_name as string | null,
      userEmail: r.user_email as string | null,
      messageCount: parseInt(r.message_count as string, 10),
      createdAt: r.created_at as string,
      lastMessageAt: r.last_message_at as string,
    })),
    total: parseInt((countResult.rows[0] as { count: string }).count, 10),
    page,
    limit,
  });
}
