import {
  APICallError,
  RetryError,
  stepCountIs,
  streamText,
  type ModelMessage,
  type TextStreamPart,
  type ToolSet,
} from "ai";

import { buildSystemPrompt, sanitizeUserName } from "@/lib/ai/system-prompt";
import { LOCALE_ENGLISH_NAMES, isLocale } from "@/lib/i18n/config";
import { buildRetrievedContextBlock } from "@/lib/ai/knowledge-retrieval";
import {
  resolveProviderName,
  resolveAiBaseUrl,
  resolveAiDefaultModel,
  isAnthropicProvider,
} from "@/lib/ai/provider";
import { resolveChatModel } from "@/lib/ai/chat/model";
import { buildChatTools } from "@/lib/ai/chat/tools";
import { expandSlashCommand, parseSlashCommand } from "@/lib/ai/chat/slash";
import {
  CHAT_STREAM_CONTENT_TYPE,
  encodeChatEvent,
  type ChatStreamEvent,
} from "@/lib/ai/chat/stream-protocol";
import { getSession } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { getSettings } from "@/lib/config/runtime-config";
import pool from "@/lib/database/db";
import { getDailyLimit } from "@/lib/rate-limiting/daily-limits";
import { recordAiTokens } from "@/lib/billing/ai-usage";
import { estimateTokens } from "@/lib/scanner/github-repo-scan";

export const runtime = "nodejs";
// Reasoning plus up to MAX_STEPS tool round trips does not fit in 60s on a
// slow provider, and a cut-off reply is worse than a slow one.
export const maxDuration = 120;

/** Tool round trips per reply. Each one re-sends the conversation, so this is
 *  also the ceiling on how much one message can cost. */
const MAX_STEPS = 5;
const MAX_CONVERSATION_MESSAGES = 60;

/**
 * Endpoints that refused a tool-carrying request recently, by base URL and
 * model. Ollama with a model that has no tool template, an older LM Studio
 * build, a gateway that strips the field: they answer the first request with
 * a 400, and paying that failed round trip on every message would double the
 * latency of every reply on exactly the deployments least able to afford it.
 * Remembered per process, and only for a while, so a model swapped for one
 * that does support tools is picked up without a restart.
 */
const TOOLS_REFUSED_FOR_MS = 30 * 60 * 1000;
const toolsRefusedAt = new Map<string, number>();

function toolsRecentlyRefused(key: string): boolean {
  const at = toolsRefusedAt.get(key);
  if (at === undefined) return false;
  if (Date.now() - at > TOOLS_REFUSED_FOR_MS) {
    toolsRefusedAt.delete(key);
    return false;
  }
  return true;
}

/** The provider's own error, out of the SDK's retry wrapper. */
function unwrap(err: unknown): unknown {
  return RetryError.isInstance(err) ? err.lastError : err;
}

/** The request itself was refused (shape, a field, a tool), as opposed to
 *  the provider being down or the key being wrong. Only these are worth
 *  retrying without tools and reasoning fields. */
function isRequestRejection(raw: unknown): boolean {
  const err = unwrap(raw);
  if (!APICallError.isInstance(err)) return false;
  const status = err.statusCode ?? 0;
  if ([400, 404, 422, 501].includes(status)) return true;
  return /\b(tools?|function|tool_choice|reasoning)\b/i.test(
    `${err.message} ${err.responseBody ?? ""}`,
  );
}

function userFacingError(raw: unknown): string {
  const err = unwrap(raw);
  if (APICallError.isInstance(err)) {
    const status = err.statusCode ?? 0;
    if (status === 429)
      return "The AI provider is limiting requests right now. Try again in a minute.";
    if (status === 401 || status === 403)
      return "The AI provider refused this deployment's credentials. An administrator needs to check the AI settings.";
  }
  if (err instanceof Error && /timeout|timed out|aborted/i.test(err.message))
    return "The AI provider took too long to answer. Try again.";
  return "The AI provider is temporarily unavailable. Please try again.";
}

function errorDetail(raw: unknown): string {
  const err = unwrap(raw);
  if (APICallError.isInstance(err))
    return `HTTP ${err.statusCode ?? "?"} ${String(err.responseBody ?? err.message).slice(0, 300)}`;
  return err instanceof Error ? err.message.slice(0, 300) : String(err);
}

// Reasoning written inline by older replies, still in a browser's saved
// conversation. It is never sent back: it was never meant to be read, and
// replaying it spent the turn budget on text nobody asked for.
const THINK_BLOCK_RE = /<think>[\s\S]*?(?:<\/think>|$)/g;

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * The client's history, reduced to what the model may see: user and
 * assistant strings, no reasoning, and nothing that claims to be a context
 * block. Those used to be pasted in by the widget and are now built only
 * here, so a client-sent one is either a stale saved conversation or someone
 * trying to buy the old, larger context budget by typing the tag.
 */
function sanitizeHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: ChatTurn[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const { role, content } = m as { role?: unknown; content?: unknown };
    if (
      (role !== "user" && role !== "assistant") ||
      typeof content !== "string"
    )
      continue;
    const text =
      role === "assistant"
        ? content.replace(THINK_BLOCK_RE, "").trim()
        : content;
    if (!text.trim() || text.trimStart().startsWith("<context")) continue;
    turns.push({ role, content: text });
  }
  // A conversation opens with the reader, whatever the saved copy starts with.
  while (turns.length && turns[0].role === "assistant") turns.shift();
  return turns;
}

/**
 * Newest first, skipping (not stopping at) a turn that does not fit, and
 * always keeping the newest. Bounds what one request forwards to a provider
 * this route pays for: only the last message is length-checked, so without it
 * a caller could send a huge backlog on every request.
 */
function fitToBudget(turns: ChatTurn[], maxChars: number): ChatTurn[] {
  const recent = turns.slice(-MAX_CONVERSATION_MESSAGES);
  const kept: ChatTurn[] = [];
  let budget = maxChars;
  for (let i = recent.length - 1; i >= 0; i--) {
    budget -= recent[i].content.length;
    if (budget < 0 && kept.length > 0) continue;
    kept.unshift(recent[i]);
  }
  while (kept.length && kept[0].role === "assistant") kept.shift();
  return kept;
}

type Part = TextStreamPart<ToolSet>;

/**
 * Pull parts until the reply has visibly started (text or a tool call), it
 * has finished, or it has failed. The response status is decided here: a
 * provider that refuses the request outright gets a real error status, as it
 * always did, instead of a 200 whose body happens to say it failed.
 */
async function prime(stream: AsyncIterable<Part>): Promise<{
  it: AsyncIterator<Part>;
  buffered: Part[];
  error: unknown;
}> {
  const it = stream[Symbol.asyncIterator]();
  const buffered: Part[] = [];
  try {
    while (true) {
      const { value, done } = await it.next();
      if (done) return { it, buffered, error: null };
      if (value.type === "error") return { it, buffered, error: value.error };
      buffered.push(value);
      if (
        value.type === "text-delta" ||
        value.type === "tool-call" ||
        value.type === "finish"
      )
        return { it, buffered, error: null };
    }
  } catch (err) {
    return { it, buffered, error: err };
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json(
      { error: "Sign in to use the AI assistant." },
      { status: 401 },
    );
  }

  const rl = await checkRateLimit({
    key: `ai-chat:${session.userId}`,
    ...RATE_LIMITS.aiChat,
  });
  if (!rl.allowed) {
    return Response.json(
      {
        error: `Too many AI requests. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).`,
      },
      { status: 429 },
    );
  }

  // The ban, the reader's own off switch, and the small account facts the
  // system prompt carries, in one round trip.
  const userRow = await pool.query<{
    ai_chat_banned: boolean;
    ai_disabled: boolean | null;
    plan: string | null;
    created_at: string;
    locale: string | null;
  }>(
    `SELECT u.ai_chat_banned, c.ai_disabled, u.plan, u.created_at, u.locale
       FROM users u
       LEFT JOIN user_ai_configs c ON c.user_id = u.id
      WHERE u.id = $1`,
    [session.userId],
  );
  const userRecord = userRow.rows[0];
  if (userRecord?.ai_chat_banned) {
    return Response.json(
      {
        error: "Your account has been restricted from using the AI assistant.",
      },
      { status: 403 },
    );
  }
  // The widget hides itself for this, but the preference is the reader's, and
  // a hidden button is not the same as the feature being off.
  if (userRecord?.ai_disabled) {
    return Response.json(
      {
        error:
          "You turned the AI assistant off. Turn it back on under Profile, AI settings.",
      },
      { status: 403 },
    );
  }

  const baseUrl = resolveAiBaseUrl();
  const apiKey = process.env.AI_API_KEY ?? "";
  const modelId = resolveAiDefaultModel(baseUrl);
  const {
    AI_CHAT_MAX_TOKENS: maxTokens,
    AI_CHAT_MAX_INPUT_LENGTH: maxInputLength,
  } = await getSettings([
    "AI_CHAT_MAX_TOKENS",
    "AI_CHAT_MAX_INPUT_LENGTH",
  ] as const);

  if (!baseUrl) {
    return Response.json(
      {
        error:
          "AI is not configured. Set AI_BASE_URL (e.g. http://localhost:11434/v1 for Ollama) and AI_MODEL in your .env file.",
      },
      { status: 503 },
    );
  }

  let body: { messages?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
  if (rawMessages.length === 0) {
    return Response.json(
      { error: "messages array is required." },
      { status: 400 },
    );
  }

  // The client caps the textarea at the same length; this is the enforcement.
  // Only the newest message is checked: everything before it was the newest
  // message of its own request once.
  const last = rawMessages[rawMessages.length - 1] as { content?: unknown };
  if (
    typeof last?.content === "string" &&
    last.content.length > maxInputLength
  ) {
    return Response.json(
      {
        error: `Message exceeds maximum length of ${maxInputLength} characters.`,
      },
      { status: 400 },
    );
  }

  const turns = fitToBudget(
    sanitizeHistory(rawMessages),
    Math.max(maxInputLength, 20_000) * 6,
  );
  const question = turns[turns.length - 1];
  if (!question || question.role !== "user") {
    return Response.json(
      { error: "The last message must be from the user." },
      { status: 400 },
    );
  }

  // A slash command is run here, for this turn only, and its result travels
  // as a message the model reads just before the instruction it implies.
  const slash = await expandSlashCommand(question.content, session.userId);
  const history = turns.slice(0, -1);
  const finalTurns: ChatTurn[] = slash
    ? [
        ...history,
        ...(slash.context
          ? [
              {
                role: "user" as const,
                content: `<context cmd="${slash.cmd}">\n${slash.context}\n</context>`,
              },
            ]
          : []),
        { role: "user", content: slash.instruction },
      ]
    : turns;

  const resolvedDailyLimit = await getDailyLimit(session.userId);
  const promptFacts = {
    name: session.name ? sanitizeUserName(session.name) : "User",
    plan: userRecord?.plan ?? null,
    role: session.role,
    dailyScanLimit: Number.isFinite(resolvedDailyLimit)
      ? resolvedDailyLimit
      : ("unlimited" as const),
    memberSince: userRecord?.created_at
      ? new Date(userRecord.created_at).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
        })
      : null,
    // The language this account reads the site in, rather than whatever the
    // question happened to be typed in.
    language: isLocale(userRecord?.locale)
      ? LOCALE_ENGLISH_NAMES[userRecord.locale]
      : null,
  };

  const providerName = resolveProviderName(baseUrl);
  const isAnthropic = isAnthropicProvider(baseUrl);
  const host = (() => {
    try {
      return new URL(baseUrl).host;
    } catch {
      return "invalid-url";
    }
  })();
  const capabilityKey = `${baseUrl}|${modelId}`;
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort(), { once: true });

  /**
   * One attempt at the reply. With tools the model looks things up itself;
   * without them (an endpoint that refused tools) the old keyword retrieval
   * pastes the best matching excerpts in before the question instead.
   */
  function attempt(useTools: boolean) {
    const system = buildSystemPrompt(promptFacts, { tools: useTools });
    const messages: ModelMessage[] = finalTurns.map((t) => ({
      role: t.role,
      content: t.content,
    }));
    if (!useTools && !slash) {
      // The last two questions, not one: "how do I fix that?" names nothing,
      // and the turn before it is what "that" was.
      const query = finalTurns
        .filter((t) => t.role === "user" && !parseSlashCommand(t.content))
        .slice(-2)
        .map((t) => t.content)
        .join("\n");
      const retrieved = query
        ? buildRetrievedContextBlock(query, { minMatchedTerms: 2 })
        : null;
      if (retrieved)
        messages.splice(Math.max(0, messages.length - 1), 0, {
          role: "user",
          content: retrieved,
        });
    }
    const inputChars =
      system.length +
      messages.reduce((n, m) => n + String(m.content).length, 0);
    const { model, providerOptions } = resolveChatModel({
      baseUrl: baseUrl!,
      apiKey,
      model: modelId,
      maxTokens,
      // The retry drops reasoning fields too: an endpoint that refused the
      // request may have refused one of those rather than the tools.
      reasoning: useTools,
    });
    const result = streamText({
      model,
      // The system prompt is the same on every turn, so on Anthropic it is a
      // cache hit after the first message of a conversation.
      system: isAnthropic
        ? {
            role: "system",
            content: system,
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral" } },
            },
          }
        : system,
      messages,
      ...(useTools
        ? {
            tools: buildChatTools(session!.userId),
            stopWhen: stepCountIs(MAX_STEPS),
          }
        : {}),
      maxOutputTokens: maxTokens,
      providerOptions: providerOptions as never,
      abortSignal: abort.signal,
      maxRetries: 1,
      // The SDK prints every error with its stack by default. This route logs
      // one line per failure itself, with the user and endpoint attached.
      onError: () => {},
    });
    return { result, inputChars };
  }

  let useTools = !toolsRecentlyRefused(capabilityKey);
  let current = attempt(useTools);
  let primed = await prime(current.result.fullStream);

  if (primed.error && useTools && isRequestRejection(primed.error)) {
    console.error(
      `[AI chat] ${host} (${modelId}) refused a request with tools; answering without them for ${TOOLS_REFUSED_FOR_MS / 60_000} minutes: ${errorDetail(primed.error)}`,
    );
    toolsRefusedAt.set(capabilityKey, Date.now());
    useTools = false;
    current = attempt(false);
    primed = await prime(current.result.fullStream);
  }

  if (primed.error) {
    if (abort.signal.aborted) return new Response(null, { status: 499 });
    console.error(
      `[AI chat] request failed for user ${session.userId} via ${host} (${modelId}): ${errorDetail(primed.error)}`,
    );
    return Response.json(
      { error: userFacingError(primed.error) },
      { status: 502 },
    );
  }

  const encoder = new TextEncoder();
  const userId = session.userId;
  const { inputChars } = current;
  const { it, buffered } = primed;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(encodeChatEvent(event)));
        } catch {
          // The reader went away; keep draining so usage is still recorded.
        }
      };
      let chars = 0;
      let usageTokens: number | null = null;
      let finishReason: string | undefined;
      let failure: unknown = null;
      const tools: string[] = [];

      const handle = (part: Part) => {
        switch (part.type) {
          case "text-delta":
            if (part.text) {
              chars += part.text.length;
              send({ type: "text", text: part.text });
            }
            break;
          case "tool-call":
            tools.push(part.toolName);
            send({ type: "tool", name: part.toolName });
            break;
          case "finish": {
            finishReason = part.finishReason;
            const u = part.totalUsage;
            const total =
              u?.totalTokens ??
              (u?.inputTokens != null || u?.outputTokens != null
                ? (u.inputTokens ?? 0) + (u.outputTokens ?? 0)
                : undefined);
            if (typeof total === "number" && total > 0) usageTokens = total;
            break;
          }
          case "error":
            failure = part.error;
            break;
          default:
            // Reasoning parts end here: they are never forwarded.
            break;
        }
      };

      try {
        for (const part of buffered) handle(part);
        while (!failure) {
          const { value, done } = await it.next();
          if (done) break;
          handle(value);
        }
      } catch (err) {
        failure = err;
      }

      const clientGone = abort.signal.aborted;
      if (failure && !clientGone) {
        console.error(
          `[AI chat] stream ended abnormally for user ${userId} via ${host} (${modelId}) after ${chars} chars, tools [${tools.join(", ")}]: ${errorDetail(failure)}`,
        );
        send({
          type: "error",
          message:
            chars > 0
              ? "The reply was cut off. Ask again to get the rest."
              : userFacingError(failure),
        });
      } else if (chars === 0 && !clientGone) {
        // A finished reply with no words: reasoning that never closed, a
        // length cut inside it, or a model that only ever called tools.
        console.error(
          `[AI chat] empty reply for user ${userId} via ${host} (${modelId}), finish=${finishReason ?? "none"}, tools [${tools.join(", ")}]`,
        );
        send({
          type: "error",
          message:
            finishReason === "length"
              ? "The answer ran out of room before it started. Ask a narrower question."
              : "No answer came back. Try asking again.",
        });
      } else if (finishReason === "length" && !clientGone) {
        send({
          type: "error",
          message:
            "The reply hit its length limit. Ask for the rest if you need it.",
        });
      }
      send({ type: "done" });

      // Always recorded: chat runs on the operator's key whatever the reader
      // has configured for the metered features, and the counter exists so
      // the operator can see what chat costs. Never charges credits.
      const tokens = usageTokens ?? estimateTokens(inputChars + chars);
      try {
        await recordAiTokens(userId, tokens, undefined, false);
      } catch (err) {
        console.error(
          "[AI chat] Failed to record token usage (non-fatal):",
          err instanceof Error ? err.message : err,
        );
      }
      try {
        controller.close();
      } catch {
        // Already closed by a cancel.
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": CHAT_STREAM_CONTENT_TYPE,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      // nginx buffers proxied responses by default, which would hold the whole
      // reply at the proxy and deliver it in one lump. Harmless elsewhere.
      "X-Accel-Buffering": "no",
      "X-AI-Model": modelId,
      "X-AI-Provider-Name": providerName,
      "X-AI-Tools": useTools ? "on" : "off",
    },
  });
}
