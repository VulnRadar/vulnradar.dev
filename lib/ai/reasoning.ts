import { resolveProviderName, isAnthropicProvider } from "./provider";

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

/**
 * The reasoning fields to merge into an OpenAI-COMPATIBLE request body.
 *
 * One function for all three callers (chat, verification, summary) so the
 * question "does this model reason, and how hard" has a single answer. It
 * previously keyed off resolveProviderName, which meant only endpoints this
 * app recognises by hostname could reason at all: Grok got nothing, and so
 * did every model reached through a gateway that namespaces its ids.
 * resolveOpenAiReasoningEffort below matches on the MODEL instead, which is
 * what actually decides whether the field is accepted.
 */
export function resolveOpenAiCompatReasoningExtras(
  baseUrl: string | null,
  model: string,
  purpose: ReasoningPurpose = "chat",
): OpenAiCompatExtras {
  // Gemini takes its own shape rather than reasoning_effort when reached
  // through Google's own OpenAI-compatibility layer.
  if (resolveProviderName(baseUrl) === "Gemini") {
    return { google: { thinking_config: { include_thoughts: true } } };
  }
  const effort = resolveOpenAiReasoningEffort(model, purpose);
  return effort ? { reasoning_effort: effort } : {};
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

/**
 * The `reasoning_effort` value to send to an OpenAI-COMPATIBLE endpoint, or
 * null for a model that does not take the parameter.
 *
 * Reasoning used to be requested only on the Anthropic path, because that is
 * where this codebase first needed it. The effect was that every other
 * provider answered cold, including models built specifically to think:
 * GPT-5, the o-series and Gemini 3 all expose reasoning through this exact
 * field, and a verification verdict made without it is a snap judgement on a
 * question that deserves better.
 *
 * The allowlist is deliberate rather than a catch-all. A strict endpoint
 * rejects an unknown body field with a 400, so guessing would break working
 * configurations; callers additionally retry once without the field if a
 * request is refused for it, which covers a model we get wrong here.
 *
 * "verify" asks for the most reasoning, because a wrong verdict is shown to
 * the user as a judgement about their security. "summary" asks for less: it
 * restates findings that have already been decided, and latency there is
 * visible on every completed scan.
 */
export type ReasoningPurpose = "verify" | "summary" | "chat";

export function resolveOpenAiReasoningEffort(
  model: string,
  purpose: ReasoningPurpose,
): "low" | "medium" | "high" | null {
  // OpenRouter and similar gateways namespace the id as "vendor/model".
  const id = model.toLowerCase().split("/").pop() ?? "";
  const reasons =
    /^gpt-5/.test(id) ||
    /^o[1-9](-|$)/.test(id) ||
    /^gemini-(2.5|3)/.test(id) ||
    /^grok-4/.test(id);
  if (!reasons) return null;
  if (purpose === "verify") return "high";
  // Chat sits between the two: a support answer benefits from some thought,
  // but the reply streams to someone watching it appear.
  return purpose === "chat" ? "medium" : "low";
}

/**
 * Models that reason on every request whether or not you ask, and take no
 * parameter to control it.
 *
 * These are NOT a gap in the wiring, they are the opposite: sending
 * reasoning_effort to one is at best ignored and at worst a 400. The set
 * exists so that "this model thinks" and "this app asks it to think" can be
 * told apart, which is what the catalog's supportsThinking flag is checked
 * against.
 */
const ALWAYS_REASONS = new Set(["deepseek-reasoner"]);

export function modelReasonsWithoutRequest(model: string): boolean {
  return ALWAYS_REASONS.has(model.toLowerCase().split("/").pop() ?? "");
}

/**
 * Whether this call will actually spend time reasoning before it answers.
 *
 * Three different mechanisms end up in the same place: an Anthropic-shaped
 * request carrying a thinking budget, an OpenAI-compatible request carrying
 * reasoning_effort, and a model that reasons on every request whether asked
 * or not. A timeout has to care about the outcome, not which of the three
 * produced it.
 */
export function callWillReason(
  baseUrl: string | null,
  model: string,
  purpose: ReasoningPurpose,
): boolean {
  if (isAnthropicProvider(baseUrl)) return true;
  if (modelReasonsWithoutRequest(model)) return true;
  return (
    Object.keys(resolveOpenAiCompatReasoningExtras(baseUrl, model, purpose))
      .length > 0
  );
}

/**
 * How long to wait for one AI call, given what that call is about to do.
 *
 * Every AI timeout in this app was a single fixed number chosen against a
 * fast, non-reasoning model, because that is what the managed deployment ran.
 * A reasoning model spends most of its wall clock before the first visible
 * token, so those ceilings cut it off mid-thought, and each surface fails
 * differently and quietly: a verification finding lands as "no verdict"
 * rather than "uncertain", a summary is dropped, a tag suggestion never
 * appears. Nothing errors, so the only symptom is output that got thinner
 * after someone changed the model.
 *
 * The multiplier applies to whatever the admin has configured rather than
 * replacing it, so the fast-model number stays the number an operator tuned,
 * and the reasoning allowance moves with it.
 */
export function resolveAiCallTimeoutMs(
  baseUrl: string | null,
  model: string,
  purpose: ReasoningPurpose,
  configuredMs: number,
  multiplier: number,
): number {
  return callWillReason(baseUrl, model, purpose)
    ? Math.round(configuredMs * multiplier)
    : configuredMs;
}
