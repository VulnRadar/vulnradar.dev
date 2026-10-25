import pool from "@/lib/database/db";
import { getSession } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import {
  isMessageIndex,
  isSessionId,
  ownedConversationId,
} from "@/lib/ai/chat/conversation";
import { logError } from "@/lib/logging/log";

export const runtime = "nodejs";

const MAX_COMMENT = 1_000;

/**
 * POST /api/v3/ai/feedback: a thumbs up or down on one of Vera's replies.
 *
 * The only signal the chat has about whether an answer helped: the
 * transcript says what was said, not whether it was right. One vote per
 * reader per reply; voting again replaces it, and a rating of 0 takes it
 * back. Only the account that owns the conversation can rate it, and a
 * conversation it does not own reads as missing.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json(
      { error: "Sign in to rate a reply." },
      { status: 401 },
    );
  }

  const rl = await checkRateLimit({
    key: `ai-feedback:${session.userId}`,
    ...RATE_LIMITS.aiChat,
  });
  if (!rl.allowed) {
    return Response.json(
      { error: "Too many ratings. Try again in a few minutes." },
      { status: 429 },
    );
  }

  let body: {
    sessionId?: unknown;
    messageIndex?: unknown;
    rating?: unknown;
    comment?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { sessionId, messageIndex, rating } = body;
  if (!isSessionId(sessionId) || !isMessageIndex(messageIndex)) {
    return Response.json(
      { error: "sessionId and messageIndex are required." },
      { status: 400 },
    );
  }
  if (rating !== 1 && rating !== -1 && rating !== 0) {
    return Response.json(
      { error: "rating must be 1, -1 or 0." },
      { status: 400 },
    );
  }
  const comment =
    typeof body.comment === "string" && body.comment.trim()
      ? body.comment.trim().slice(0, MAX_COMMENT)
      : null;

  try {
    const conversationId = await ownedConversationId(sessionId, session.userId);
    if (conversationId === null) {
      return Response.json(
        { error: "Conversation not found." },
        { status: 404 },
      );
    }

    if (rating === 0) {
      await pool.query(
        `DELETE FROM ai_message_feedback
          WHERE conversation_id = $1 AND message_index = $2 AND user_id = $3`,
        [conversationId, messageIndex, session.userId],
      );
      return Response.json({ ok: true, rating: 0 });
    }

    await pool.query(
      `INSERT INTO ai_message_feedback
         (conversation_id, message_index, user_id, rating, comment)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (conversation_id, message_index, user_id) DO UPDATE
         SET rating = EXCLUDED.rating,
             comment = COALESCE(EXCLUDED.comment, ai_message_feedback.comment),
             created_at = NOW()`,
      [conversationId, messageIndex, session.userId, rating, comment],
    );
    return Response.json({ ok: true, rating });
  } catch (err) {
    logError("ai-feedback", "could not save a rating", err, {
      userId: session.userId,
      messageIndex,
    });
    return Response.json(
      { error: "That rating did not save. Try again." },
      { status: 500 },
    );
  }
}
