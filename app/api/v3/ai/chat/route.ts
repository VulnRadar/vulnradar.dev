import { buildSystemPrompt, sanitizeUserName } from "@/lib/ai/system-prompt";
import {
  resolveProviderName,
  resolveAiBaseUrl,
  resolveAiDefaultModel,
  isAnthropicProvider,
} from "@/lib/ai/provider";
import {
  fetchAnthropicStream,
  createAnthropicSseTranscoder,
} from "@/lib/ai/anthropic";
import {
  resolveOpenAiCompatReasoningExtras,
  resolveAnthropicThinkingBudget,
} from "@/lib/ai/reasoning";
import { APP_NAME } from "@/lib/config/constants";
import { getSession } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { getSettings } from "@/lib/config/runtime-config";
import pool from "@/lib/database/db";
import { checkAiUsageQuota, recordAiTokens } from "@/lib/billing/ai-usage";
import { estimateTokens } from "@/lib/scanner/github-repo-scan";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return Response.json(
      { error: "Sign in to use the AI assistant." },
      { status: 401 },
    );
  }

  // Rate limit: 60 AI messages per user per hour to prevent cost amplification.
  const rl = await checkRateLimit({
    key: `ai-chat:${session.userId}`,
    ...RATE_LIMITS.aiChat,
  });
  if (!rl.allowed) {
    return Response.json(
      {
        error: `Too many AI requests. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minute(s).`,
      },
      { status: 429 },
    );
  }

  // Check if the user is banned from AI chat, and pull the small account
  // facts that get baked into the system prompt (see buildSystemPrompt) in
  // the same round trip.
  const userRow = await pool.query<{
    ai_chat_banned: boolean;
    plan: string | null;
    daily_scan_limit: number | null;
    created_at: string;
  }>(
    "SELECT ai_chat_banned, plan, daily_scan_limit, created_at FROM users WHERE id = $1",
    [session.userId],
  );
  if (userRow.rows[0]?.ai_chat_banned) {
    return Response.json(
      {
        error: "Your account has been restricted from using the AI assistant.",
      },
      { status: 403 },
    );
  }

  // AI chat is free/unmetered -- not gated on the aiTokensPerWindow cap.
  // Still resolves usingOwnAi (below) so usage recording matches the
  // "own key = don't record against VulnRadar's counters" rule the metered
  // AI features (verify, GitHub review) use, purely for admin cost
  // visibility -- it never blocks the request.
  const quota = await checkAiUsageQuota(session.userId);

  const baseUrl = resolveAiBaseUrl();
  const apiKey = process.env.AI_API_KEY ?? "";
  const model = resolveAiDefaultModel(baseUrl);
  const {
    AI_CHAT_MAX_TOKENS: maxTokens,
    AI_CHAT_MAX_INPUT_LENGTH: maxInputLength,
  } = await getSettings([
    "AI_CHAT_MAX_TOKENS",
    "AI_CHAT_MAX_INPUT_LENGTH",
  ] as const);

  if (!baseUrl) {
    return Response.json(
      {
        error:
          "AI is not configured. Set AI_BASE_URL (e.g. http://localhost:11434/v1 for Ollama) and AI_MODEL in your .env file.",
      },
      { status: 503 },
    );
  }

  let body: {
    messages: Array<{ role: string; content: string }>;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { messages } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json(
      { error: "messages array is required." },
      { status: 400 },
    );
  }

  // The client already caps the textarea at this same length for UX, but
  // that's cosmetic -- a direct API call bypasses it entirely. This is the
  // actual enforcement point.
  for (const m of messages) {
    if (typeof m.content === "string" && m.content.length > maxInputLength) {
      return Response.json(
        {
          error: `Message exceeds maximum length of ${maxInputLength} characters.`,
        },
        { status: 400 },
      );
    }
  }

  const userRecord = userRow.rows[0];
  const memberSince = userRecord?.created_at
    ? new Date(userRecord.created_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
      })
    : null;

  // Use the server-verified session name/role — never trust client-supplied
  // account facts.
  const systemPrompt = buildSystemPrompt({
    name: session.name ? sanitizeUserName(session.name) : "User",
    plan: userRecord?.plan ?? null,
    role: session.role,
    dailyScanLimit: userRecord?.daily_scan_limit ?? null,
    memberSince,
  });

  const conversationMessages = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: String(m.content) }));

  // Character-length estimate of the INPUT side, for the ESTIMATED-token
  // fallback below (only used when a provider never returns real usage).
  // Same rough chars-per-token approach as
  // lib/scanner/github-repo-scan.ts's estimateTokens, reused for
  // consistency rather than inventing a second divisor.
  const inputCharCount =
    systemPrompt.length +
    conversationMessages.reduce((sum, m) => sum + m.content.length, 0);

  const providerName = resolveProviderName(baseUrl);
  const isAnthropic = isAnthropicProvider(baseUrl);

  let upstreamRes: Response;
  try {
    if (isAnthropic) {
      upstreamRes = await fetchAnthropicStream({
        baseUrl,
        apiKey,
        model,
        system: systemPrompt,
        messages: conversationMessages as {
          role: "user" | "assistant";
          content: string;
        }[],
        maxTokens,
        thinkingBudgetTokens: resolveAnthropicThinkingBudget(maxTokens),
      });
    } else {
      // Build request payload in OpenAI chat completions format.
      // This is supported by: OpenAI, Ollama, Groq, Mistral, OpenRouter,
      // LM Studio, Together, DeepSeek, Gemini (via its OpenAI-compat
      // endpoint), and more. Anthropic gets its own native adapter above —
      // its real API doesn't speak this format at all.
      const payload = {
        model,
        stream: true,
        // Requests real token usage in one final SSE chunk, on the
        // providers that support this OpenAI stream_options extension:
        // OpenAI, Groq, MiniMax (VulnRadar's own hosted default -- see
        // resolveAiDefaultModel in lib/ai/provider.ts), Mistral,
        // OpenRouter, Together, and DeepSeek are all OpenAI-compatible
        // chat/completions endpoints that pass this option through. A
        // provider that doesn't recognize it (Ollama, LM Studio, and any
        // other self-hosted/custom endpoint) just ignores the unknown key
        // and streams normally with no usage chunk -- the read loop below
        // falls back to a character-length ESTIMATE in that case, and
        // always does so for the native Anthropic path (fetchAnthropicStream
        // below), whose SSE event shape isn't parsed for usage at all.
        stream_options: { include_usage: true },
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: systemPrompt },
          ...conversationMessages,
        ],
        ...resolveOpenAiCompatReasoningExtras(baseUrl, model),
      };

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Most OpenAI-compatible endpoints use Bearer auth.
      // Ollama works with no key or any placeholder value.
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      // OpenRouter requires a site URL header.
      if (new URL(baseUrl).hostname.toLowerCase() === "openrouter.ai") {
        headers["HTTP-Referer"] =
          process.env.NEXT_PUBLIC_APP_URL ?? "https://vulnradar.dev";
        headers["X-Title"] = APP_NAME;
      }

      upstreamRes = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
    }
  } catch (err) {
    console.error("[AI chat] fetch error:", err);
    return Response.json(
      { error: "Could not reach the AI endpoint. Is it running?" },
      { status: 502 },
    );
  }

  if (!upstreamRes.ok) {
    let detail = "";
    try {
      const errBody = await upstreamRes.json();
      detail =
        errBody?.error?.message ?? errBody?.error ?? JSON.stringify(errBody);
    } catch {
      detail = await upstreamRes.text().catch(() => "");
    }
    console.error(`[AI chat] upstream ${upstreamRes.status}:`, detail);
    return Response.json(
      { error: "AI provider is temporarily unavailable. Please try again." },
      { status: 502 },
    );
  }

  if (!upstreamRes.body) {
    return Response.json(
      { error: "AI provider returned an empty response." },
      { status: 502 },
    );
  }

  // Parse the SSE stream from the upstream provider and re-emit plain text
  // so the client can just read chunks directly without parsing SSE format.
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  // Token accounting for this reply. realUsageTokens is set only when the
  // OpenAI-compat path (below) receives a stream_options usage chunk from
  // the provider -- REAL tokens, not an estimate. If it's never set (every
  // Anthropic reply via the native streaming path, or an OpenAI-compat
  // provider that ignored stream_options), the ESTIMATE fallback in the
  // `finally` block below is used instead: (input chars + accumulated
  // output chars) / the same chars-per-token divisor as
  // lib/scanner/github-repo-scan.ts's estimateTokens.
  let realUsageTokens: number | null = null;
  let responseCharCount = 0;

  (async () => {
    const reader = upstreamRes.body!.getReader();

    try {
      if (isAnthropic) {
        const transcoder = createAnthropicSseTranscoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = transcoder.feed(decoder.decode(value, { stream: true }));
          if (text) {
            await writer.write(encoder.encode(text));
            responseCharCount += text.length;
          }
        }
        return;
      }

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE events are newline-delimited. Split and process complete lines.
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith("data:")) continue;

          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;

          try {
            const json = JSON.parse(data);
            // Standard OpenAI format: choices[0].delta.content
            const text = json.choices?.[0]?.delta?.content;
            if (typeof text === "string" && text.length > 0) {
              await writer.write(encoder.encode(text));
              responseCharCount += text.length;
            }
            // Real usage: with stream_options.include_usage requested in
            // the payload above, a supporting provider sends one final
            // chunk carrying a usage field (its own choices array is
            // typically empty on that particular chunk).
            if (json.usage && typeof json.usage === "object") {
              const u = json.usage as {
                prompt_tokens?: number;
                completion_tokens?: number;
                total_tokens?: number;
              };
              realUsageTokens =
                typeof u.total_tokens === "number"
                  ? u.total_tokens
                  : (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0);
            }
          } catch {
            // Not valid JSON — skip (can happen with provider-specific metadata lines)
          }
        }
      }
    } catch (err) {
      console.error("[AI chat] stream read error:", err);
    } finally {
      if (!quota.usingOwnAi) {
        const tokensUsed =
          realUsageTokens ?? estimateTokens(inputCharCount + responseCharCount);
        try {
          await recordAiTokens(session.userId, tokensUsed);
        } catch (err) {
          console.error(
            "[AI chat] Failed to record token usage (non-fatal):",
            err instanceof Error ? err.message : err,
          );
        }
      }
      writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      "X-AI-Model": model,
      "X-AI-Provider-Name": providerName,
      "X-AI-Provider-Url": baseUrl ?? "",
    },
  });
}
