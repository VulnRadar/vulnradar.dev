import { resolveProviderName } from "@/lib/ai/provider";

export const runtime = "nodejs";

function resolveBaseUrl(): string | null {
  if (process.env.AI_BASE_URL)
    return process.env.AI_BASE_URL.replace(/\/$/, "");

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

function resolveModel(baseUrl: string | null): string {
  if (process.env.AI_MODEL) return process.env.AI_MODEL;
  if (!baseUrl) return "gpt-4o-mini";
  let host = "";
  let port = "";
  try {
    const u = new URL(baseUrl);
    host = u.hostname;
    port = u.port;
  } catch {
    return "gpt-4o-mini";
  }
  if (host.endsWith("anthropic.com")) return "claude-haiku-4-5-20251001";
  if (host.endsWith("groq.com")) return "llama-3.3-70b-versatile";
  if (host.endsWith("mistral.ai")) return "mistral-small-latest";
  if (host.endsWith("openrouter.ai")) return "openai/gpt-4o-mini";
  if (host.endsWith("together.xyz"))
    return "meta-llama/Llama-3.3-70B-Instruct-Turbo";
  if (port === "11434") return "llama3.2";
  if (port === "1234") return "local-model";
  return "gpt-4o-mini";
}

export async function GET() {
  const baseUrl = resolveBaseUrl();
  const configured = !!baseUrl && !!process.env.AI_API_KEY;
  return Response.json({
    configured,
    model: resolveModel(baseUrl),
    provider: resolveProviderName(baseUrl),
  });
}
