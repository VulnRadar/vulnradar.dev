import { callAnthropicMessages, AnthropicApiError } from "@/lib/ai/anthropic";
import { isAnthropicProvider } from "@/lib/ai/provider";
import { visibleText } from "@/lib/ai/think-parser";
import { APP_NAME, APP_URL } from "@/lib/config/constants";
import type { AiEndpoint } from "@/lib/ai/verify-findings";

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
    if (isAnthropicProvider(endpoint.baseUrl)) {
      const { text } = await callAnthropicMessages(
        {
          baseUrl: endpoint.baseUrl,
          apiKey: endpoint.apiKey,
          model: endpoint.model,
          system: input.system,
          messages: [{ role: "user", content: input.prompt }],
          maxTokens: input.maxTokens,
        },
        controller.signal,
      );
      return visibleText(text) || null;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (endpoint.apiKey) headers["Authorization"] = `Bearer ${endpoint.apiKey}`;
    try {
      if (
        new URL(endpoint.baseUrl).hostname.toLowerCase() === "openrouter.ai"
      ) {
        headers["HTTP-Referer"] = APP_URL;
        headers["X-Title"] = APP_NAME;
      }
    } catch {
      /* a malformed base URL fails on the fetch below, not here */
    }

    const res = await fetch(`${endpoint.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: endpoint.model,
        max_tokens: input.maxTokens,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.prompt },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(
        `[AI-SHORT-TEXT] HTTP ${res.status} from ${hostOf(endpoint.baseUrl)} (${endpoint.model}): ${detail.slice(0, 200)}`,
      );
      return null;
    }
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return visibleText(body.choices?.[0]?.message?.content ?? "") || null;
  } catch (err) {
    console.error(
      `[AI-SHORT-TEXT] request to ${hostOf(endpoint.baseUrl)} (${endpoint.model}) failed:`,
      err instanceof AnthropicApiError
        ? `HTTP ${err.status} ${err.detail.slice(0, 200)}`
        : err,
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
