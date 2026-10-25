import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildAnthropicHeaders,
  buildAnthropicBody,
  callAnthropicMessages,
  anthropicUsesAdaptiveThinking,
  AnthropicApiError,
  ANTHROPIC_VERSION,
} from "@/lib/ai/anthropic";

const baseOpts = {
  baseUrl: "https://api.anthropic.com/v1",
  apiKey: "sk-ant-test",
  model: "claude-haiku-4-5-20251001",
  system: "You are a test assistant.",
  messages: [{ role: "user" as const, content: "hello" }],
  maxTokens: 1024,
};

describe("buildAnthropicHeaders", () => {
  it("uses x-api-key and anthropic-version, not Authorization: Bearer", () => {
    const headers = buildAnthropicHeaders("sk-ant-abc");
    expect(headers["x-api-key"]).toBe("sk-ant-abc");
    expect(headers["anthropic-version"]).toBe(ANTHROPIC_VERSION);
    expect(headers["Authorization"]).toBeUndefined();
  });
});

describe("buildAnthropicBody", () => {
  it("puts the system prompt in a top-level system field, not a messages entry", () => {
    const body = buildAnthropicBody(baseOpts, false);
    expect(body.system).toBe(baseOpts.system);
    expect(body.messages).toEqual(baseOpts.messages);
    expect(
      (body.messages as { role: string }[]).some((m) => m.role === "system"),
    ).toBe(false);
  });

  it("omits thinking when no budget is given", () => {
    const body = buildAnthropicBody(baseOpts, false);
    expect(body.thinking).toBeUndefined();
  });

  it("includes a thinking param when a sufficient budget is given", () => {
    const body = buildAnthropicBody(
      { ...baseOpts, maxTokens: 4096, thinkingBudgetTokens: 2000 },
      false,
    );
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 2000 });
  });

  it("caps the thinking budget so it never reaches max_tokens", () => {
    const body = buildAnthropicBody(
      { ...baseOpts, maxTokens: 2000, thinkingBudgetTokens: 1990 },
      false,
    );
    expect(body.thinking).toEqual({
      type: "enabled",
      budget_tokens: 2000 - 256,
    });
  });

  it("drops thinking entirely when the budget is below Anthropic's 1024 floor", () => {
    const body = buildAnthropicBody(
      { ...baseOpts, thinkingBudgetTokens: 500 },
      false,
    );
    expect(body.thinking).toBeUndefined();
  });

  it("sets stream: true only when requested", () => {
    expect(buildAnthropicBody(baseOpts, true).stream).toBe(true);
    expect(buildAnthropicBody(baseOpts, false).stream).toBe(false);
  });

  it("uses adaptive thinking, not budget_tokens, for Claude Opus 5 / Opus 4.8 / Sonnet 5", () => {
    for (const model of [
      "claude-opus-5",
      "claude-opus-4-8",
      "claude-sonnet-5",
    ]) {
      const body = buildAnthropicBody(
        { ...baseOpts, model, maxTokens: 4096, thinkingBudgetTokens: 2000 },
        false,
      );
      expect(body.thinking).toEqual({ type: "adaptive" });
    }
  });

  it("explicitly disables thinking (rather than omitting it) on adaptive-thinking models when no budget is requested", () => {
    // Claude Opus 5 and Claude Sonnet 5 both run thinking by default when
    // the field is left out entirely, so "don't think" has to be sent, not
    // implied by an absent field.
    const body = buildAnthropicBody(
      { ...baseOpts, model: "claude-sonnet-5" },
      false,
    );
    expect(body.thinking).toEqual({ type: "disabled" });
  });
});

describe("anthropicUsesAdaptiveThinking", () => {
  it("is true for Claude Opus 5, Opus 4.8, and Sonnet 5", () => {
    expect(anthropicUsesAdaptiveThinking("claude-opus-5")).toBe(true);
    expect(anthropicUsesAdaptiveThinking("claude-opus-4-8")).toBe(true);
    expect(anthropicUsesAdaptiveThinking("claude-sonnet-5")).toBe(true);
  });

  it("is false for Claude Haiku 4.5 and unrecognized model ids", () => {
    expect(anthropicUsesAdaptiveThinking("claude-haiku-4-5-20251001")).toBe(
      false,
    );
    expect(anthropicUsesAdaptiveThinking("claude-3-opus-20240229")).toBe(false);
  });
});

describe("callAnthropicMessages", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("calls /messages (not /chat/completions)", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "hi there" }] }),
    });
    await callAnthropicMessages(baseOpts);
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("concatenates text blocks and separates thinking blocks", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [
          { type: "thinking", thinking: "let me consider this" },
          { type: "text", text: "The answer is " },
          { type: "text", text: "42." },
        ],
      }),
    });
    const result = await callAnthropicMessages(baseOpts);
    expect(result.text).toBe("The answer is 42.");
    expect(result.thinking).toBe("let me consider this");
  });

  it("extracts real input/output token usage from the response", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "hi there" }],
        usage: { input_tokens: 120, output_tokens: 45 },
      }),
    });
    const result = await callAnthropicMessages(baseOpts);
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 45 });
  });

  it("defaults usage to zero when the response omits it", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "hi there" }] }),
    });
    const result = await callAnthropicMessages(baseOpts);
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("throws AnthropicApiError with the upstream error message on a non-ok response", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "invalid x-api-key" } }),
    });
    await expect(callAnthropicMessages(baseOpts)).rejects.toThrow(
      AnthropicApiError,
    );
    await expect(callAnthropicMessages(baseOpts)).rejects.toThrow(
      /invalid x-api-key/,
    );
  });
});
