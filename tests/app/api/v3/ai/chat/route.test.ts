/**
 * Route-level tests for POST /api/v3/ai/chat (streaming AI support chat).
 * The DB, session, rate-limit, and unified AI usage quota boundaries are
 * mocked; provider resolution (lib/ai/provider.ts) and the SSE
 * re-transcoding loop run for real against a mocked global.fetch, matching
 * the approach tests/lib/ai/verify-findings.test.ts uses.
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

const mockCheckAiUsageQuota = vi.fn();
const mockRecordAiTokens = vi.fn();
vi.mock("@/lib/billing/ai-usage", () => ({
  checkAiUsageQuota: (...args: unknown[]) => mockCheckAiUsageQuota(...args),
  recordAiTokens: (...args: unknown[]) => mockRecordAiTokens(...args),
}));

const { POST } = await import("@/app/api/v3/ai/chat/route");

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/v3/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Builds a mocked upstream Response streaming OpenAI-compat SSE chunks. */
function sseUpstreamResponse(events: unknown[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

async function drain(res: Response): Promise<string> {
  return res.text();
}

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42, name: "Alice", role: "user" });
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({
    rows: [
      {
        ai_chat_banned: false,
        plan: "free",
        daily_scan_limit: null,
        created_at: "2026-01-01T00:00:00.000Z",
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
  mockCheckAiUsageQuota.mockReset();
  mockCheckAiUsageQuota.mockResolvedValue({
    allowed: true,
    usingOwnAi: false,
    usedTokens: 0,
    limitTokens: 20_000,
  });
  mockRecordAiTokens.mockReset();

  process.env.AI_BASE_URL = "https://api.example-llm.test/v1";
  process.env.AI_API_KEY = "test-key";
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;

  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe("POST /api/v3/ai/chat: auth and gates", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(
      postRequest({ messages: [{ role: "user", content: "hi" }] }),
    );
    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 429 when the flat rate limit is exceeded", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 120,
    });
    const res = await POST(
      postRequest({ messages: [{ role: "user", content: "hi" }] }),
    );
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain("Too many AI requests");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 403 when the account is banned from AI chat", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          ai_chat_banned: true,
          plan: "free",
          daily_scan_limit: null,
          created_at: "2026-01-01",
        },
      ],
    });
    const res = await POST(
      postRequest({ messages: [{ role: "user", content: "hi" }] }),
    );
    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/v3/ai/chat: input length enforcement", () => {
  it("rejects when the newest (last) message exceeds the configured max length", async () => {
    const res = await POST(
      postRequest({
        messages: [{ role: "user", content: "x".repeat(4001) }],
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("exceeds maximum length");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not reject on an oversized earlier message (e.g. an auto-loaded /docs context block), only the newest one", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      sseUpstreamResponse([{ choices: [{ delta: { content: "hi" } }] }]),
    );
    const res = await POST(
      postRequest({
        messages: [
          {
            role: "user",
            content: `<context cmd="docs">${"x".repeat(10_000)}</context>`,
          },
          { role: "assistant", content: "context loaded" },
          { role: "user", content: "How do I self-host this?" },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalled();
  });
});

describe("POST /api/v3/ai/chat: large context blocks reach the model", () => {
  /** Pull the messages[] actually forwarded to the upstream provider. */
  function forwardedContent(): string {
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const sent = JSON.parse((init as RequestInit).body as string) as {
      messages: { role: string; content: string }[];
    };
    return sent.messages.map((m) => m.content).join("\n");
  }

  it("forwards a server-injected context block that is larger than the conversational char budget (the /changelog case, ~250k)", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      sseUpstreamResponse([{ choices: [{ delta: { content: "ok" } }] }]),
    );
    // The real changelog-knowledge.md is ~250k chars; the conversational
    // budget (max(maxInputLength,20k)*6 = 120k here) is far smaller, so the
    // old backward-walk trim dropped the whole context and the AI "forgot"
    // the changelog the user had just loaded.
    const marker = "CHANGELOG_MARKER_zzq";
    const bigContext = `<context cmd="changelog">${marker}${"x".repeat(250_000)}</context>`;
    const res = await POST(
      postRequest({
        messages: [
          { role: "user", content: bigContext },
          { role: "assistant", content: "Changelog loaded." },
          { role: "user", content: "What changed in the latest version?" },
        ],
      }),
    );
    expect(res.status).toBe(200);
    // The loaded context MUST reach the provider, or /changelog is pointless.
    expect(forwardedContent()).toContain(marker);
  });

  it("still trims an abusive backlog of plain (non-context) turns to protect against cost amplification", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      sseUpstreamResponse([{ choices: [{ delta: { content: "ok" } }] }]),
    );
    // 40 plain user turns of 5k chars each = 200k, well over the 120k
    // conversational budget: the OLDEST turns must be dropped.
    const messages = [];
    for (let i = 0; i < 40; i++) {
      messages.push({
        role: "user",
        content: `OLD_TURN_${i} ${"y".repeat(5000)}`,
      });
      messages.push({ role: "assistant", content: `reply ${i}` });
    }
    messages.push({ role: "user", content: "NEWEST_QUESTION marker" });
    const res = await POST(postRequest({ messages }));
    expect(res.status).toBe(200);
    const forwarded = forwardedContent();
    expect(forwarded).toContain("NEWEST_QUESTION marker");
    // The very oldest turn is beyond the budget and must have been trimmed.
    expect(forwarded).not.toContain("OLD_TURN_0 ");
  });
});

describe("POST /api/v3/ai/chat: unified AI usage quota", () => {
  it("is free/unmetered: still calls the upstream provider even when the quota reports not allowed", async () => {
    mockCheckAiUsageQuota.mockResolvedValue({
      allowed: false,
      usingOwnAi: false,
      usedTokens: 20_000,
      limitTokens: 20_000,
      message: "You've used all your AI tokens for this window.",
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      sseUpstreamResponse([{ choices: [{ delta: { content: "hi" } }] }]),
    );

    const res = await POST(
      postRequest({ messages: [{ role: "user", content: "hi" }] }),
    );
    expect(res.status).not.toBe(429);
    expect(global.fetch).toHaveBeenCalled();
    expect(mockCheckAiUsageQuota).toHaveBeenCalledWith(42);
  });
});

describe("POST /api/v3/ai/chat: token accounting", () => {
  it("records REAL usage from a stream_options usage chunk, and requests it in the payload", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      sseUpstreamResponse([
        { choices: [{ delta: { content: "Hello" } }] },
        { choices: [{ delta: { content: " there" } }] },
        {
          choices: [],
          usage: { prompt_tokens: 50, completion_tokens: 12, total_tokens: 62 },
        },
      ]),
    );

    const res = await POST(
      postRequest({ messages: [{ role: "user", content: "hi" }] }),
    );
    const text = await drain(res);

    expect(text).toBe("Hello there");
    // chargeCredits: false -- chat records window usage but must not drain
    // the purchased AI-credit balance.
    expect(mockRecordAiTokens).toHaveBeenCalledWith(42, 62, undefined, false);

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const sentPayload = JSON.parse((init as RequestInit).body as string);
    expect(sentPayload.stream_options).toEqual({ include_usage: true });
  });

  it("falls back to a character-length ESTIMATE when the provider never returns usage", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      sseUpstreamResponse([
        { choices: [{ delta: { content: "Hi" } }] },
        { choices: [{ delta: { content: "!" } }] },
      ]),
    );

    const res = await POST(
      postRequest({ messages: [{ role: "user", content: "hi" }] }),
    );
    await drain(res);

    expect(mockRecordAiTokens).toHaveBeenCalledTimes(1);
    const [userIdArg, tokensArg] = mockRecordAiTokens.mock.calls[0];
    expect(userIdArg).toBe(42);
    // Real usage was never returned, so this must come from the character
    // estimate (system prompt + "hi" input + "Hi!" output), never 0.
    expect(tokensArg).toBeGreaterThan(0);
  });

  it("does not record usage when the caller is using their own AI key", async () => {
    mockCheckAiUsageQuota.mockResolvedValue({
      allowed: true,
      usingOwnAi: true,
      usedTokens: 0,
      limitTokens: -1,
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      sseUpstreamResponse([
        { choices: [{ delta: { content: "Hi" } }] },
        {
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        },
      ]),
    );

    const res = await POST(
      postRequest({ messages: [{ role: "user", content: "hi" }] }),
    );
    await drain(res);

    expect(mockRecordAiTokens).not.toHaveBeenCalled();
  });
});
