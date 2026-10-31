/**
 * The request half of every one-shot AI call: which URL, which headers, which
 * body, what to do when the endpoint refuses the reasoning field, and where
 * the answer and the token count are in the response.
 *
 * Five modules (verification, scan summaries, tag suggestions, repository
 * review, short completions) each carried their own copy of that. The copies
 * had drifted: the tag suggester sent the reasoning field but, unlike
 * verification, summaries and repository review, did not post again when an
 * endpoint refused it, and the error line differed in all of them. A new
 * gateway header or provider quirk had to be added five times, and a missed
 * copy failed quietly, as an answer that never arrived.
 *
 * This is deliberately only the request. It does not build prompts, parse what
 * the model wrote, log a failure or decide what a failure means, because that
 * differs per caller and the difference is the point: verification reads a 429
 * as "stop the whole pass" and a 401 as "the key is wrong", a tag suggestion
 * reads both as "no tags this time". So an HTTP failure comes back as a value
 * ({ ok: false, status, detail }) for the caller to read, and the Anthropic
 * adapter's thrown error is turned into the same value. A request that got no
 * answer at all (no network, the caller's AbortSignal) still throws, which is
 * what every caller's own try/catch already expects.
 *
 * The chat does not come through here: it streams through the AI SDK
 * (lib/ai/chat/model.ts) and takes only the OpenRouter headers from this file.
 */

import { APP_NAME, APP_URL } from "@/lib/config/constants";
import { AnthropicApiError, callAnthropicMessages } from "@/lib/ai/anthropic";
import { isAnthropicProvider } from "@/lib/ai/provider";
import {
  noteReasoningRefusal,
  resolveAnthropicThinkingBudget,
  resolveOpenAiCompatReasoningExtras,
  type ReasoningPurpose,
} from "@/lib/ai/reasoning";

/** Where a call goes and as whom: an instance-wide endpoint or a user's own. */
export interface AiEndpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ChatCompletionRequest {
  system: string;
  prompt: string;
  maxTokens: number;
  /**
   * How hard the model should think before it answers, named by what the call
   * is for ("verify" asks for the most, "summary" for little), or false for a
   * call that must not think at all, such as a translation that is sent to a
   * customer as written. The purpose decides what goes on the wire:
   * reasoning_effort or Gemini's thinking config for an OpenAI-compatible
   * endpoint, a thinking budget for an Anthropic-shaped one. A model that takes
   * neither is sent neither.
   */
  reasoning: ReasoningPurpose | false;
  /**
   * Anthropic extended-thinking budget in tokens, for an Anthropic-shaped
   * endpoint only. Left out, it is derived from maxTokens when reasoning is on
   * and is zero when it is off; 0 asks for no thinking at all.
   */
  thinkingBudget?: number;
  signal?: AbortSignal;
  /**
   * Names the feature in the notice that an endpoint refused the reasoning
   * field, for example "AI-VERIFY". Only used when reasoning is on.
   */
  scope?: string;
}

export type ChatCompletionResult =
  | {
      ok: true;
      /** The model's reply as sent, "" when the response carried none. Reasoning is not removed here. */
      text: string;
      /** Real tokens the provider reported, 0 when it reported none. */
      tokensUsed: number;
    }
  | {
      ok: false;
      status: number;
      /** What the endpoint said, untruncated. "" when the body could not be read. */
      detail: string;
    };

/**
 * The headers that tell OpenRouter which application a request belongs to, and
 * nothing for any other host.
 *
 * They identify THIS deployment, not the SaaS: APP_URL resolves
 * NEXT_PUBLIC_APP_URL first, so a self-hoster's AI spend is not attributed to
 * vulnradar.dev by a hardcoded fallback. The host is compared exactly, so a
 * lookalike such as openrouter.ai.example.com gets nothing.
 */
export function openRouterAttributionHeaders(
  baseUrl: string,
): Record<string, string> {
  try {
    if (new URL(baseUrl).hostname.toLowerCase() === "openrouter.ai") {
      return { "HTTP-Referer": APP_URL, "X-Title": APP_NAME };
    }
  } catch {
    // An unparseable base URL fails at request time with a clearer error.
  }
  return {};
}

async function readText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

/** Anthropic-shaped endpoints (Claude itself, and providers' /anthropic paths). */
async function postToMessagesApi(
  endpoint: AiEndpoint,
  request: ChatCompletionRequest,
): Promise<ChatCompletionResult> {
  try {
    const { text, usage } = await callAnthropicMessages(
      {
        baseUrl: endpoint.baseUrl,
        apiKey: endpoint.apiKey,
        model: endpoint.model,
        system: request.system,
        messages: [{ role: "user", content: request.prompt }],
        maxTokens: request.maxTokens,
        thinkingBudgetTokens:
          request.thinkingBudget ??
          (request.reasoning
            ? resolveAnthropicThinkingBudget(request.maxTokens)
            : 0),
      },
      request.signal,
    );
    return {
      ok: true,
      text,
      tokensUsed: usage.inputTokens + usage.outputTokens,
    };
  } catch (err) {
    if (err instanceof AnthropicApiError) {
      return { ok: false, status: err.status, detail: err.detail };
    }
    throw err;
  }
}

async function postToChatCompletionsApi(
  endpoint: AiEndpoint,
  request: ChatCompletionRequest,
): Promise<ChatCompletionResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...openRouterAttributionHeaders(endpoint.baseUrl),
  };
  // Ollama and LM Studio take no key.
  if (endpoint.apiKey) headers["Authorization"] = `Bearer ${endpoint.apiKey}`;

  const extras = request.reasoning
    ? resolveOpenAiCompatReasoningExtras(
        endpoint.baseUrl,
        endpoint.model,
        request.reasoning,
      )
    : {};
  const askedToReason = Object.keys(extras).length > 0;
  const baseBody: Record<string, unknown> = {
    model: endpoint.model,
    max_tokens: request.maxTokens,
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.prompt },
    ],
  };
  const post = (body: Record<string, unknown>) =>
    fetch(`${endpoint.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: request.signal,
    });

  let res = await post({ ...baseBody, ...extras });
  // A strict endpoint answers an unknown body field with a 400. Reasoning is
  // an optional quality knob and the allowlist in resolveOpenAiReasoningEffort
  // cannot be right for every model, so losing the answer over it is the wrong
  // trade: drop the field and ask once more. Only when the 400 says it is about
  // reasoning, and only when the field was sent, so an unrelated 400 is not
  // repeated into the same wall.
  if (!res.ok && res.status === 400 && askedToReason) {
    const refusal = await readText(res);
    if (!/reasoning/i.test(refusal)) {
      return { ok: false, status: res.status, detail: refusal };
    }
    noteReasoningRefusal(request.scope ?? "AI", endpoint.model);
    res = await post(baseBody);
  }

  if (!res.ok) {
    return { ok: false, status: res.status, detail: await readText(res) };
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
  const content = data?.choices?.[0]?.message?.content;
  const usage = data?.usage;
  const tokensUsed =
    typeof usage?.total_tokens === "number"
      ? usage.total_tokens
      : (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0);
  return {
    ok: true,
    text: typeof content === "string" ? content : "",
    tokensUsed,
  };
}

/**
 * One system prompt and one user prompt in, one reply out, against whichever
 * API the endpoint speaks.
 */
export async function postChatCompletion(
  endpoint: AiEndpoint,
  request: ChatCompletionRequest,
): Promise<ChatCompletionResult> {
  return isAnthropicProvider(endpoint.baseUrl)
    ? postToMessagesApi(endpoint, request)
    : postToChatCompletionsApi(endpoint, request);
}
