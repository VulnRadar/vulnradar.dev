import { isAnthropicProvider } from "@/lib/ai/provider";
import { callAnthropicMessages } from "@/lib/ai/anthropic";
import {
  resolveAnthropicThinkingBudget,
  resolveOpenAiCompatReasoningExtras,
} from "@/lib/ai/reasoning";
import { VERIFY_SYSTEM_PROMPT } from "@/lib/ai/verify-context";

/**
 * The transport half of the live eval, kept out of the test file so the test
 * reads as a scorecard rather than as HTTP plumbing.
 *
 * It mirrors lib/ai/verify-findings.ts's own call: the same system prompt, the
 * same Anthropic-versus-OpenAI branch, the same "verify" reasoning effort. It
 * does NOT reuse verifyFindings itself, because that function resolves the
 * endpoint from the database, meters tokens against a user's quota and writes
 * verdicts back to a scan. The eval has no user and no scan; it wants one
 * question asked of one model.
 *
 * The consequence to keep in mind: this is a copy of the transport, so it can
 * drift from the real one. What it must not drift on is the SYSTEM PROMPT and
 * the request shape, which is why both come from the same modules production
 * uses rather than being written out here.
 */

export interface EvalEndpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Output tokens per verdict. Matches the shipped AI_VERIFY_MAX_TOKENS default. */
const MAX_TOKENS = 1600;

export async function callVerifyForEval(
  endpoint: EvalEndpoint,
  userPrompt: string,
): Promise<string> {
  if (isAnthropicProvider(endpoint.baseUrl)) {
    const { text } = await callAnthropicMessages({
      baseUrl: endpoint.baseUrl,
      apiKey: endpoint.apiKey,
      model: endpoint.model,
      system: VERIFY_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: MAX_TOKENS,
      thinkingBudgetTokens: resolveAnthropicThinkingBudget(MAX_TOKENS),
    });
    return text;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (endpoint.apiKey) headers["Authorization"] = `Bearer ${endpoint.apiKey}`;

  const res = await fetch(`${endpoint.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: endpoint.model,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: "system", content: VERIFY_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      ...resolveOpenAiCompatReasoningExtras(
        endpoint.baseUrl,
        endpoint.model,
        "verify",
      ),
    }),
  });

  if (!res.ok) {
    throw new Error(
      `${endpoint.model} answered HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data?.choices?.[0]?.message?.content ?? "";
}
