export function isLocalUrl(u: string): boolean {
  if (!u) return false;
  const s = u.toLowerCase();
  if (
    s.includes("localhost") ||
    s.includes("127.0.0.1") ||
    s.includes("0.0.0.0")
  ) {
    return true;
  }
  const host = s
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0];
  if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host)) return true;
  return false;
}

export function resolveProviderName(baseUrl: string | null): string {
  if (!baseUrl) return "Custom LLM";
  if (isLocalUrl(baseUrl)) return "Custom LLM";
  if (baseUrl.includes("api.openai.com")) return "ChatGPT";
  if (baseUrl.includes("api.anthropic.com")) return "Claude";
  if (baseUrl.includes("api.groq.com")) return "Groq";
  if (baseUrl.includes("api.mistral.ai")) return "Mistral";
  if (baseUrl.includes("openrouter.ai")) return "OpenRouter";
  if (baseUrl.includes("api.together.xyz")) return "Together AI";
  if (baseUrl.includes("api.deepseek.com")) return "DeepSeek";
  if (baseUrl.includes("api.minimax.chat")) return "MiniMax";
  if (baseUrl.includes("11434")) return "Ollama";
  if (baseUrl.includes("1234")) return "LM Studio";
  return "Custom LLM";
}
