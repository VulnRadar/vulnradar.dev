import { postChatCompletion, type AiEndpoint } from "@/lib/ai/transport";
import { visibleText } from "@/lib/ai/think-parser";

/**
 * One short answer from the configured model, as plain text.
 *
 * For the small, mechanical asks: what language is this written in, say this
 * again in Japanese. No reasoning budget, no retries, no JSON contract, which
 * is what separates it from lib/ai/verify-findings.ts's own call path: a
 * verdict on a security finding is worth a reasoning model and a second
 * attempt, and a translation is not.
 *
 * Returns null on any failure. A caller of this is always doing something the
 * product can do without: the untranslated message is still the message. The
 * failure is logged, though: returning null quietly meant a wrong model id or
 * an expired key looked, from the admin side, exactly like translation never
 * having been asked for.
 *
 * Inline reasoning is cut from the answer. A model that thinks in <think>
 * tags (MiniMax-M2, DeepSeek-R1) writes them into the content, and this
 * helper's output is sent to a customer as their translated message.
 */
export async function completeShortText(
  endpoint: AiEndpoint,
  input: {
    system: string;
    prompt: string;
    maxTokens: number;
    timeoutMs?: number;
  },
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 30_000);
  try {
    const res = await postChatCompletion(endpoint, {
      system: input.system,
      prompt: input.prompt,
      maxTokens: input.maxTokens,
      reasoning: false,
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(
        `[AI-SHORT-TEXT] HTTP ${res.status} from ${hostOf(endpoint.baseUrl)} (${endpoint.model}): ${res.detail.slice(0, 200)}`,
      );
      return null;
    }
    return visibleText(res.text) || null;
  } catch (err) {
    console.error(
      `[AI-SHORT-TEXT] request to ${hostOf(endpoint.baseUrl)} (${endpoint.model}) failed:`,
      err,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return "invalid-url";
  }
}
