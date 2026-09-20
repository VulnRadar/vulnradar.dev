import { callAnthropicMessages, AnthropicApiError } from "@/lib/ai/anthropic";
import { isAnthropicProvider } from "@/lib/ai/provider";
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
 * product can do without: the untranslated message is still the message.
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
      return text.trim() || null;
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
    if (!res.ok) return null;
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return body.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    if (err instanceof AnthropicApiError) return null;
    return null;
  } finally {
    clearTimeout(timer);
  }
}
