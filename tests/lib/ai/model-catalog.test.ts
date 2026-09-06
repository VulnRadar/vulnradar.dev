import { describe, it, expect } from "vitest";
import { isAnthropicProvider } from "@/lib/ai/provider";
import {
  resolveOpenAiReasoningEffort,
  modelReasonsWithoutRequest,
} from "@/lib/ai/reasoning";
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
    // Derived from the ACTUAL wiring rather than a hand-kept provider list:
    // the previous version listed provider ids, so adding a provider with a
    // thinking model and forgetting to wire it would pass as long as someone
    // also remembered to edit this set. A model earns the flag if this app
    // sends it down the Anthropic body, sends it reasoning_effort, or it is
    // one of the models that reasons unconditionally.
    for (const provider of AI_MODEL_CATALOG) {
      for (const model of provider.models) {
        if (!model.supportsThinking) continue;
        const anthropicShaped = isAnthropicProvider(provider.baseUrl);
        const asked = resolveOpenAiReasoningEffort(model.id, "verify") !== null;
        const always = modelReasonsWithoutRequest(model.id);
        expect(
          anthropicShaped || asked || always,
          `${provider.id}/${model.id} advertises thinking, but nothing sends a reasoning request on that route (anthropic-shaped=${anthropicShaped}, reasoning_effort=${asked}, always-reasons=${always})`,
        ).toBe(true);
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

describe("catalog coverage", () => {
  const all = AI_MODEL_CATALOG.flatMap((p) =>
    p.models.map((m) => ({ provider: p.id, ...m })),
  );

  it("offers MiniMax M3 on both the OpenAI and the Anthropic route", () => {
    const m3 = all.filter((m) => m.id === "MiniMax-M3");
    expect(m3.map((m) => m.provider).sort()).toEqual([
      "minimax",
      "minimax-anthropic",
    ]);
    // 1M context, against 204,800 on the M2.7 line it supersedes.
    for (const m of m3) expect(m.contextWindow).toBe(1_000_000);
  });

  it("has no duplicate provider ids or base URLs", () => {
    const ids = AI_MODEL_CATALOG.map((p) => p.id);
    expect(
      new Set(ids).size,
      `duplicate provider id in ${ids.join(", ")}`,
    ).toBe(ids.length);
    const urls = AI_MODEL_CATALOG.map((p) => p.baseUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("never repeats a model id inside one provider", () => {
    for (const p of AI_MODEL_CATALOG) {
      const ids = p.models.map((m) => m.id);
      expect(new Set(ids).size, `${p.id} repeats a model id`).toBe(ids.length);
    }
  });

  it("gives every model a label and a context window", () => {
    for (const m of all) {
      expect(m.label, `${m.provider}/${m.id} has no label`).toBeTruthy();
      expect(
        m.contextWindow,
        `${m.provider}/${m.id} has no context window`,
      ).toBeGreaterThan(0);
    }
  });
});
