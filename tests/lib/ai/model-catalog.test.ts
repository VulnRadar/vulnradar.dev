import { describe, it, expect } from "vitest";
import {
  AI_MODEL_CATALOG,
  getProviderCatalogEntry,
  getModelSpec,
  isKnownProviderModel,
} from "@/lib/ai/model-catalog";
import { KNOWN_PROVIDER_BASE_URLS } from "@/lib/ai/provider";

describe("AI_MODEL_CATALOG", () => {
  it("has no duplicate provider ids", () => {
    const ids = AI_MODEL_CATALOG.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no duplicate model ids within a provider", () => {
    for (const provider of AI_MODEL_CATALOG) {
      const ids = provider.models.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("every model with a spec has a positive context window and output cap", () => {
    for (const provider of AI_MODEL_CATALOG) {
      for (const model of provider.models) {
        if (model.contextWindow !== undefined) {
          expect(model.contextWindow).toBeGreaterThan(0);
        }
        if (model.maxOutputTokens !== undefined) {
          expect(model.maxOutputTokens).toBeGreaterThan(0);
        }
      }
    }
  });

  it("includes MiniMax M2.7 Speed as VulnRadar's production model", () => {
    const minimax = getProviderCatalogEntry("minimax");
    expect(minimax?.baseUrl).toBe("https://api.minimax.io/v1");
    const speed = getModelSpec("minimax", "MiniMax-M2.7-highspeed");
    expect(speed).toBeDefined();
    expect(speed?.contextWindow).toBeGreaterThan(0);
  });

  it("every model with supportsThinking has a real reasoning path (Anthropic native adapter or the OpenAI-compat reasoning_effort/thinking_config wiring)", () => {
    // This isn't exhaustive provider detection, it's a guard against
    // flagging a model as "thinking-capable" for a provider this app has no
    // native or OpenAI-compat reasoning wiring for at all.
    const providersWithReasoningWiring = new Set([
      "openai",
      "anthropic",
      "google",
      "deepseek",
    ]);
    for (const provider of AI_MODEL_CATALOG) {
      for (const model of provider.models) {
        if (model.supportsThinking) {
          expect(providersWithReasoningWiring.has(provider.id)).toBe(true);
        }
      }
    }
  });

  it("keeps each provider's baseUrl in sync with the KNOWN_PROVIDER_BASE_URLS map in provider.ts, for providers present in both", () => {
    // provider.ts documents that keeping independent copies of provider base
    // URLs is exactly how the MiniMax entry once drifted to a retired
    // domain. This guards the catalog side of that single-source-of-truth
    // claim for every provider id the two files share.
    for (const provider of AI_MODEL_CATALOG) {
      const known = KNOWN_PROVIDER_BASE_URLS[provider.id];
      if (known !== undefined) {
        expect(provider.baseUrl).toBe(known);
      }
    }
  });
});

describe("getProviderCatalogEntry", () => {
  it("returns undefined for an unknown provider id", () => {
    expect(getProviderCatalogEntry("not-a-provider")).toBeUndefined();
  });
});

describe("isKnownProviderModel", () => {
  it("is true for a real provider/model pair", () => {
    expect(isKnownProviderModel("openai", "gpt-4o")).toBe(true);
  });

  it("is false for an unknown model under a real provider", () => {
    expect(isKnownProviderModel("openai", "gpt-3.5-turbo")).toBe(false);
  });

  it("is false for an unknown provider entirely", () => {
    expect(isKnownProviderModel("not-a-provider", "gpt-4o")).toBe(false);
  });
});
