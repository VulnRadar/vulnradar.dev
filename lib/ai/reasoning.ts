import { resolveProviderName } from "./provider";

/**
 * Per-provider "native reasoning" wiring, layered on top of the inline
 * <think> parsing in think-parser.ts (which stays exactly as-is for models
 * like MiniMax-M2.x, DeepSeek-R1, and QwQ that emit reasoning as plain text
 * with no request param needed at all).
 *
 * - Anthropic: a `thinking` request param plus `thinking` content blocks in
 *   the response. Handled entirely inside lib/ai/anthropic.ts, which
 *   synthesizes <think> tags around them so the rest of the pipeline
 *   doesn't need to know the difference.
 * - OpenAI o-series: a `reasoning_effort` request param. Chat Completions
 *   never returns the reasoning text itself (that's a Responses-API-only
 *   field) — the param only controls how hard the model reasons
 *   internally, so there is nothing to fold into a <think> tag here.
 * - Gemini via the OpenAI-compatible endpoint: `thinkingConfig` isn't a
 *   Chat Completions field, but Google's compat layer accepts the same
 *   `extra_body` passthrough shape the OpenAI SDKs send, which lands as a
 *   top-level `google.thinking_config` object in the JSON request body.
 */

export type OpenAiCompatExtras = Record<string, unknown>;

const OPENAI_REASONING_MODEL = /^o\d(-|$)/i;

/**
 * Extra fields to merge into an OpenAI-compatible chat/completions payload
 * to request native reasoning, when the provider/model supports it. Returns
 * an empty object when there's nothing to add — merging that in is a no-op.
 */
export function resolveOpenAiCompatReasoningExtras(
  baseUrl: string | null,
  model: string,
): OpenAiCompatExtras {
  const provider = resolveProviderName(baseUrl);

  if (provider === "ChatGPT" && OPENAI_REASONING_MODEL.test(model)) {
    return { reasoning_effort: "medium" };
  }

  if (provider === "Gemini") {
    return { google: { thinking_config: { include_thoughts: true } } };
  }

  return {};
}

/**
 * Anthropic's thinking budget must be >=1024 tokens once enabled, and must
 * leave room under max_tokens for the visible answer. Scaled off the call's
 * own max_tokens rather than a fixed number so it stays sensible whether
 * it's a quick chat reply or a verification call with a larger budget.
 * Returns 0 when max_tokens is too small to fit a useful thinking budget —
 * callers treat 0 as "don't request thinking".
 */
export function resolveAnthropicThinkingBudget(maxTokens: number): number {
  const budget = Math.floor(maxTokens * 0.5);
  if (budget < 1024) return 0;
  return Math.min(budget, maxTokens - 256);
}
