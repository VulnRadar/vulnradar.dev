import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildAnthropicHeaders,
  buildAnthropicBody,
  callAnthropicMessages,
  fetchAnthropicStream,
  createAnthropicSseTranscoder,
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

describe("fetchAnthropicStream", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("posts to /messages with stream: true in the body", async () => {
    await fetchAnthropicStream(baseOpts);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.stream).toBe(true);
    expect((init as RequestInit).headers).toMatchObject({
      "x-api-key": baseOpts.apiKey,
    });
  });
});

describe("createAnthropicSseTranscoder", () => {
  function sseLine(obj: unknown): string {
    return `data: ${JSON.stringify(obj)}\n\n`;
  }

  it("passes through plain text_delta content untouched", () => {
    const { feed } = createAnthropicSseTranscoder();
    const out = feed(
      sseLine({
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Hello" },
      }) +
        sseLine({
          type: "content_block_delta",
          delta: { type: "text_delta", text: " world" },
        }),
    );
    expect(out).toBe("Hello world");
  });

  it("wraps thinking_delta content in synthesized <think> tags", () => {
    const { feed } = createAnthropicSseTranscoder();
    const out = feed(
      sseLine({
        type: "content_block_start",
        content_block: { type: "thinking" },
      }) +
        sseLine({
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking: "reasoning..." },
        }) +
        sseLine({ type: "content_block_stop" }) +
        sseLine({
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Final answer." },
        }),
    );
    expect(out).toBe("<think>reasoning...</think>Final answer.");
  });

  it("buffers an incomplete trailing line across feed() calls", () => {
    const { feed } = createAnthropicSseTranscoder();
    const full = sseLine({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "split" },
    });
    const cut = Math.floor(full.length / 2);
    const first = feed(full.slice(0, cut));
    const second = feed(full.slice(cut));
    expect(first + second).toBe("split");
  });

  it("ignores unknown event types and malformed JSON without throwing", () => {
    const { feed } = createAnthropicSseTranscoder();
    expect(() =>
      feed(
        "data: not-json\n\n" +
          sseLine({ type: "message_start" }) +
          sseLine({
            type: "content_block_delta",
            delta: { type: "text_delta", text: "ok" },
          }),
      ),
    ).not.toThrow();
    const { feed: feed2 } = createAnthropicSseTranscoder();
    const out = feed2(
      "data: not-json\n\n" +
        sseLine({
          type: "content_block_delta",
          delta: { type: "text_delta", text: "ok" },
        }),
    );
    expect(out).toBe("ok");
  });
});
