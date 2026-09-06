import { describe, it, expect } from "vitest";
import {
  resolveOpenAiCompatReasoningExtras,
  resolveAnthropicThinkingBudget,
  resolveOpenAiReasoningEffort,
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
