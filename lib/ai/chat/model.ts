import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import {
  extractReasoningMiddleware,
  wrapLanguageModel,
  type LanguageModel,
} from "ai";

import { anthropicUsesAdaptiveThinking } from "@/lib/ai/anthropic";
import { isAnthropicProvider } from "@/lib/ai/provider";
import {
  resolveAnthropicThinkingBudget,
  resolveOpenAiCompatReasoningExtras,
} from "@/lib/ai/reasoning";
import { openRouterAttributionHeaders } from "@/lib/ai/transport";

export interface ChatModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  /** Ask the model to reason before answering. The reasoning itself is never
   *  sent to the reader either way; this only decides whether it happens. */
  reasoning: boolean;
}

export interface ResolvedChatModel {
  model: LanguageModel;
  providerOptions: Record<string, Record<string, unknown>>;
}

/**
 * Merge extra top-level fields into an OpenAI-compatible request body.
 *
 * resolveOpenAiCompatReasoningExtras is the one answer to "does this model
 * reason and how is that asked for" for every AI call in the app, and some of
 * its answers (Gemini's google.thinking_config) are not fields the SDK has a
 * setting for. Splicing them into the body keeps that one answer, rather than
 * a second copy expressed as SDK options that could drift from it.
 */
function fetchWithExtraBody(extra: Record<string, unknown>): typeof fetch {
  return async (input, init) => {
    if (init?.body && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        return fetch(input, {
          ...init,
          body: JSON.stringify({ ...body, ...extra }),
        });
      } catch {
        // Not JSON: send it as it was.
      }
    }
    return fetch(input, init);
  };
}

/**
 * The model for one chat request, behind the reasoning extractor.
 *
 * Reasoning reaches this route three ways: Anthropic's thinking blocks, an
 * OpenAI-compatible reasoning field, and models that write it inline as
 * <think>...</think> in the answer text (MiniMax-M2, DeepSeek-R1, QwQ). The
 * first two already arrive as separate reasoning parts. The middleware moves
 * the third out of the text the same way, so the route can drop every
 * reasoning part in one place and the answer the reader sees is only the
 * answer.
 */
export function resolveChatModel(cfg: ChatModelConfig): ResolvedChatModel {
  if (isAnthropicProvider(cfg.baseUrl)) {
    const anthropic = createAnthropic({
      baseURL: cfg.baseUrl,
      apiKey: cfg.apiKey,
    });
    const budget = cfg.reasoning
      ? resolveAnthropicThinkingBudget(cfg.maxTokens)
      : 0;
    // Adaptive models think unless told not to, so "off" has to be said.
    const thinking = anthropicUsesAdaptiveThinking(cfg.model)
      ? budget > 0
        ? { type: "adaptive" }
        : { type: "disabled" }
      : budget > 0
        ? { type: "enabled", budgetTokens: budget }
        : undefined;
    return {
      model: wrapLanguageModel({
        model: anthropic(cfg.model),
        middleware: extractReasoningMiddleware({ tagName: "think" }),
      }),
      providerOptions: thinking ? { anthropic: { thinking } } : {},
    };
  }

  const extras = cfg.reasoning
    ? resolveOpenAiCompatReasoningExtras(cfg.baseUrl, cfg.model, "chat")
    : {};
  const openai = createOpenAI({
    baseURL: cfg.baseUrl,
    // Ollama and LM Studio take no key; the SDK insists on a string.
    apiKey: cfg.apiKey || "not-needed",
    headers: openRouterAttributionHeaders(cfg.baseUrl),
    ...(Object.keys(extras).length
      ? { fetch: fetchWithExtraBody(extras) }
      : {}),
  });
  return {
    // .chat(): /chat/completions, the one surface every OpenAI-compatible
    // endpoint implements. The default would be OpenAI's Responses API.
    model: wrapLanguageModel({
      model: openai.chat(cfg.model),
      middleware: extractReasoningMiddleware({ tagName: "think" }),
    }),
    providerOptions: {},
  };
}
