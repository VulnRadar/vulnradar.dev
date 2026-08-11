/**
 * Coverage for the scan-level AI executive summary (lib/ai/scan-summary.ts).
 * The DB (pool.query, via resolveUserEndpoint's lookup) and network (fetch)
 * boundaries are mocked; provider resolution and prompt-building run for
 * real, same approach as tests/lib/ai/verify-findings.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ScanResult, Vulnerability } from "@/lib/scanner/types";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockRecordAiTokens = vi.fn();
vi.mock("@/lib/billing/ai-usage", () => ({
  recordAiTokens: (...args: unknown[]) => mockRecordAiTokens(...args),
}));

const { generateScanSummary } = await import("@/lib/ai/scan-summary");
const { CONFIG_AI_SUMMARY_MAX_TOKENS } =
  await import("@/lib/config/config-values");

function makeFinding(
  id: string,
  severity: Vulnerability["severity"] = "medium",
  title = `Finding ${id}`,
): Vulnerability {
  return {
    id,
    title,
    severity,
    category: "headers",
    description:
      "a very long description that should never reach the AI prompt".repeat(
        20,
      ),
    evidence:
      "verbose evidence text that should never reach the AI prompt".repeat(20),
    riskImpact: "",
    explanation: "",
    fixSteps: [],
    codeExamples: [],
  };
}

function makeResult(findings: Vulnerability[]): ScanResult {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  return {
    url: "https://example.com",
    scannedAt: new Date().toISOString(),
    duration: 1200,
    findings,
    summary: { ...counts, total: findings.length },
    dangerScore: 5,
  };
}

function openAiResponse(content: string) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  mockQuery.mockReset();
  // No user_ai_configs row by default: resolveUserEndpoint (lib/ai/verify-findings.ts)
  // returns null, so generateScanSummary falls through to the server endpoint.
  mockQuery.mockResolvedValue({ rows: [] });
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

describe("generateScanSummary: no endpoint configured", () => {
  it("returns null without calling fetch when neither a user nor server AI endpoint is configured", async () => {
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    delete process.env.AI_PROVIDER;

    const result = await generateScanSummary(
      makeResult([makeFinding("f1")]),
      1,
    );

    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("generateScanSummary: successful generation", () => {
  it("returns the model's summary text on a clean OpenAI-compatible response", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      openAiResponse(
        "Two high-severity findings need attention, most urgently the missing CSP header. Fix that first.",
      ),
    );

    const result = await generateScanSummary(
      makeResult([makeFinding("f1")]),
      1,
    );

    expect(result).toBe(
      "Two high-severity findings need attention, most urgently the missing CSP header. Fix that first.",
    );
  });

  it("strips markdown fences and <think> blocks the model may add despite instructions", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      openAiResponse(
        "<think>reasoning here</think>```\nThe scan found no exploitable issues.\n```",
      ),
    );

    const result = await generateScanSummary(makeResult([]), 1);

    expect(result).toBe("The scan found no exploitable issues.");
  });

  it("routes to the native Anthropic adapter (x-api-key, /messages) when the endpoint is Anthropic", async () => {
    process.env.AI_BASE_URL = "https://api.anthropic.com/v1";
    process.env.AI_MODEL = "claude-haiku-4-5-20251001";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "Clean scan, nothing urgent." }],
      }),
    });

    const result = await generateScanSummary(makeResult([]), 1);

    expect(result).toBe("Clean scan, nothing urgent.");
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init as RequestInit).headers).toMatchObject({
      "x-api-key": "test-key",
    });
  });

  it("falls back to the server endpoint when the user AI config lookup fails", async () => {
    mockQuery.mockReset();
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      openAiResponse("Fallback summary text."),
    );

    const result = await generateScanSummary(makeResult([]), 1);

    // resolveUserEndpoint (lib/ai/verify-findings.ts) swallows the DB error
    // and returns null rather than throwing, so generateScanSummary still
    // resolves the server endpoint from AI_BASE_URL/AI_API_KEY and succeeds.
    expect(result).toBe("Fallback summary text.");
  });
});

describe("generateScanSummary: AI call fails or times out", () => {
  it("returns null (not a throw) when the provider responds with a non-OK status", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "internal error",
    });

    const result = await generateScanSummary(
      makeResult([makeFinding("f1")]),
      1,
    );

    expect(result).toBeNull();
  });

  it("returns null (not a throw) when fetch rejects outright", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("network unreachable"),
    );

    const result = await generateScanSummary(
      makeResult([makeFinding("f1")]),
      1,
    );

    expect(result).toBeNull();
  });

  it("returns null (not a throw) when the call is aborted, e.g. by the internal call timeout", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      const err = new Error("This operation was aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });

    const result = await generateScanSummary(
      makeResult([makeFinding("f1")]),
      1,
    );

    expect(result).toBeNull();
  });

  it("returns null when the response body has no usable text", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: {} }] }),
    });

    const result = await generateScanSummary(
      makeResult([makeFinding("f1")]),
      1,
    );

    expect(result).toBeNull();
  });

  it("returns null when the model's reply is empty after cleanup", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      openAiResponse("   \n```\n```\n   "),
    );

    const result = await generateScanSummary(
      makeResult([makeFinding("f1")]),
      1,
    );

    expect(result).toBeNull();
  });
});

describe("generateScanSummary: prompt stays small regardless of scan size", () => {
  it("caps the findings included in the prompt instead of sending every finding", async () => {
    let sentBody = "";
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (_url: string, init: RequestInit) => {
        sentBody = init.body as string;
        return openAiResponse("Summary text.");
      },
    );

    const manyFindings = Array.from({ length: 40 }, (_, i) =>
      makeFinding(`f${i}`, "high", `Distinct finding title ${i}`),
    );

    await generateScanSummary(makeResult(manyFindings), 1);

    const parsed = JSON.parse(sentBody);
    const prompt = parsed.messages[1].content as string;

    // Only a handful of the 40 finding titles should appear -- the prompt
    // is capped, not a dump of every finding.
    const titleMatches = manyFindings.filter((f) => prompt.includes(f.title));
    expect(titleMatches.length).toBeGreaterThan(0);
    expect(titleMatches.length).toBeLessThan(manyFindings.length);
    expect(prompt).toContain("40 total");
  });

  it("never includes a finding's full evidence or description text in the prompt", async () => {
    let sentBody = "";
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (_url: string, init: RequestInit) => {
        sentBody = init.body as string;
        return openAiResponse("Summary text.");
      },
    );

    const finding = makeFinding("f1");
    await generateScanSummary(makeResult([finding]), 1);

    const parsed = JSON.parse(sentBody);
    const prompt = parsed.messages[1].content as string;

    expect(prompt).not.toContain(finding.evidence);
    expect(prompt).not.toContain(finding.description);
  });

  it("includes severity counts and the danger score so the model has real signal to summarize", async () => {
    let sentBody = "";
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (_url: string, init: RequestInit) => {
        sentBody = init.body as string;
        return openAiResponse("Summary text.");
      },
    );

    const result = makeResult([makeFinding("f1", "critical", "Missing CSP")]);
    result.dangerScore = 8;
    await generateScanSummary(result, 1);

    const parsed = JSON.parse(sentBody);
    const prompt = parsed.messages[1].content as string;

    expect(prompt).toContain("critical=1");
    expect(prompt).toContain("8/10");
    expect(prompt).toContain("Missing CSP");
  });
});

describe("generateScanSummary: AI_SUMMARY_MAX_TOKENS budget", () => {
  it("sends the shipped AI_SUMMARY_MAX_TOKENS default as max_tokens, not a small hardcoded cap", async () => {
    let sentBody = "";
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (_url: string, init: RequestInit) => {
        sentBody = init.body as string;
        return openAiResponse("Summary text.");
      },
    );

    await generateScanSummary(makeResult([makeFinding("f1")]), 1);

    const parsed = JSON.parse(sentBody);
    // Regression guard for the truncation bug: this used to be a hardcoded
    // 400, which left a reasoning model almost nothing to answer with once
    // it spent tokens thinking. Asserting against the shipped constant
    // (rather than a bare number) keeps this test in sync if that constant
    // is ever retuned.
    expect(parsed.max_tokens).toBe(CONFIG_AI_SUMMARY_MAX_TOKENS);
    expect(parsed.max_tokens).toBeGreaterThan(400);
  });

  it("passes the resolved max_tokens (and a matching thinking budget) to the native Anthropic adapter", async () => {
    process.env.AI_BASE_URL = "https://api.anthropic.com/v1";
    process.env.AI_MODEL = "claude-haiku-4-5-20251001";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "Clean scan, nothing urgent." }],
      }),
    });

    await generateScanSummary(makeResult([]), 1);

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.max_tokens).toBe(CONFIG_AI_SUMMARY_MAX_TOKENS);
    // At the shipped default, the budget clears Anthropic's 1024-token
    // floor to request thinking at all -- unlike the old 400 total, which
    // fell below it and silently requested no thinking.
    expect(body.thinking).toMatchObject({ type: "enabled" });
  });

  it("reads max_tokens from an admin-configured system_settings override rather than a hardcoded constant", async () => {
    // AI_SUMMARY_MAX_TOKENS is resolved through the DB-backed settings
    // resolver (lib/config/runtime-config.ts), which caches its snapshot
    // for 30s across calls within the same module instance -- reset
    // modules so this test gets a fresh, uncached resolver instead of
    // reusing whatever an earlier test in this file already resolved and
    // cached. Same approach as tests/lib/ai/verify-findings.test.ts.
    vi.resetModules();
    const { generateScanSummary: generateWithOverride } =
      await import("@/lib/ai/scan-summary");

    // First call generateScanSummary makes is resolveUserEndpoint's
    // user_ai_configs lookup (no row -> falls through to the server
    // endpoint); the second is the settings snapshot query.
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ key: "AI_SUMMARY_MAX_TOKENS", value: "1234" }],
    });

    let sentBody = "";
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (_url: string, init: RequestInit) => {
        sentBody = init.body as string;
        return openAiResponse("Summary text.");
      },
    );

    await generateWithOverride(makeResult([makeFinding("f1")]), 1);

    const parsed = JSON.parse(sentBody);
    expect(parsed.max_tokens).toBe(1234);
  });
});

describe("generateScanSummary: output-length safety net", () => {
  it("does not truncate a clean response at the old 2000-character cap", async () => {
    // Realistic-length prose (a run of whole sentences, not one giant word)
    // comfortably past the old 2000-char slice but under the new one.
    const longSummary = "This finding needs attention right away. ".repeat(70);
    expect(longSummary.length).toBeGreaterThan(2000);
    expect(longSummary.length).toBeLessThan(4000);

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      openAiResponse(longSummary),
    );

    const result = await generateScanSummary(
      makeResult([makeFinding("f1")]),
      1,
    );

    expect(result).toBe(longSummary.trim());
  });

  it("still caps an extreme response instead of returning it unbounded", async () => {
    const hugeSummary = "x".repeat(10_000);

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      openAiResponse(hugeSummary),
    );

    const result = await generateScanSummary(
      makeResult([makeFinding("f1")]),
      1,
    );

    expect(result).not.toBeNull();
    expect(result!.length).toBe(4000);
  });
});

function openAiResponseWithUsage(
  content: string,
  promptTokens: number,
  completionTokens: number,
) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content } }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    }),
  };
}

describe("generateScanSummary: unified AI usage token accounting", () => {
  it("records real token usage from an OpenAI-compatible response", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      openAiResponseWithUsage("Summary text.", 300, 120),
    );

    await generateScanSummary(makeResult([makeFinding("f1")]), 1, false);

    expect(mockRecordAiTokens).toHaveBeenCalledWith(1, 420);
  });

  it("records real token usage from the native Anthropic adapter", async () => {
    process.env.AI_BASE_URL = "https://api.anthropic.com/v1";
    process.env.AI_MODEL = "claude-haiku-4-5-20251001";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "Clean scan, nothing urgent." }],
        usage: { input_tokens: 500, output_tokens: 80 },
      }),
    });

    await generateScanSummary(makeResult([]), 1, false);

    expect(mockRecordAiTokens).toHaveBeenCalledWith(1, 580);
  });

  it("does not record usage when the caller is using their own AI key", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      openAiResponseWithUsage("Summary text.", 300, 120),
    );

    await generateScanSummary(makeResult([makeFinding("f1")]), 1, true);

    expect(mockRecordAiTokens).not.toHaveBeenCalled();
  });

  it("does not record usage when the provider response omits it entirely", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      openAiResponse("Summary text."),
    );

    await generateScanSummary(makeResult([makeFinding("f1")]), 1, false);

    expect(mockRecordAiTokens).not.toHaveBeenCalled();
  });

  it("still returns the summary text even if recording usage fails", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      openAiResponseWithUsage("Summary text.", 10, 5),
    );
    mockRecordAiTokens.mockRejectedValueOnce(new Error("db down"));

    const result = await generateScanSummary(
      makeResult([makeFinding("f1")]),
      1,
      false,
    );

    expect(result).toBe("Summary text.");
  });
});
