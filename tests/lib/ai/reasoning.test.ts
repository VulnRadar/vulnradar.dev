import { describe, it, expect } from "vitest";
import {
  resolveOpenAiCompatReasoningExtras,
  resolveAnthropicThinkingBudget,
  resolveOpenAiReasoningEffort,
  callWillReason,
  resolveAiCallTimeoutMs,
} from "@/lib/ai/reasoning";

describe("resolveOpenAiCompatReasoningExtras", () => {
  it("adds reasoning_effort for OpenAI o-series models", () => {
    expect(
      resolveOpenAiCompatReasoningExtras("https://api.openai.com/v1", "o1"),
    ).toEqual({ reasoning_effort: "medium" });
    expect(
      resolveOpenAiCompatReasoningExtras(
        "https://api.openai.com/v1",
        "o3-mini",
      ),
    ).toEqual({ reasoning_effort: "medium" });
  });

  it("does not add reasoning_effort for non-reasoning OpenAI models", () => {
    expect(
      resolveOpenAiCompatReasoningExtras("https://api.openai.com/v1", "gpt-4o"),
    ).toEqual({});
  });

  it("adds google.thinking_config for Gemini", () => {
    expect(
      resolveOpenAiCompatReasoningExtras(
        "https://generativelanguage.googleapis.com/v1beta/openai",
        "gemini-2.5-flash",
      ),
    ).toEqual({ google: { thinking_config: { include_thoughts: true } } });
  });

  it("returns nothing for providers with no native reasoning wiring here", () => {
    expect(
      resolveOpenAiCompatReasoningExtras(
        "https://api.minimax.io/v1",
        "MiniMax-M2.7-highspeed",
      ),
    ).toEqual({});
    expect(
      resolveOpenAiCompatReasoningExtras(
        "https://api.groq.com/openai/v1",
        "llama-3.3-70b-versatile",
      ),
    ).toEqual({});
  });
});

describe("resolveAnthropicThinkingBudget", () => {
  it("returns 0 when half of max_tokens is below the 1024 floor", () => {
    expect(resolveAnthropicThinkingBudget(1000)).toBe(0);
    expect(resolveAnthropicThinkingBudget(2000)).toBe(0); // half = 1000 < 1024
  });

  it("returns half of max_tokens once that clears the floor", () => {
    expect(resolveAnthropicThinkingBudget(4096)).toBe(2048);
  });

  it("never returns a budget within 256 tokens of max_tokens", () => {
    const maxTokens = 3000;
    const budget = resolveAnthropicThinkingBudget(maxTokens);
    expect(budget).toBeLessThanOrEqual(maxTokens - 256);
  });
});

describe("resolveOpenAiReasoningEffort", () => {
  it("asks for the most reasoning when verifying, least when summarizing", () => {
    expect(resolveOpenAiReasoningEffort("gpt-5.4", "verify")).toBe("high");
    expect(resolveOpenAiReasoningEffort("gpt-5.4", "chat")).toBe("medium");
    expect(resolveOpenAiReasoningEffort("gpt-5.4", "summary")).toBe("low");
  });

  it("asks for more reasoning when verifying than when summarizing", () => {
    expect(resolveOpenAiReasoningEffort("gpt-5.4", "verify")).toBe("high");
    expect(resolveOpenAiReasoningEffort("gpt-5.4", "summary")).toBe("low");
  });

  it("covers the reasoning families across providers, not just OpenAI", () => {
    for (const id of [
      "gpt-5",
      "gpt-5.4-mini",
      "o3-mini",
      "gemini-3-pro-preview",
      "grok-4.6",
    ]) {
      expect(
        resolveOpenAiReasoningEffort(id, "verify"),
        `${id} should request reasoning`,
      ).toBe("high");
    }
  });

  it("strips a gateway vendor prefix before matching", () => {
    expect(resolveOpenAiReasoningEffort("openai/gpt-5.4", "verify")).toBe(
      "high",
    );
  });

  it("sends nothing for a model that does not take the parameter", () => {
    for (const id of [
      "gpt-4o-mini",
      "mistral-small-latest",
      "llama-3.3-70b-versatile",
      "deepseek-chat",
      "MiniMax-M3",
    ]) {
      expect(
        resolveOpenAiReasoningEffort(id, "verify"),
        `${id} must not be sent reasoning_effort`,
      ).toBeNull();
    }
  });
});

// Every AI timeout in this app was one fixed number tuned against a fast,
// non-reasoning model. A thinking model overran all of them, and each
// surface failed quietly in its own way: no verdict, no summary, no tag.
describe("callWillReason", () => {
  it("is true for an Anthropic-shaped endpoint, whoever the vendor is", () => {
    expect(callWillReason("https://api.anthropic.com/v1", "x", "verify")).toBe(
      true,
    );
    expect(
      callWillReason("https://api.minimax.io/anthropic/v1", "MiniMax-M3", "verify"),
    ).toBe(true);
  });

  it("is true for a model sent reasoning_effort", () => {
    expect(callWillReason("https://api.openai.com/v1", "gpt-5.4", "verify")).toBe(
      true,
    );
    expect(callWillReason("https://api.x.ai/v1", "grok-4.6", "verify")).toBe(true);
  });

  it("is true for a model that reasons whether asked or not", () => {
    expect(
      callWillReason("https://api.deepseek.com/v1", "deepseek-reasoner", "verify"),
    ).toBe(true);
  });

  it("is false for a fast model on an OpenAI-shaped endpoint", () => {
    expect(
      callWillReason("https://api.minimax.io/v1", "MiniMax-M2.7-highspeed", "verify"),
    ).toBe(false);
    expect(
      callWillReason("https://api.openai.com/v1", "gpt-4o-mini", "verify"),
    ).toBe(false);
  });
});

describe("resolveAiCallTimeoutMs", () => {
  it("leaves a fast model on exactly the configured value", () => {
    expect(
      resolveAiCallTimeoutMs(
        "https://api.minimax.io/v1",
        "MiniMax-M2.7-highspeed",
        "verify",
        60_000,
        3,
      ),
    ).toBe(60_000);
  });

  it("multiplies for a reasoning model", () => {
    expect(
      resolveAiCallTimeoutMs(
        "https://api.minimax.io/anthropic/v1",
        "MiniMax-M3",
        "verify",
        60_000,
        3,
      ),
    ).toBe(180_000);
    // The tightest ceiling in the app, and the one most likely to bite.
    expect(
      resolveAiCallTimeoutMs(
        "https://api.anthropic.com/v1",
        "claude-opus-5",
        "summary",
        12_000,
        3,
      ),
    ).toBe(36_000);
  });

  it("is a no-op at a multiplier of 1, so an operator can turn it off", () => {
    expect(
      resolveAiCallTimeoutMs(
        "https://api.anthropic.com/v1",
        "claude-opus-5",
        "verify",
        60_000,
        1,
      ),
    ).toBe(60_000);
  });
});
