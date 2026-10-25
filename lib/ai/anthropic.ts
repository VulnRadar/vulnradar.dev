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
 * that shape for the one-shot calls (verification, summaries, tags, source
 * review). The chat streams through the AI SDK's Anthropic provider instead
 * (lib/ai/chat/model.ts), which this file used to duplicate by hand.
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
  // MiniMax M3 over its Anthropic-compatible endpoint. Its docs specify
  // {"type":"adaptive"} and say thinking is OFF by default, so omitting the
  // field entirely would leave the model answering without reasoning, and
  // sending budget_tokens would be rejected.
  "MiniMax-M3",
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

/** Real (not estimated) token usage Anthropic reports for one non-streaming call. */
export interface AnthropicUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Non-streaming call. Returns the final answer text and, separately, any
 * extended-thinking text the model produced — kept apart rather than
 * inlined, since the caller decides whether that text is worth surfacing.
 * Also returns Anthropic's own reported `usage` (input_tokens/
 * output_tokens). See lib/ai/verify-findings.ts and lib/ai/scan-summary.ts
 * for callers that feed this into lib/billing/ai-usage.ts's recordAiTokens.
 */
export async function callAnthropicMessages(
  opts: AnthropicCallOptions,
  signal?: AbortSignal,
): Promise<{ text: string; thinking: string; usage: AnthropicUsage }> {
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
    usage?: { input_tokens?: number; output_tokens?: number };
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
  const usage: AnthropicUsage = {
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  };

  return { text, thinking, usage };
}
