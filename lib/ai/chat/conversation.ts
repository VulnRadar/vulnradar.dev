import pool from "@/lib/database/db";
import { logError } from "@/lib/logging/log";

const SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_RE.test(value);
}

/** A reply's position in the stored transcript, as the widget numbers it. */
export function isMessageIndex(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= 10_000
  );
}

/**
 * The id of the conversation row for this widget session, created if the
 * widget has not saved it yet (it saves after each reply, so the first one
 * always arrives here first).
 *
 * Same ownership rule as the widget's own save in
 * app/api/v3/ai/conversations: a row owned by another account is never
 * touched and reads as no row; a guest row is adopted by the account that
 * continues it.
 */
export async function conversationIdFor(
  sessionId: string,
  userId: number,
): Promise<number | null> {
  const res = await pool.query<{ id: number }>(
    `INSERT INTO ai_conversations (session_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (session_id) DO UPDATE
       SET user_id = COALESCE(ai_conversations.user_id, EXCLUDED.user_id)
       WHERE ai_conversations.user_id IS NULL
          OR ai_conversations.user_id = EXCLUDED.user_id
     RETURNING id`,
    [sessionId, userId],
  );
  return res.rows[0]?.id ?? null;
}

/** The conversation for a session, only if this account owns it. */
export async function ownedConversationId(
  sessionId: string,
  userId: number,
): Promise<number | null> {
  const res = await pool.query<{ id: number }>(
    `SELECT id FROM ai_conversations WHERE session_id = $1 AND user_id = $2`,
    [sessionId, userId],
  );
  return res.rows[0]?.id ?? null;
}

export interface ChatEvent {
  sessionId: string;
  userId: number;
  messageIndex: number;
  model: string;
  provider: string;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    estimated: boolean;
  };
  finishReason: string | null;
  toolCalls: string[];
  error: string | null;
}

/**
 * One row per reply: which model answered, what it looked up, what it cost,
 * and how it ended. This is what Admin > AI Chats reads to tell a reply that
 * failed from one that merely read badly, which the stored transcript alone
 * cannot: it holds the words and nothing about how they were produced.
 *
 * Best effort. A reader's answer has already been delivered by the time this
 * runs, and losing the record of it is not worth surfacing to them.
 */
export async function recordChatEvent(event: ChatEvent): Promise<void> {
  try {
    const conversationId = await conversationIdFor(
      event.sessionId,
      event.userId,
    );
    if (conversationId === null) return;
    await pool.query(
      `INSERT INTO ai_chat_events
         (conversation_id, user_id, message_index, model, provider, usage,
          finish_reason, tool_calls, error)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9)`,
      [
        conversationId,
        event.userId,
        event.messageIndex,
        event.model.slice(0, 200),
        event.provider.slice(0, 100),
        JSON.stringify(event.usage),
        event.finishReason?.slice(0, 40) ?? null,
        JSON.stringify(event.toolCalls.slice(0, 20)),
        event.error?.slice(0, 500) ?? null,
      ],
    );
  } catch (err) {
    logError("ai-chat", "could not record the chat event", err, {
      userId: event.userId,
      messageIndex: event.messageIndex,
    });
  }
}
