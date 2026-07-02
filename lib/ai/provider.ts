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
  if (host === "api.minimax.chat") return "MiniMax";
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
    host === "aiplatform.googleapis.com" ||
    host.endsWith(".aiplatform.googleapis.com")
  )
    return "Vertex AI";
  if (host.endsWith(".bedrock-runtime.amazonaws.com")) return "AWS Bedrock";
  if (host.endsWith(".openai.azure.com")) return "Azure OpenAI";
  if (port === "11434") return "Ollama";
  if (port === "1234") return "LM Studio";
  if (port === "5000" || port === "8080") return "Local Server";
  return "Custom LLM";
}
