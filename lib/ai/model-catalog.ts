/**
 * Real per-model specs (context window, max output tokens) for the AI
 * providers offered in Profile -> AI settings. Numbers are taken from each
 * provider's own published docs. Anything not independently verified is
 * left out rather than guessed — see the per-model `note` fields below for
 * the couple of places that applies.
 *
 * Shape is deliberately flat and dependency-free so this can be imported
 * from anywhere later (e.g. a docs reference table) without dragging
 * anything else in with it.
 */

export interface AiModelSpec {
  id: string;
  label: string;
  /** Total context window, in tokens. Omitted where not independently verified. */
  contextWindow?: number;
  /** Maximum tokens the model can produce in a single response. Omitted where not independently verified. */
  maxOutputTokens?: number;
  /** Accepts a native reasoning/thinking request parameter. */
  supportsThinking?: boolean;
  note?: string;
}

export interface AiProviderCatalogEntry {
  id: string;
  name: string;
  baseUrl: string;
  keyPlaceholder: string;
  keyHint: string;
  models: AiModelSpec[];
}

export const AI_MODEL_CATALOG: AiProviderCatalogEntry[] = [
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    keyPlaceholder: "sk-...",
    keyHint: "Find your API key at platform.openai.com/api-keys",
    models: [
      {
        id: "gpt-5",
        label: "GPT-5",
        contextWindow: 400_000,
        maxOutputTokens: 128_000,
      },
      {
        id: "gpt-5-mini",
        label: "GPT-5 mini",
        contextWindow: 400_000,
        maxOutputTokens: 128_000,
      },
      {
        id: "o3-mini",
        label: "o3-mini (reasoning)",
        contextWindow: 200_000,
        maxOutputTokens: 100_000,
        supportsThinking: true,
        note: "Chat Completions doesn't return this model's reasoning text, only the final answer.",
      },
      {
        id: "gpt-4o",
        label: "GPT-4o",
        contextWindow: 128_000,
        maxOutputTokens: 16_384,
      },
      {
        id: "gpt-4o-mini",
        label: "GPT-4o mini",
        contextWindow: 128_000,
        maxOutputTokens: 16_384,
      },
      {
        id: "gpt-4-turbo",
        label: "GPT-4 Turbo",
        contextWindow: 128_000,
        maxOutputTokens: 4_096,
      },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    baseUrl: "https://api.anthropic.com/v1",
    keyPlaceholder: "sk-ant-...",
    keyHint: "Find your API key at console.anthropic.com",
    models: [
      {
        id: "claude-opus-5",
        label: "Claude Opus 5",
        contextWindow: 1_000_000,
        maxOutputTokens: 128_000,
        supportsThinking: true,
        note: "Elevated safety classifiers may decline requests that look like exploit or malware content, even in a legitimate security-scanning context.",
      },
      {
        id: "claude-opus-4-8",
        label: "Claude Opus 4.8",
        contextWindow: 1_000_000,
        maxOutputTokens: 128_000,
        supportsThinking: true,
      },
      {
        id: "claude-sonnet-5",
        label: "Claude Sonnet",
        contextWindow: 1_000_000,
        maxOutputTokens: 128_000,
        supportsThinking: true,
      },
      {
        id: "claude-haiku-4-5-20251001",
        label: "Claude Haiku",
        contextWindow: 200_000,
        maxOutputTokens: 64_000,
        supportsThinking: true,
      },
    ],
  },
  {
    id: "google",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyPlaceholder: "AIzaSy...",
    keyHint: "Find your API key at aistudio.google.com",
    models: [
      {
        id: "gemini-2.5-pro",
        label: "Gemini 2.5 Pro",
        contextWindow: 1_048_576,
        maxOutputTokens: 65_536,
        supportsThinking: true,
      },
      {
        id: "gemini-2.5-flash",
        label: "Gemini 2.5 Flash",
        contextWindow: 1_048_576,
        maxOutputTokens: 65_536,
        supportsThinking: true,
      },
    ],
  },
  {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    keyPlaceholder: "gsk_...",
    keyHint: "Find your API key at console.groq.com",
    models: [
      {
        id: "llama-3.3-70b-versatile",
        label: "Llama 3.3 70B",
        contextWindow: 131_072,
        maxOutputTokens: 32_768,
      },
      {
        id: "llama-3.1-8b-instant",
        label: "Llama 3.1 8B (fast)",
        contextWindow: 131_072,
        maxOutputTokens: 131_072,
      },
    ],
  },
  {
    id: "mistral",
    name: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    keyPlaceholder: "your-api-key",
    keyHint: "Find your API key at console.mistral.ai",
    models: [
      {
        id: "mistral-large-latest",
        label: "Mistral Large",
        contextWindow: 128_000,
      },
      {
        id: "mistral-small-latest",
        label: "Mistral Small",
        contextWindow: 128_000,
      },
      {
        id: "codestral-latest",
        label: "Codestral",
        contextWindow: 256_000,
        note: "Tuned for code. Same request shape as the other Mistral models.",
      },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyPlaceholder: "sk-or-...",
    keyHint: "Find your API key at openrouter.ai/keys",
    models: [
      {
        id: "openai/gpt-4o-mini",
        label: "GPT-4o mini (via OpenRouter)",
        contextWindow: 128_000,
        maxOutputTokens: 16_384,
      },
      {
        id: "meta-llama/llama-3.3-70b-instruct",
        label: "Llama 3.3 70B (via OpenRouter)",
        contextWindow: 131_072,
      },
    ],
  },
  {
    id: "together",
    name: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    keyPlaceholder: "your-api-key",
    keyHint: "Find your API key at api.together.ai/settings/api-keys",
    models: [
      {
        id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        label: "Llama 3.3 70B Turbo",
        contextWindow: 131_072,
      },
    ],
  },
  {
    id: "minimax",
    name: "MiniMax",
    baseUrl: "https://api.minimax.io/v1",
    keyPlaceholder: "your-api-key",
    keyHint: "Find your API key at platform.minimax.io",
    models: [
      {
        id: "MiniMax-M2.7-highspeed",
        label: "MiniMax M2.7 Speed",
        contextWindow: 204_800,
        maxOutputTokens: 131_072,
        note: "VulnRadar's own managed AI runs this model.",
      },
      {
        id: "MiniMax-M2.7",
        label: "MiniMax M2.7",
        contextWindow: 204_800,
        maxOutputTokens: 131_072,
      },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    keyPlaceholder: "sk-...",
    keyHint: "Find your API key at platform.deepseek.com",
    models: [
      {
        id: "deepseek-chat",
        label: "DeepSeek Chat",
        contextWindow: 128_000,
        maxOutputTokens: 8_000,
      },
      {
        id: "deepseek-reasoner",
        label: "DeepSeek Reasoner",
        contextWindow: 64_000,
        maxOutputTokens: 8_000,
        supportsThinking: true,
        note: "Chain-of-thought reasoning tokens (up to 32K) are separate from this output cap and from the context window.",
      },
    ],
  },
];

export function getProviderCatalogEntry(
  providerId: string,
): AiProviderCatalogEntry | undefined {
  return AI_MODEL_CATALOG.find((p) => p.id === providerId);
}

export function getModelSpec(
  providerId: string,
  modelId: string,
): AiModelSpec | undefined {
  return getProviderCatalogEntry(providerId)?.models.find(
    (m) => m.id === modelId,
  );
}

export function isKnownProviderModel(
  providerId: string,
  modelId: string,
): boolean {
  return getModelSpec(providerId, modelId) !== undefined;
}
