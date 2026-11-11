import { postChatCompletion, type AiEndpoint } from "@/lib/ai/transport";
import { VERIFY_SYSTEM_PROMPT } from "@/lib/ai/verify-context";

/**
 * The transport half of the live eval, kept out of the test file so the test
 * reads as a scorecard rather than as HTTP plumbing.
 *
 * It asks the same question production asks: the same system prompt, the same
 * request builder (postChatCompletion) and the same "verify" reasoning effort.
 * It does NOT reuse verifyFindings itself, because that function resolves the
 * endpoint from the database, meters tokens against a user's quota and writes
 * verdicts back to a scan. The eval has no user and no scan; it wants one
 * question asked of one model.
 *
 * There is no copy of the request here to drift: the wire shape, the
 * Anthropic-versus-OpenAI branch and the retry without a refused reasoning
 * field all live in lib/ai/transport.ts, so a measurement made here is a
 * measurement of what production sends.
 */

export type EvalEndpoint = AiEndpoint;

/** Output tokens per verdict. Matches the shipped AI_VERIFY_MAX_TOKENS default. */
const MAX_TOKENS = 1600;

export async function callVerifyForEval(
  endpoint: EvalEndpoint,
  userPrompt: string,
): Promise<string> {
  const res = await postChatCompletion(endpoint, {
    system: VERIFY_SYSTEM_PROMPT,
    prompt: userPrompt,
    maxTokens: MAX_TOKENS,
    reasoning: "verify",
    scope: "AI-VERIFY-EVAL",
  });

  // An eval that quietly scored a refused request as "unparseable" would read
  // as a bad prompt when the real fault is the endpoint, so a failure throws.
  if (!res.ok) {
    throw new Error(
      `${endpoint.model} answered HTTP ${res.status}: ${res.detail.slice(0, 300)}`,
    );
  }
  return res.text;
}
