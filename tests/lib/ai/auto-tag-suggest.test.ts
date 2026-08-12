/**
 * Coverage for lib/ai/auto-tag-suggest.ts: the AI half of the layered
 * auto-tag design, triggered by lib/tags/auto-tags.ts's maybeSuggestAiTag
 * when a scan's findings matched none of the ~50 hardcoded rules.
 *
 * The DB (pool.query, via the ai_disabled lookup and resolveUserEndpoint's
 * own lookup) and network (fetch) boundaries are mocked; provider
 * resolution and prompt-building run for real, same approach as
 * tests/lib/ai/scan-summary.test.ts. @/lib/billing/ai-usage is mocked
 * wholesale (unlike scan-summary.test.ts, which only mocks recordAiTokens)
 * because this module, unlike scan-summary.ts, resolves its own
 * usingOwnAi via checkAiUsageQuota rather than receiving it as a
 * parameter from a route -- mocking the whole module avoids also having
 * to stub checkAiUsageQuota's own dependency chain (hasOwnAiConfig,
 * getAiCreditBalance, getUserPlanLimits), which is already covered by
 * lib/billing/ai-usage.ts's own test suite.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Vulnerability } from "@/lib/scanner/types";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockCheckAiUsageQuota = vi.fn();
const mockRecordAiTokens = vi.fn();
vi.mock("@/lib/billing/ai-usage", () => ({
  checkAiUsageQuota: (...args: unknown[]) => mockCheckAiUsageQuota(...args),
  recordAiTokens: (...args: unknown[]) => mockRecordAiTokens(...args),
}));

const { generateAutoTagSuggestions, sanitizeAiTagSuggestions } =
  await import("@/lib/ai/auto-tag-suggest");

function makeFinding(overrides: Partial<Vulnerability> = {}): Vulnerability {
  return {
    id: "f1",
    title: "Some low-priority finding",
    severity: "low",
    category: "dns",
    description: "a description that should never reach the AI prompt",
    evidence: "verbose evidence text that should never reach the AI prompt",
    riskImpact: "",
    explanation: "",
    fixSteps: [],
    codeExamples: [],
    ...overrides,
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
  // No user_ai_configs row by default: ai_disabled lookup resolves to
  // false, and resolveUserEndpoint (lib/ai/verify-findings.ts) returns
  // null, so generateAutoTagSuggestions falls through to the server
  // endpoint (AI_BASE_URL/AI_API_KEY below).
  mockQuery.mockResolvedValue({ rows: [] });
  mockCheckAiUsageQuota.mockReset();
  mockCheckAiUsageQuota.mockResolvedValue({ usingOwnAi: false });
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

describe("sanitizeAiTagSuggestions", () => {
  it("accepts well-formed Title Case tag lines, one per line", () => {
    expect(
      sanitizeAiTagSuggestions("DNS Email Hygiene Gaps\nWeak Redirect Chain"),
    ).toEqual(["DNS Email Hygiene Gaps", "Weak Redirect Chain"]);
  });

  it("caps output at 2 suggestions even when the model returns more", () => {
    const out = sanitizeAiTagSuggestions(
      "First Good Tag\nSecond Good Tag\nThird Good Tag\nFourth Good Tag",
    );
    expect(out).toHaveLength(2);
    expect(out).toEqual(["First Good Tag", "Second Good Tag"]);
  });

  it("strips leading list markers (numbering, bullets) the model adds despite instructions", () => {
    expect(
      sanitizeAiTagSuggestions(
        "1. First Tag Name\n- Second Tag Name\n* Third Tag Name",
      ),
    ).toEqual(["First Tag Name", "Second Tag Name"]);
  });

  it("drops a line that's too short", () => {
    expect(sanitizeAiTagSuggestions("Hi\nA Reasonable Tag Name")).toEqual([
      "A Reasonable Tag Name",
    ]);
  });

  it("drops a line that's too long", () => {
    const tooLong = "Word ".repeat(20).trim();
    expect(sanitizeAiTagSuggestions(tooLong)).toEqual([]);
  });

  it("drops a line with disallowed punctuation (colons, semicolons, periods)", () => {
    expect(
      sanitizeAiTagSuggestions("Weird: Tag; Name!\nGood Tag Name"),
    ).toEqual(["Good Tag Name"]);
  });

  it("keeps a tag using the narrow allowed punctuation set (slash, hyphen, ampersand)", () => {
    expect(sanitizeAiTagSuggestions("DNS/Email Hygiene-Gaps & More")).toEqual([
      "DNS/Email Hygiene-Gaps & More",
    ]);
  });

  it("drops a line with more than 6 words", () => {
    expect(
      sanitizeAiTagSuggestions("This Tag Has Way Too Many Words In It Now"),
    ).toEqual([]);
  });

  it("rejects the three reserved tag names, case-insensitively", () => {
    expect(
      sanitizeAiTagSuggestions("clean\nCritical Exposure\nneeds hardening"),
    ).toEqual([]);
  });

  it("deduplicates suggestions case-insensitively", () => {
    expect(
      sanitizeAiTagSuggestions("Weak Redirect Chain\nweak redirect chain"),
    ).toEqual(["Weak Redirect Chain"]);
  });

  it("strips stray quote characters a model sometimes wraps its answer in", () => {
    expect(sanitizeAiTagSuggestions('"Quoted Tag Name"')).toEqual([
      "Quoted Tag Name",
    ]);
  });

  it("returns an empty array for blank or whitespace-only input", () => {
    expect(sanitizeAiTagSuggestions("   \n  \n\t")).toEqual([]);
  });

  // Regression: a model that ignores "no explanation" and writes a genuine
  // sentence fragment instead of a short tag name passes every check above
  // (valid characters, in-range length, in-range word count), since none of
  // these words are banned punctuation. Real production examples that
  // reached users before this check existed: "One is" and "Two are about
  // modern CSP/COEP directives".
  it("drops sentence fragments that start with a number-word + auxiliary verb", () => {
    expect(
      sanitizeAiTagSuggestions(
        "One is\nTwo are about modern CSP/COEP directives\nA Reasonable Tag Name",
      ),
    ).toEqual(["A Reasonable Tag Name"]);
  });

  it("drops a bare article as the whole tag", () => {
    expect(sanitizeAiTagSuggestions("The\nGood Tag Name")).toEqual([
      "Good Tag Name",
    ]);
  });

  it("drops a line containing an auxiliary/copula verb anywhere in it", () => {
    expect(
      sanitizeAiTagSuggestions(
        "The security posture is fine\nOverall this has weak headers\nWeak TLS Cipher Suite",
      ),
    ).toEqual(["Weak TLS Cipher Suite"]);
  });

  it("still accepts a real tag using a preposition, unlike the banned auxiliary/article/pronoun list", () => {
    expect(sanitizeAiTagSuggestions("Sensitive Data in URL")).toEqual([
      "Sensitive Data in URL",
    ]);
  });
});

describe("generateAutoTagSuggestions: gating (never blocks tag-saving, never errors visibly)", () => {
  it("returns [] immediately for zero findings, without any DB or network call", async () => {
    const result = await generateAutoTagSuggestions([], 1);
    expect(result).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns [] and skips the AI call entirely when the user has disabled AI", async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [{ ai_disabled: true }] });

    const result = await generateAutoTagSuggestions([makeFinding()], 1);

    expect(result).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns [] without calling fetch when no AI endpoint is configured anywhere (self-hosted, no key set)", async () => {
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    delete process.env.AI_PROVIDER;

    const result = await generateAutoTagSuggestions([makeFinding()], 1);

    expect(result).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("never throws when the ai_disabled lookup itself fails -- treated as enabled, same as every other AI route", async () => {
    mockQuery.mockReset();
    mockQuery.mockRejectedValueOnce(new Error("db down")); // ai_disabled lookup
    mockQuery.mockResolvedValue({ rows: [] }); // resolveUserEndpoint lookup
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      openAiResponse("Good Tag Name"),
    );

    const result = await generateAutoTagSuggestions([makeFinding()], 1);

    expect(result).toEqual(["Good Tag Name"]);
  });
});

describe("generateAutoTagSuggestions: successful generation", () => {
  it("returns sanitized suggestions from a clean OpenAI-compatible response", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      openAiResponse("DNS Email Hygiene Gaps"),
    );

    const result = await generateAutoTagSuggestions([makeFinding()], 1);

    expect(result).toEqual(["DNS Email Hygiene Gaps"]);
  });

  it("routes to the native Anthropic adapter (x-api-key, /messages) when the endpoint is Anthropic", async () => {
    process.env.AI_BASE_URL = "https://api.anthropic.com/v1";
    process.env.AI_MODEL = "claude-haiku-4-5-20251001";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "Weak Redirect Chain" }],
      }),
    });

    const result = await generateAutoTagSuggestions([makeFinding()], 1);

    expect(result).toEqual(["Weak Redirect Chain"]);
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init as RequestInit).headers).toMatchObject({
      "x-api-key": "test-key",
    });
  });

  it("falls back to the server endpoint when the user AI config lookup fails", async () => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [] }); // ai_disabled lookup: no row
    mockQuery.mockRejectedValueOnce(new Error("db down")); // resolveUserEndpoint lookup
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      openAiResponse("Fallback Tag Name"),
    );

    const result = await generateAutoTagSuggestions([makeFinding()], 1);

    expect(result).toEqual(["Fallback Tag Name"]);
  });

  it("caps findings sent in the prompt and never sends a finding's full evidence or description", async () => {
    let sentBody = "";
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (_url: string, init: RequestInit) => {
        sentBody = init.body as string;
        return openAiResponse("Some Tag Name");
      },
    );

    const manyFindings = Array.from({ length: 30 }, (_, i) =>
      makeFinding({
        id: `f${i}`,
        title: `Distinct finding title ${i}`,
        evidence: "SECRET-EVIDENCE-TEXT",
        description: "SECRET-DESCRIPTION-TEXT",
      }),
    );

    await generateAutoTagSuggestions(manyFindings, 1);

    const parsed = JSON.parse(sentBody);
    const prompt = parsed.messages[1].content as string;
    expect(prompt).not.toContain("SECRET-EVIDENCE-TEXT");
    expect(prompt).not.toContain("SECRET-DESCRIPTION-TEXT");
    expect(prompt).toContain("30 total");
  });
});

describe("generateAutoTagSuggestions: failure modes never surface to the caller", () => {
  it("returns [] (not a throw) on a non-OK provider response", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "internal error",
    });

    const result = await generateAutoTagSuggestions([makeFinding()], 1);

    expect(result).toEqual([]);
  });

  it("returns [] (not a throw) when fetch rejects outright", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("network unreachable"),
    );

    const result = await generateAutoTagSuggestions([makeFinding()], 1);

    expect(result).toEqual([]);
  });

  it("returns [] (not a throw) when the call is aborted, e.g. by the internal call timeout", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      const err = new Error("This operation was aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });

    const result = await generateAutoTagSuggestions([makeFinding()], 1);

    expect(result).toEqual([]);
  });

  it("returns [] when the response body has no usable text", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: {} }] }),
    });

    const result = await generateAutoTagSuggestions([makeFinding()], 1);

    expect(result).toEqual([]);
  });

  it("returns [] when every suggested line fails sanitization", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      openAiResponse("x\ny:z\n"),
    );

    const result = await generateAutoTagSuggestions([makeFinding()], 1);

    expect(result).toEqual([]);
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

describe("generateAutoTagSuggestions: token accounting (free, but still recorded for visibility)", () => {
  it("records real token usage for a metered user", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      openAiResponseWithUsage("Some Tag Name", 50, 10),
    );

    await generateAutoTagSuggestions([makeFinding()], 7);

    expect(mockRecordAiTokens).toHaveBeenCalledWith(7, 60);
  });

  it("never records usage for a bring-your-own-key user", async () => {
    mockCheckAiUsageQuota.mockResolvedValue({ usingOwnAi: true });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      openAiResponseWithUsage("Some Tag Name", 50, 10),
    );

    await generateAutoTagSuggestions([makeFinding()], 7);

    expect(mockRecordAiTokens).not.toHaveBeenCalled();
  });

  it("never throws, and still returns suggestions, when recording usage itself fails", async () => {
    mockRecordAiTokens.mockRejectedValueOnce(new Error("db down"));
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      openAiResponseWithUsage("Some Tag Name", 10, 5),
    );

    const result = await generateAutoTagSuggestions([makeFinding()], 1);

    expect(result).toEqual(["Some Tag Name"]);
  });

  it("never blocks on quota -- checkAiUsageQuota.allowed is never consulted", async () => {
    mockCheckAiUsageQuota.mockResolvedValue({
      usingOwnAi: false,
      allowed: false,
      message: "over quota",
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      openAiResponse("Some Tag Name"),
    );

    const result = await generateAutoTagSuggestions([makeFinding()], 1);

    expect(result).toEqual(["Some Tag Name"]);
  });
});
