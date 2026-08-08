/**
 * Native Anthropic Messages API adapter.
 *
 * Anthropic's real API is not OpenAI-chat-completions compatible: auth uses
 * an `x-api-key` header (not `Authorization: Bearer`), every request needs
 * an `anthropic-version` header, the endpoint is `/messages` (not
 * `/chat/completions`), the system prompt is a top-level `system` field
 * (not a `role: "system"` message), and streaming uses Anthropic's own SSE
 * event shape (`message_start` / `content_block_start` /
 * `content_block_delta` / ...) instead of OpenAI's
 * `choices[0].delta.content` chunks. This file is the one place that speaks
 * that shape.
 *
 * Callers get back plain text with synthesized <think>...</think> tags
 * around any extended-thinking content, so lib/ai/think-parser.ts and the
 * chat widget need no changes to render it.
 */

export const ANTHROPIC_VERSION = "2023-06-01";

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AnthropicCallOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  messages: AnthropicMessage[];
  maxTokens: number;
  /**
   * Extended-thinking budget in tokens. Omit or 0 disables thinking.
   * Only used as a token count on models still using the older
   * `{type: "enabled", budget_tokens}` shape (see
   * anthropicUsesAdaptiveThinking below) — on adaptive-thinking models this
   * is just a "should thinking be requested at all" signal.
   */
  thinkingBudgetTokens?: number;
}

/**
 * Claude Opus 5, Opus 4.8, and Claude Sonnet 5 (and later models on the same
 * generation) reject the older `{type: "enabled", budget_tokens: N}` request
 * shape with a 400 error — thinking has to be requested as
 * `{type: "adaptive"}` instead, and turned off with `{type: "disabled"}`
 * rather than by omitting the field, since Claude Opus 5 and Claude Sonnet 5
 * both run thinking by default when "thinking" is left out entirely. Models
 * still on the older scheme (Claude Haiku 4.5, and any pre-4.6-generation
 * model) keep using budget_tokens.
 *
 * Only needs to list the exact model IDs that appear in AI_MODEL_CATALOG
 * (lib/ai/model-catalog.ts), since that catalog is the only place Anthropic
 * model IDs come from in this app.
 */
const ANTHROPIC_ADAPTIVE_THINKING_MODELS = new Set([
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-sonnet-5",
]);

export function anthropicUsesAdaptiveThinking(model: string): boolean {
  return ANTHROPIC_ADAPTIVE_THINKING_MODELS.has(model);
}

export class AnthropicApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(`Anthropic API error ${status}: ${detail}`);
    this.name = "AnthropicApiError";
  }
}

export function buildAnthropicHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
  };
}

export function buildAnthropicBody(
  opts: AnthropicCallOptions,
  stream: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens,
    system: opts.system,
    messages: opts.messages,
    stream,
  };

  const wantsThinking =
    !!opts.thinkingBudgetTokens && opts.thinkingBudgetTokens >= 1024;

  if (anthropicUsesAdaptiveThinking(opts.model)) {
    // No token budget on these models — Claude decides depth on its own.
    // Disabled has to be sent explicitly rather than left implicit, since
    // Claude Opus 5 and Claude Sonnet 5 think by default when the field is
    // omitted entirely.
    body.thinking = wantsThinking ? { type: "adaptive" } : { type: "disabled" };
  } else if (wantsThinking) {
    // Anthropic requires >=1024 thinking tokens once enabled, and the budget
    // must leave room under max_tokens for the visible answer itself.
    const budget = Math.min(opts.thinkingBudgetTokens!, opts.maxTokens - 256);
    if (budget >= 1024) {
      body.thinking = { type: "enabled", budget_tokens: budget };
    }
  }

  return body;
}

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body?.error?.message ?? JSON.stringify(body);
  } catch {
    try {
      return await res.text();
    } catch {
      return "";
    }
  }
}

/**
 * Non-streaming call. Returns the final answer text and, separately, any
 * extended-thinking text the model produced — kept apart rather than
 * inlined, since the caller decides whether that text is worth surfacing.
 */
export async function callAnthropicMessages(
  opts: AnthropicCallOptions,
  signal?: AbortSignal,
): Promise<{ text: string; thinking: string }> {
  const res = await fetch(`${opts.baseUrl}/messages`, {
    method: "POST",
    headers: buildAnthropicHeaders(opts.apiKey),
    body: JSON.stringify(buildAnthropicBody(opts, false)),
    signal,
  });

  if (!res.ok) {
    throw new AnthropicApiError(res.status, await readErrorDetail(res));
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string; thinking?: string }>;
  };
  const blocks = Array.isArray(data.content) ? data.content : [];
  const text = blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
  const thinking = blocks
    .filter((b) => b.type === "thinking" && typeof b.thinking === "string")
    .map((b) => b.thinking)
    .join("");

  return { text, thinking };
}

/**
 * Issues the streaming request. The caller checks res.ok the same way it
 * does for the OpenAI-compatible path, then feeds res.body chunks into
 * createAnthropicSseTranscoder().
 */
export async function fetchAnthropicStream(
  opts: AnthropicCallOptions,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(`${opts.baseUrl}/messages`, {
    method: "POST",
    headers: buildAnthropicHeaders(opts.apiKey),
    body: JSON.stringify(buildAnthropicBody(opts, true)),
    signal,
  });
}

/**
 * Converts Anthropic's SSE event stream into plain text, synthesizing
 * <think>...</think> tags around `thinking` content blocks so the existing
 * think-parser.ts / chat widget rendering pipeline works unmodified — it
 * already knows how to fold that markup out of the visible answer.
 *
 * feed() is stateful: pass each raw decoded chunk as it arrives and it
 * returns the plain text to emit immediately, buffering any incomplete
 * trailing line for the next call.
 */
export function createAnthropicSseTranscoder() {
  let buffer = "";
  let inThinking = false;

  function feed(chunkText: string): string {
    buffer += chunkText;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    let out = "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data) continue;

      let json: {
        type?: string;
        content_block?: { type?: string };
        delta?: { type?: string; text?: string; thinking?: string };
      };
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }

      if (
        json.type === "content_block_start" &&
        json.content_block?.type === "thinking"
      ) {
        inThinking = true;
        out += "<think>";
      } else if (json.type === "content_block_delta") {
        const delta = json.delta;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          out += delta.text;
        } else if (
          delta?.type === "thinking_delta" &&
          typeof delta.thinking === "string"
        ) {
          out += delta.thinking;
        }
      } else if (json.type === "content_block_stop" && inThinking) {
        out += "</think>";
        inThinking = false;
      }
    }
    return out;
  }

  return { feed };
}
