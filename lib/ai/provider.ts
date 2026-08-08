function urlHost(u: string): string {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

function urlPort(u: string): string {
  try {
    return new URL(u).port;
  } catch {
    return "";
  }
}

export function isLocalUrl(u: string): boolean {
  if (!u) return false;
  const host = urlHost(u);
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
    return true;
  }
  if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host)) return true;
  return false;
}

export function resolveProviderName(baseUrl: string | null): string {
  if (!baseUrl) return "Custom LLM";
  if (isLocalUrl(baseUrl)) return "Custom LLM";
  const host = urlHost(baseUrl);
  const port = urlPort(baseUrl);
  if (host === "api.openai.com") return "ChatGPT";
  if (host === "api.anthropic.com") return "Claude";
  if (host === "generativelanguage.googleapis.com") return "Gemini";
  if (host === "api.groq.com") return "Groq";
  if (host === "api.mistral.ai") return "Mistral";
  if (host === "openrouter.ai") return "OpenRouter";
  if (host === "api.together.xyz") return "Together AI";
  if (host === "api.deepseek.com") return "DeepSeek";
  // api.minimax.io is MiniMax's current global API domain. api.minimax.chat
  // is the retired domain some older self-hosted .env files may still have,
  // and api.minimaxi.com is the Mainland China region host.
  if (
    host === "api.minimax.io" ||
    host === "api.minimax.chat" ||
    host === "api.minimaxi.com"
  )
    return "MiniMax";
  if (host === "api.x.ai" || host === "api.grok") return "Grok";
  if (host === "api.cohere.ai" || host === "api.cohere.com") return "Cohere";
  if (host === "api.perplexity.ai") return "Perplexity";
  if (host === "api.replicate.com") return "Replicate";
  if (host === "api.fireworks.ai") return "Fireworks";
  if (host === "api-inference.huggingface.co") return "Hugging Face";
  if (host === "api.ai21.com") return "AI21";
  if (host === "api.cerebras.ai") return "Cerebras";
  if (host === "api.galadriel.com") return "Galadriel";
  if (host === "api.deepinfra.com") return "DeepInfra";
  if (host === "api.lambdalabs.com") return "Lambda";
  if (host === "api.runpod.ai") return "RunPod";
  if (host === "api.vllm.ai" || host.endsWith(".vllm.ai")) return "vLLM";
  if (host === "api.anyscale.com") return "Anyscale";
  if (host.endsWith(".deepgram.com")) return "Deepgram";
  if (host === "api.stability.ai") return "Stability AI";
  if (
    host.endsWith(".vertexai.googleapis.com") ||
    // Regional Vertex AI endpoints are hyphen-, not dot-, prefixed
    // (e.g. "us-central1-aiplatform.googleapis.com"), so this can't reuse
    // the plain host === X || host.endsWith("." + X) form used elsewhere
    // in this function. Anchored full-string match instead of a bare
    // endsWith("aiplatform.googleapis.com") so a lookalike like
    // "notaiplatform.googleapis.com" can't slip through the missing
    // separator the way it could with an unanchored suffix check.
    /^([a-z0-9-]+-)?aiplatform\.googleapis\.com$/i.test(host)
  )
    return "Vertex AI";
  if (host.endsWith(".bedrock-runtime.amazonaws.com")) return "AWS Bedrock";
  if (host.endsWith(".openai.azure.com")) return "Azure OpenAI";
  if (port === "11434") return "Ollama";
  if (port === "1234") return "LM Studio";
  if (port === "5000" || port === "8080") return "Local Server";
  return "Custom LLM";
}

/**
 * True only for Anthropic's real API host. Every call site that needs to
 * pick between the native Anthropic adapter (lib/ai/anthropic.ts) and the
 * OpenAI-compatible request path uses this one function, so detection can't
 * drift between chat/route.ts, verify-findings.ts, and verify-audit.ts.
 */
export function isAnthropicProvider(baseUrl: string | null): boolean {
  return resolveProviderName(baseUrl) === "Claude";
}

/**
 * Base URLs for the AI_PROVIDER shorthand env var. Single source of truth —
 * every caller resolves its endpoint through resolveAiBaseUrl() /
 * resolveAiDefaultModel() below instead of keeping its own copy. Keeping
 * four independent copies of this map is exactly how the MiniMax entry
 * previously drifted to a retired domain (api.minimax.chat) in some copies
 * while others stayed in sync.
 */
export const KNOWN_PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  // MiniMax's current global API domain (see resolveProviderName above).
  minimax: "https://api.minimax.io/v1",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  ollama: "http://localhost:11434/v1",
  lmstudio: "http://localhost:1234/v1",
  together: "https://api.together.xyz/v1",
  deepseek: "https://api.deepseek.com/v1",
};

/**
 * Resolves the AI base URL from env vars. Supports the AI_BASE_URL pattern
 * (any OpenAI-compatible or Anthropic endpoint) as well as the legacy
 * AI_PROVIDER shorthand.
 */
export function resolveAiBaseUrl(): string | null {
  if (process.env.AI_BASE_URL)
    return process.env.AI_BASE_URL.replace(/\/$/, "");

  const provider = process.env.AI_PROVIDER?.toLowerCase();
  if (!provider) return null;
  return KNOWN_PROVIDER_BASE_URLS[provider] ?? null;
}

/**
 * Default model id per provider when AI_MODEL isn't set. VulnRadar's own
 * managed AI runs MiniMax M2.7 Speed (MiniMax-M2.7-highspeed) — see
 * lib/ai/model-catalog.ts for the full catalog this is drawn from.
 */
export function resolveAiDefaultModel(baseUrl: string | null): string {
  if (process.env.AI_MODEL) return process.env.AI_MODEL;
  if (!baseUrl) return "gpt-4o-mini";

  let host = "";
  let port = "";
  try {
    const u = new URL(baseUrl);
    host = u.hostname.toLowerCase();
    port = u.port;
  } catch {
    host = baseUrl.toLowerCase();
  }

  if (host === "api.anthropic.com") return "claude-haiku-4-5-20251001";
  if (
    host === "api.minimax.io" ||
    host === "api.minimax.chat" ||
    host === "api.minimaxi.com"
  )
    return "MiniMax-M2.7-highspeed";
  if (host === "api.groq.com") return "llama-3.3-70b-versatile";
  if (host === "api.mistral.ai") return "mistral-small-latest";
  if (host === "openrouter.ai") return "openai/gpt-4o-mini";
  if (host === "api.together.xyz")
    return "meta-llama/Llama-3.3-70B-Instruct-Turbo";
  if (port === "11434") return "llama3.2";
  if (port === "1234") return "local-model";
  return "gpt-4o-mini";
}
