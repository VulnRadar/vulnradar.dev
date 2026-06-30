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
  if (baseUrl.includes("generativelanguage.googleapis.com")) return "Gemini";
  if (baseUrl.includes("api.groq.com")) return "Groq";
  if (baseUrl.includes("api.mistral.ai")) return "Mistral";
  if (baseUrl.includes("openrouter.ai")) return "OpenRouter";
  if (baseUrl.includes("api.together.xyz")) return "Together AI";
  if (baseUrl.includes("api.deepseek.com")) return "DeepSeek";
  if (baseUrl.includes("api.minimax.chat")) return "MiniMax";
  if (baseUrl.includes("api.x.ai") || baseUrl.includes("api.grok"))
    return "Grok";
  if (baseUrl.includes("api.cohere.ai") || baseUrl.includes("api.cohere."))
    return "Cohere";
  if (baseUrl.includes("api.perplexity.ai")) return "Perplexity";
  if (baseUrl.includes("api.replicate.com")) return "Replicate";
  if (baseUrl.includes("api.fireworks.ai")) return "Fireworks";
  if (baseUrl.includes("api-inference.huggingface.co")) return "Hugging Face";
  if (baseUrl.includes("api.ai21.com")) return "AI21";
  if (baseUrl.includes("api.cerebras.ai")) return "Cerebras";
  if (baseUrl.includes("api.together.xyz")) return "Together AI";
  if (baseUrl.includes("api.galadriel.com")) return "Galadriel";
  if (baseUrl.includes("api.deepinfra.com")) return "DeepInfra";
  if (baseUrl.includes("api.lambdalabs.com")) return "Lambda";
  if (baseUrl.includes("api.runpod.ai")) return "RunPod";
  if (baseUrl.includes("api.vllm.ai") || baseUrl.includes("vllm.ai"))
    return "vLLM";
  if (baseUrl.includes("api.together")) return "Together AI";
  if (baseUrl.includes("api.fireworks")) return "Fireworks";
  if (baseUrl.includes("api.anyscale")) return "Anyscale";
  if (baseUrl.includes("api.deepgram")) return "Deepgram";
  if (baseUrl.includes("api.stability.ai")) return "Stability AI";
  if (baseUrl.includes("api.replicate")) return "Replicate";
  if (baseUrl.includes("api.cohere")) return "Cohere";
  if (baseUrl.includes("api.perplexity")) return "Perplexity";
  if (baseUrl.includes("api.mistral")) return "Mistral";
  if (baseUrl.includes("api.gemini") || baseUrl.includes("generativelanguage"))
    return "Gemini";
  if (baseUrl.includes("api.vertex") || baseUrl.includes("vertexai"))
    return "Vertex AI";
  if (baseUrl.includes("api.bedrock") || baseUrl.includes("bedrock-runtime"))
    return "AWS Bedrock";
  if (baseUrl.includes("api.azure")) return "Azure OpenAI";
  if (baseUrl.includes("aiplatform.googleapis.com")) return "Vertex AI";
  if (baseUrl.includes(":11434")) return "Ollama";
  if (baseUrl.includes(":1234")) return "LM Studio";
  if (baseUrl.includes(":5000") || baseUrl.includes(":8080"))
    return "Local Server";
  return "Custom LLM";
}
