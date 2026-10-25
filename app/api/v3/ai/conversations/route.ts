import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { getSession } from "@/lib/auth";
import { logAuditAction, requirePermission } from "@/lib/auth/authorization";
import { STAFF_PERMISSIONS } from "@/lib/auth/permissions-client";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { getClientIp, rateLimitIpKey } from "@/lib/api/request-utils";
import { parsePagination } from "@/lib/api/pagination";

// A chat conversation blob is capped at 100 KB; reject anything materially
// larger before we even parse it, so a hostile caller can't force a big JSON
// parse. Read the raw body once (bounded) and parse from that.
const MAX_BODY_BYTES = 110_000;

// POST: upsert a conversation (called by chat widget after each exchange).
// The widget is available to guests, so this intentionally accepts anonymous
// writes -- but keyed rate limiting + a pre-parse size cap keep it from being
// an unbounded, unauthenticated storage/CPU sink.
export async function POST(req: NextRequest) {
  const session = await getSession();
  const userId = session?.userId ?? null;

  // Rate limit per user when signed in, else per IP, so nobody (guest or not)
  // can spam unbounded rows keyed on random UUIDs.
  const ip = await getClientIp();
  const rl = await checkRateLimit({
    key: `ai-conversation:${userId ?? rateLimitIpKey(ip)}`,
    ...RATE_LIMITS.aiChat,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429 },
    );
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Conversation too large." },
      { status: 413 },
    );
  }

  let body: {
    sessionId?: string;
    messages?: Array<{ role: string; content: string }>;
  };
  try {
    body = JSON.parse(raw);
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

  // The conflict target is a session id the caller chose, and the update had
  // no predicate on it, so any caller who knew or obtained another account's
  // session id could replace that conversation's messages wholesale. The row
  // kept the victim's user_id (the old DO UPDATE never touched it), so what
  // staff then read in the admin panel was attacker-written text attributed
  // to a real, named user.
  //
  // The predicate keeps a signed-in conversation writable only by the account
  // that owns it. An anonymous row stays adoptable, and has to: the widget
  // works for guests, and a guest who signs in mid-conversation continues
  // posting the same session id and would otherwise be locked out of their
  // own thread one message in. COALESCE is what performs that adoption, and
  // it only ever fills a NULL, so signing in cannot move a conversation off
  // the account that already holds it.
  const result = await pool.query(
    `INSERT INTO ai_conversations (session_id, user_id, messages, created_at, last_message_at)
     VALUES ($1, $2, $3::jsonb, NOW(), NOW())
     ON CONFLICT (session_id) DO UPDATE
       SET messages = $3::jsonb,
           last_message_at = NOW(),
           user_id = COALESCE(ai_conversations.user_id, EXCLUDED.user_id)
       WHERE ai_conversations.user_id IS NULL
          OR ai_conversations.user_id = EXCLUDED.user_id
     RETURNING id, session_id`,
    [sessionId, userId, JSON.stringify(messages)],
  );

  // The WHERE filtered the update out: the session id exists and belongs to
  // somebody else. Answered the same way a missing row would be, because
  // telling the caller which of the two it is confirms that a session id they
  // guessed is real.
  const row = result.rows[0] as { id: number; session_id: string } | undefined;
  if (!row) {
    return NextResponse.json(
      { error: "Conversation not found." },
      { status: 404 },
    );
  }
  return NextResponse.json({ id: row.id, sessionId: row.session_id });
}

// GET: list or read conversations, for the staff who moderate content.
//
// This was gated on being staff at all, so support, billing and ops accounts
// could read every user's chats through the API although the admin panel
// only shows the tab to holders of MODERATE_CONTENT. The route now asks for
// the same grant the panel does, and reading a transcript is audited the way
// opening an account record is: it is someone else's conversation.
export async function GET(req: NextRequest) {
  const staff = await requirePermission(STAFF_PERMISSIONS.MODERATE_CONTENT);
  if (!staff) {
    return NextResponse.json(
      { error: "You do not have permission to read AI conversations." },
      { status: 403 },
    );
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
              u.name AS user_name, u.email AS user_email, u.avatar_url AS user_avatar_url
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
      user_avatar_url: string | null;
    };
    try {
      await logAuditAction(
        staff.id,
        row.user_id,
        "view_ai_conversation",
        `Viewed AI conversation #${row.id}`,
        await getClientIp(),
      );
    } catch (err) {
      // Best effort, as with view_user_detail: a failed audit insert must
      // not hide the transcript from the moderator who asked for it.
      console.error(
        `[ai/conversations] audit row for conversation #${row.id} failed:`,
        err,
      );
    }
    return NextResponse.json({
      id: row.id,
      sessionId: row.session_id,
      userId: row.user_id,
      userName: row.user_name,
      userEmail: row.user_email,
      userAvatarUrl: row.user_avatar_url,
      messages: row.messages,
      createdAt: row.created_at,
      lastMessageAt: row.last_message_at,
    });
  }

  const { page, limit, offset } = parsePagination(searchParams, {
    defaultLimit: 50,
    maxLimit: 200,
  });
  const userIdFilter = searchParams.get("userId");

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
              u.name AS user_name, u.email AS user_email, u.avatar_url AS user_avatar_url
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
      userAvatarUrl: r.user_avatar_url as string | null,
      messageCount: parseInt(r.message_count as string, 10),
      createdAt: r.created_at as string,
      lastMessageAt: r.last_message_at as string,
    })),
    total: parseInt((countResult.rows[0] as { count: string }).count, 10),
    page,
    limit,
  });
}
