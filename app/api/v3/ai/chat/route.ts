import { buildSystemPrompt, sanitizeUserName } from "@/lib/ai/system-prompt";
import { AI_MAX_TOKENS } from "@/lib/config/constants";

export const runtime = "nodejs";
export const maxDuration = 60;

// Resolve base URL from env vars.
// Supports the new AI_BASE_URL pattern (OpenAI-compatible endpoint)
// as well as the legacy AI_PROVIDER pattern for backwards compat.
function resolveBaseUrl(): string | null {
  if (process.env.AI_BASE_URL) return process.env.AI_BASE_URL.replace(/\/$/, "");

  const provider = process.env.AI_PROVIDER?.toLowerCase();
  if (!provider) return null;

  const KNOWN: Record<string, string> = {
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com/v1",
    minimax: "https://api.minimax.chat/v1",
    groq: "https://api.groq.com/openai/v1",
    mistral: "https://api.mistral.ai/v1",
    openrouter: "https://openrouter.ai/api/v1",
    ollama: "http://localhost:11434/v1",
    lmstudio: "http://localhost:1234/v1",
    together: "https://api.together.xyz/v1",
    deepseek: "https://api.deepseek.com/v1",
  };
  return KNOWN[provider] ?? null;
}

function resolveDefaultModel(baseUrl: string | null): string {
  if (process.env.AI_MODEL) return process.env.AI_MODEL;
  if (!baseUrl) return "gpt-4o-mini";

  if (baseUrl.includes("anthropic.com")) return "claude-haiku-4-5-20251001";
  if (baseUrl.includes("groq.com")) return "llama-3.3-70b-versatile";
  if (baseUrl.includes("mistral.ai")) return "mistral-small-latest";
  if (baseUrl.includes("openrouter.ai")) return "openai/gpt-4o-mini";
  if (baseUrl.includes("together.xyz")) return "meta-llama/Llama-3.3-70B-Instruct-Turbo";
  if (baseUrl.includes("11434")) return "llama3.2";
  if (baseUrl.includes("1234")) return "local-model";
  return "gpt-4o-mini";
}

export async function POST(req: Request) {
  const baseUrl = resolveBaseUrl();
  const apiKey = process.env.AI_API_KEY ?? "";
  const model = resolveDefaultModel(baseUrl);

  if (!baseUrl) {
    return Response.json(
      {
        error:
          "AI is not configured. Set AI_BASE_URL (e.g. http://localhost:11434/v1 for Ollama) and AI_MODEL in your .env file.",
      },
      { status: 503 }
    );
  }

  let body: { messages: Array<{ role: string; content: string }>; userName?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { messages, userName } = body;
  // sanitizeUserName strips newlines, heading markers, and injection framing
  // before the name is placed into the structured <user_context> block.
  const systemPrompt = buildSystemPrompt(
    typeof userName === "string" ? sanitizeUserName(userName) : "Guest"
  );
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "messages array is required." }, { status: 400 });
  }

  // Build request payload in OpenAI chat completions format.
  // This is supported by: OpenAI, Ollama, Groq, Mistral, OpenRouter,
  // LM Studio, Together, DeepSeek, Anthropic (via /v1 compat), and more.
  const payload = {
    model,
    stream: true,
    max_tokens: AI_MAX_TOKENS,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: String(m.content) })),
    ],
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
  if (baseUrl.includes("openrouter.ai")) {
    headers["HTTP-Referer"] = process.env.NEXT_PUBLIC_APP_URL ?? "https://vulnradar.dev";
    headers["X-Title"] = "VulnRadar";
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("[AI chat] fetch error:", err);
    return Response.json(
      { error: "Could not reach the AI endpoint. Is it running?" },
      { status: 502 }
    );
  }

  if (!upstreamRes.ok) {
    let detail = "";
    try {
      const errBody = await upstreamRes.json();
      detail = errBody?.error?.message ?? errBody?.error ?? JSON.stringify(errBody);
    } catch {
      detail = await upstreamRes.text().catch(() => "");
    }
    console.error(`[AI chat] upstream ${upstreamRes.status}:`, detail);
    return Response.json(
      { error: `AI provider returned ${upstreamRes.status}: ${detail || "unknown error"}` },
      { status: 502 }
    );
  }

  if (!upstreamRes.body) {
    return Response.json({ error: "AI provider returned an empty response." }, { status: 502 });
  }

  // Parse the SSE stream from the upstream provider and re-emit plain text
  // so the client can just read chunks directly without parsing SSE format.
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  (async () => {
    const reader = upstreamRes.body!.getReader();
    let buffer = "";

    try {
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
            }
          } catch {
            // Not valid JSON — skip (can happen with provider-specific metadata lines)
          }
        }
      }
    } catch (err) {
      console.error("[AI chat] stream read error:", err);
    } finally {
      writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
