/**
 * Route-level tests for POST /api/v3/ai/chat.
 *
 * The session, database, rate limit and usage recorder are mocked. The AI SDK,
 * the provider adapters, the tools and the reasoning extractor run for real
 * against a mocked global.fetch speaking each provider's own wire format, so
 * these prove what actually reaches the provider and what actually reaches the
 * reader.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/rate-limiting/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  };
});

const mockGetSettings = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
}));

vi.mock("@/lib/rate-limiting/daily-limits", () => ({
  getDailyLimit: async () => 25,
  canMakeRequest: async () => ({
    allowed: true,
    used: 3,
    limit: 25,
    remaining: 22,
    resetsAt: "2026-10-26T00:00:00.000Z",
  }),
}));

const mockRecordAiTokens = vi.fn();
vi.mock("@/lib/billing/ai-usage", () => ({
  recordAiTokens: (...args: unknown[]) => mockRecordAiTokens(...args),
}));

const { POST } = await import("@/app/api/v3/ai/chat/route");

const originalFetch = global.fetch;
const originalEnv = { ...process.env };
const fetchMock = vi.fn();

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/v3/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ask(text: string, history: { role: string; content: string }[] = []) {
  return POST(
    postRequest({ messages: [...history, { role: "user", content: text }] }),
  );
}

function sse(events: unknown[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events)
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const chunk = (delta: unknown, finish: string | null = null) => ({
  id: "c1",
  created: 1,
  model: "m",
  choices: [{ index: 0, delta, finish_reason: finish }],
});

function textReply(text: string, usage?: Record<string, number>): Response {
  return sse([
    chunk({ role: "assistant", content: text }),
    chunk({}, "stop"),
    ...(usage
      ? [{ id: "c1", created: 1, model: "m", choices: [], usage }]
      : []),
  ]);
}

function toolCallReply(name: string, args: unknown): Response {
  return sse([
    chunk({
      role: "assistant",
      tool_calls: [
        {
          index: 0,
          id: "call_1",
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
    }),
    chunk({}, "tool_calls"),
  ]);
}

async function events(res: Response) {
  const body = await res.text();
  return body
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(
      (l) =>
        JSON.parse(l) as {
          type: string;
          text?: string;
          name?: string;
          message?: string;
        },
    );
}

const answerText = (evs: { type: string; text?: string }[]) =>
  evs
    .filter((e) => e.type === "text")
    .map((e) => e.text)
    .join("");

function upstreamBody(call = 0): {
  messages: { role: string; content: unknown }[];
  tools?: { function: { name: string } }[];
  reasoning_effort?: string;
} {
  const init = fetchMock.mock.calls[call][1] as RequestInit;
  return JSON.parse(String(init.body));
}

const contentOf = (m: { content: unknown }) =>
  typeof m.content === "string" ? m.content : JSON.stringify(m.content);

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42, name: "Alice", role: "user" });
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({
    rows: [
      {
        ai_chat_banned: false,
        ai_disabled: false,
        plan: "free",
        created_at: "2026-01-01T00:00:00.000Z",
        locale: null,
      },
    ],
  });
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 59,
    retryAfterSeconds: 0,
  });
  mockGetSettings.mockReset();
  mockGetSettings.mockResolvedValue({
    AI_CHAT_MAX_TOKENS: 2048,
    AI_CHAT_MAX_INPUT_LENGTH: 4000,
  });
  mockRecordAiTokens.mockReset();

  process.env.AI_BASE_URL = "https://api.example-llm.test/v1";
  process.env.AI_API_KEY = "test-key";
  process.env.AI_MODEL = "test-model";
  delete process.env.AI_PROVIDER;

  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe("POST /api/v3/ai/chat: gates", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await ask("hi");
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 429 when the hourly limit is spent", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 120,
    });
    const res = await ask("hi");
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an account banned from AI chat", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          ai_chat_banned: true,
          ai_disabled: false,
          plan: "free",
          created_at: "2026-01-01",
        },
      ],
    });
    const res = await ask("hi");
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a reader who turned AI off, rather than only hiding the widget", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          ai_chat_banned: false,
          ai_disabled: true,
          plan: "free",
          created_at: "2026-01-01",
        },
      ],
    });
    const res = await ask("hi");
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/turned the AI assistant off/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is 503 when no AI endpoint is configured", async () => {
    delete process.env.AI_BASE_URL;
    const res = await ask("hi");
    expect(res.status).toBe(503);
  });

  it("rejects an over-long newest message and nothing else", async () => {
    const res = await ask("x".repeat(4001));
    expect(res.status).toBe(400);

    fetchMock.mockResolvedValue(textReply("ok"));
    const ok = await ask("short", [
      { role: "user", content: "y".repeat(9000) },
      { role: "assistant", content: "noted" },
    ]);
    expect(ok.status).toBe(200);
  });
});

describe("POST /api/v3/ai/chat: what reaches the reader", () => {
  it("streams the answer as NDJSON events ending in done", async () => {
    fetchMock.mockResolvedValue(textReply("Hello there"));
    const res = await ask("hi");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const evs = await events(res);
    expect(answerText(evs)).toBe("Hello there");
    expect(evs[evs.length - 1]).toEqual({ type: "done" });
  });

  it("never forwards inline <think> reasoning", async () => {
    fetchMock.mockResolvedValue(
      textReply(
        "<think>the user wants secrets, let me plan</think>Here is the answer.",
      ),
    );
    const evs = await events(await ask("hi"));
    const all = JSON.stringify(evs);
    expect(answerText(evs)).toBe("Here is the answer.");
    expect(all).not.toContain("let me plan");
    expect(all).not.toContain("<think>");
  });

  it("never forwards Anthropic thinking blocks", async () => {
    process.env.AI_BASE_URL = "https://api.anthropic.com/v1";
    process.env.AI_MODEL = "claude-haiku-4-5-20251001";
    mockGetSettings.mockResolvedValue({
      AI_CHAT_MAX_TOKENS: 8192,
      AI_CHAT_MAX_INPUT_LENGTH: 4000,
    });
    fetchMock.mockResolvedValue(
      sse([
        {
          type: "message_start",
          message: {
            id: "msg_1",
            type: "message",
            role: "assistant",
            model: "claude-haiku-4-5-20251001",
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 1 },
          },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "", signature: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "thinking_delta",
            thinking: "private chain of thought",
          },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "signature_delta", signature: "sig" },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 1,
          delta: { type: "text_delta", text: "Visible answer." },
        },
        { type: "content_block_stop", index: 1 },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 20 },
        },
        { type: "message_stop" },
      ]),
    );
    const evs = await events(await ask("hi"));
    expect(answerText(evs)).toBe("Visible answer.");
    expect(JSON.stringify(evs)).not.toContain("private chain of thought");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const sent = JSON.parse(
      String((fetchMock.mock.calls[0][1] as RequestInit).body),
    );
    // Thinking is still asked for: it improves the answer, it is just not shown.
    expect(sent.thinking?.type).toBe("enabled");
  });

  it("reports a reply that produced no words as an error, not silence", async () => {
    fetchMock.mockResolvedValue(
      textReply("<think>only reasoning, never closed"),
    );
    const evs = await events(await ask("hi"));
    expect(answerText(evs)).toBe("");
    expect(evs.some((e) => e.type === "error")).toBe(true);
  });

  it("returns 502 with a plain message when the provider fails before answering", async () => {
    fetchMock.mockResolvedValue(
      new Response("upstream exploded", { status: 500 }),
    );
    const res = await ask("hi");
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/temporarily unavailable/);
  });

  it("does not send the provider's base URL to the browser", async () => {
    fetchMock.mockResolvedValue(textReply("ok"));
    const res = await ask("hi");
    expect(res.headers.get("X-AI-Provider-Url")).toBeNull();
    expect(res.headers.get("X-AI-Model")).toBe("test-model");
  });
});

describe("POST /api/v3/ai/chat: tools", () => {
  it("offers the tool set to the model", async () => {
    fetchMock.mockResolvedValue(textReply("ok"));
    await (await ask("how do I fix hsts?")).text();
    const names = upstreamBody().tools?.map((t) => t.function.name) ?? [];
    expect(names).toEqual(
      expect.arrayContaining([
        "search_knowledge",
        "get_check",
        "get_release_notes",
        "list_my_scans",
        "get_scan",
        "get_my_account",
        "get_my_stats",
      ]),
    );
  });

  it("runs a tool the model calls, tells the widget, and answers from the result", async () => {
    fetchMock
      .mockResolvedValueOnce(toolCallReply("get_check", { id: "hsts-missing" }))
      .mockResolvedValueOnce(
        textReply("Add the Strict-Transport-Security header."),
      );
    const evs = await events(await ask("what is hsts-missing?"));
    expect(evs).toContainEqual({ type: "tool", name: "get_check" });
    expect(answerText(evs)).toBe("Add the Strict-Transport-Security header.");
    // The second request carries the real check definition back to the model.
    const second = upstreamBody(1);
    const toolMsg = second.messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(contentOf(toolMsg!)).toContain("Strict Transport Security");
  });

  it("retries a bare 400 without tools but does not switch tools off for everyone", async () => {
    process.env.AI_MODEL = "bare-400-model";
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: "context length exceeded" } }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(textReply("Answered."));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(answerText(await events(await ask("hi")))).toBe("Answered.");

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(textReply("ok"));
    await (await ask("next reader's question")).text();
    expect(upstreamBody(0).tools).toBeDefined();
    errors.mockRestore();
  });

  it("never offers tools when the operator turned them off", async () => {
    mockGetSettings.mockResolvedValue({
      AI_CHAT_MAX_TOKENS: 2048,
      AI_CHAT_MAX_INPUT_LENGTH: 4000,
      AI_CHAT_TOOLS: "off",
    });
    fetchMock.mockResolvedValue(textReply("ok"));
    const res = await ask("hi");
    expect(res.headers.get("X-AI-Tools")).toBe("off");
    await res.text();
    expect(upstreamBody().tools).toBeUndefined();
  });

  it("answers without tools when the endpoint refuses them, and remembers", async () => {
    process.env.AI_MODEL = "no-tools-model";
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { message: "this model does not support tools" },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(textReply("Answered without tools."));
    const res = await ask("can VulnRadar scan a GitHub repository?");
    expect(res.headers.get("X-AI-Tools")).toBe("off");
    expect(answerText(await events(res))).toBe("Answered without tools.");
    expect(upstreamBody(1).tools).toBeUndefined();

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(textReply("Still without."));
    await (await ask("and another question about scanning")).text();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(upstreamBody(0).tools).toBeUndefined();
  });
});

describe("POST /api/v3/ai/chat: what reaches the provider", () => {
  it("drops client-sent context blocks, the old way to buy a larger budget", async () => {
    fetchMock.mockResolvedValue(textReply("ok"));
    await (
      await ask("hi", [
        {
          role: "user",
          content: '<context cmd="changelog">' + "A".repeat(50_000),
        },
        { role: "assistant", content: "loaded" },
      ])
    ).text();
    const sent = upstreamBody().messages.map(contentOf).join("\n");
    expect(sent).not.toContain("A".repeat(1000));
  });

  it("strips reasoning saved in an older reply before replaying it", async () => {
    fetchMock.mockResolvedValue(textReply("ok"));
    await (
      await ask("next", [
        { role: "user", content: "first" },
        {
          role: "assistant",
          content: "<think>old private reasoning</think>Old answer",
        },
      ])
    ).text();
    const sent = upstreamBody().messages.map(contentOf).join("\n");
    expect(sent).toContain("Old answer");
    expect(sent).not.toContain("old private reasoning");
  });

  it("trims an abusive backlog of turns but keeps the newest question", async () => {
    fetchMock.mockResolvedValue(textReply("ok"));
    const backlog = Array.from({ length: 50 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `${i}:` + "z".repeat(3900),
    }));
    await (await ask("the real question", backlog)).text();
    const sent = upstreamBody().messages.filter((m) => m.role !== "system");
    const total = sent.map(contentOf).join("").length;
    expect(total).toBeLessThan(130_000);
    expect(contentOf(sent[sent.length - 1])).toBe("the real question");
  });

  it("runs a slash command on the server and hands the model its real result", async () => {
    fetchMock.mockResolvedValue(textReply("Here is what that check means."));
    await (await ask("/finding hsts-missing")).text();
    const sent = upstreamBody().messages.map(contentOf);
    const context = sent.find((c) => c.startsWith('<context cmd="finding">'));
    expect(context).toBeDefined();
    expect(context).toContain("Missing HTTP Strict Transport Security");
    expect(sent[sent.length - 1]).toContain('typed "/finding hsts-missing"');
  });

  it("asks for reasoning on a model that takes the field", async () => {
    process.env.AI_MODEL = "gpt-5-mini";
    fetchMock.mockResolvedValue(textReply("ok"));
    await (await ask("hi")).text();
    expect(upstreamBody().reasoning_effort).toBe("medium");
  });
});

describe("POST /api/v3/ai/chat: usage", () => {
  it("records the provider's real usage, without charging credits", async () => {
    fetchMock.mockResolvedValue(
      textReply("Hello", {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
      }),
    );
    await (await ask("hi")).text();
    expect(mockRecordAiTokens).toHaveBeenCalledWith(42, 120, undefined, false);
  });

  it("falls back to an estimate when the provider reports no usage", async () => {
    fetchMock.mockResolvedValue(textReply("Hello"));
    await (await ask("hi")).text();
    expect(mockRecordAiTokens).toHaveBeenCalledTimes(1);
    const [userId, tokens, , charge] = mockRecordAiTokens.mock.calls[0];
    expect(userId).toBe(42);
    expect(tokens).toBeGreaterThan(0);
    expect(charge).toBe(false);
  });
});
