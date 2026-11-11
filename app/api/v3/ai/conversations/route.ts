import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { getSession } from "@/lib/auth";
import { logAuditAction, requirePermission } from "@/lib/auth/authorization";
import { STAFF_PERMISSIONS } from "@/lib/auth/permissions-client";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { getClientIp, rateLimitIpKey } from "@/lib/api/request-utils";
import { parsePagination } from "@/lib/api/pagination";
import { escapeLikePattern } from "@/lib/history/list-filter";

// A chat conversation blob is capped at 100 KB; reject anything materially
// larger before we even parse it, so a hostile caller can't force a big JSON
// parse. Read the raw body once (bounded) and parse from that.
const MAX_BODY_BYTES = 110_000;

/** The window the moderator tiles and the two quality filters share. */
const SIGNAL_WINDOW_DAYS = 7;

/** Longer than any name, email or session id the search is matched against. */
const MAX_SEARCH_LENGTH = 200;

/** ai_conversations.user_id is a Postgres INTEGER. */
const MAX_USER_ID = 2_147_483_647;

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
    // How each reply came about (model, what it looked up, how it ended) and
    // what the reader thought of it, keyed by the reply's position in
    // `messages`, so the viewer can put both beside the reply itself.
    const [feedbackRes, eventsRes] = await Promise.all([
      pool.query<{
        message_index: number;
        rating: number;
        comment: string | null;
      }>(
        `SELECT message_index, rating, comment FROM ai_message_feedback
          WHERE conversation_id = $1 ORDER BY message_index`,
        [row.id],
      ),
      pool.query<{
        message_index: number;
        model: string | null;
        provider: string | null;
        usage: unknown;
        finish_reason: string | null;
        tool_calls: unknown;
        error: string | null;
        created_at: string;
      }>(
        `SELECT message_index, model, provider, usage, finish_reason,
                tool_calls, error, created_at
           FROM ai_chat_events
          WHERE conversation_id = $1
          ORDER BY message_index, created_at`,
        [row.id],
      ),
    ]);
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
      feedback: (feedbackRes?.rows ?? []).map((f) => ({
        messageIndex: f.message_index,
        rating: f.rating,
        comment: f.comment,
      })),
      events: (eventsRes?.rows ?? []).map((e) => ({
        messageIndex: e.message_index,
        model: e.model,
        provider: e.provider,
        usage: e.usage,
        finishReason: e.finish_reason,
        toolCalls: Array.isArray(e.tool_calls) ? e.tool_calls : [],
        error: e.error,
        createdAt: e.created_at,
      })),
    });
  }

  const { page, limit, offset } = parsePagination(searchParams, {
    defaultLimit: 50,
    maxLimit: 200,
  });
  const userIdFilter = searchParams.get("userId");
  const q = (searchParams.get("q") ?? "").trim().slice(0, MAX_SEARCH_LENGTH);

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (userIdFilter) {
    // A non-numeric id reached Postgres as NaN and came back a 500, and so
    // did one too large for the INTEGER column it is compared with.
    if (!/^\d+$/.test(userIdFilter) || Number(userIdFilter) > MAX_USER_ID) {
      return NextResponse.json(
        {
          error: `userId must be a whole number no larger than ${MAX_USER_ID}.`,
        },
        { status: 400 },
      );
    }
    params.push(Number(userIdFilter));
    conditions.push(`c.user_id = $${params.length}`);
  }
  // Searched here rather than in the browser, which could only search the
  // page it had loaded, so a conversation on page two "did not exist".
  if (q) {
    params.push(`%${escapeLikePattern(q)}%`);
    const like = `$${params.length}`;
    conditions.push(
      `(u.name ILIKE ${like} ESCAPE '\\' OR u.email ILIKE ${like} ESCAPE '\\' OR c.session_id::text ILIKE ${like} ESCAPE '\\')`,
    );
  }
  // The two questions a moderator brings to this list: which answers did
  // people say were wrong, and which replies failed. Both over the same seven
  // days as the tiles that open them, so a tile's number and the rows it
  // filters to are the same set; unbounded, a tile reading 3 opened a list
  // of every conversation ever rated down.
  if (searchParams.get("rating") === "down") {
    conditions.push(
      `EXISTS (SELECT 1 FROM ai_message_feedback f WHERE f.conversation_id = c.id AND f.rating = -1 AND f.created_at > NOW() - INTERVAL '${SIGNAL_WINDOW_DAYS} days')`,
    );
  }
  if (searchParams.get("errored") === "1") {
    conditions.push(
      `EXISTS (SELECT 1 FROM ai_chat_events e WHERE e.conversation_id = c.id AND e.error IS NOT NULL AND e.created_at > NOW() - INTERVAL '${SIGNAL_WINDOW_DAYS} days')`,
    );
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const [listResult, countResult, signalResult] = await Promise.all([
    pool.query(
      `SELECT c.id, c.session_id, c.user_id, c.created_at, c.last_message_at,
              jsonb_array_length(c.messages) AS message_count,
              (SELECT COUNT(*) FROM ai_message_feedback f
                 WHERE f.conversation_id = c.id AND f.rating = -1)::int AS down_votes,
              (SELECT COUNT(*) FROM ai_chat_events e
                 WHERE e.conversation_id = c.id AND e.error IS NOT NULL)::int AS errors,
              u.name AS user_name, u.email AS user_email, u.avatar_url AS user_avatar_url
       FROM ai_conversations c
       LEFT JOIN users u ON u.id = c.user_id
       ${where}
       ORDER BY c.last_message_at DESC, c.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    ),
    // The join is there for the search, which matches on the user's name
    // and email.
    pool.query(
      `SELECT COUNT(*) FROM ai_conversations c
         LEFT JOIN users u ON u.id = c.user_id
         ${where}`,
      params,
    ),
    // The two *_conversations_7d counts are what the tiles show: the number
    // of conversations their filter opens. The older two count ratings and
    // failed replies, so one conversation with four bad replies read as 4 on
    // a tile that opened 1 row; they stay in the payload unchanged.
    pool.query<{
      unhelpful_7d: number;
      errors_7d: number;
      unhelpful_conversations_7d: number;
      errored_conversations_7d: number;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM ai_message_feedback
           WHERE rating = -1 AND created_at > NOW() - INTERVAL '${SIGNAL_WINDOW_DAYS} days')::int AS unhelpful_7d,
         (SELECT COUNT(*) FROM ai_chat_events
           WHERE error IS NOT NULL AND created_at > NOW() - INTERVAL '${SIGNAL_WINDOW_DAYS} days')::int AS errors_7d,
         (SELECT COUNT(DISTINCT conversation_id) FROM ai_message_feedback
           WHERE rating = -1 AND created_at > NOW() - INTERVAL '${SIGNAL_WINDOW_DAYS} days')::int AS unhelpful_conversations_7d,
         (SELECT COUNT(DISTINCT conversation_id) FROM ai_chat_events
           WHERE error IS NOT NULL AND created_at > NOW() - INTERVAL '${SIGNAL_WINDOW_DAYS} days')::int AS errored_conversations_7d`,
    ),
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
      downVotes: Number(r.down_votes ?? 0),
      errors: Number(r.errors ?? 0),
      createdAt: r.created_at as string,
      lastMessageAt: r.last_message_at as string,
    })),
    total: parseInt((countResult.rows[0] as { count: string }).count, 10),
    signals: {
      unhelpfulLast7Days: signalResult.rows[0]?.unhelpful_7d ?? 0,
      errorsLast7Days: signalResult.rows[0]?.errors_7d ?? 0,
      unhelpfulConversationsLast7Days:
        signalResult.rows[0]?.unhelpful_conversations_7d ?? 0,
      erroredConversationsLast7Days:
        signalResult.rows[0]?.errored_conversations_7d ?? 0,
    },
    page,
    limit,
  });
}
