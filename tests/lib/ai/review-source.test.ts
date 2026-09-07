/**
 * Coverage for the GitHub repo AI code review (lib/ai/review-source.ts).
 *
 * The reason this file exists: review-source.ts was the ONE AI caller in the
 * app that only spoke OpenAI's /chat/completions shape. Every other one
 * (chat, verify, summary, auto-tags) had already learned to branch on
 * isAnthropicProvider, so pointing AI_BASE_URL at an Anthropic endpoint left
 * repo scans POSTing into a 404 and reporting "no AI findings" for every
 * repository. Nothing failed loudly, which is exactly why it went unnoticed.
 *
 * The DB (pool.query, via resolveUserEndpoint's lookup) and network (fetch)
 * boundaries are mocked; provider resolution, prompt building and response
 * parsing all run for real. Same approach as tests/lib/ai/scan-summary.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { RepoFile } from "@/lib/scanner/github-repo-scan";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockRecordGithubReviewTokens = vi.fn();
vi.mock("@/lib/billing/github-review-usage", () => ({
  recordGithubReviewTokens: (...args: unknown[]) =>
    mockRecordGithubReviewTokens(...args),
}));

const { runGithubAiReview } = await import("@/lib/ai/review-source");

const FILES: RepoFile[] = [
  {
    path: "src/db.js",
    content: "const q = `SELECT * FROM u WHERE id = ${req.params.id}`;\n",
  },
];

/** One finding, shaped the way the prompt asks for it. */
function finding(overrides: Record<string, unknown> = {}) {
  return {
    file: "src/db.js",
    line: 1,
    severity: "high",
    confidence: 90,
    title: "SQL injection",
    description: "User input is concatenated into a query.",
    evidence: "const q = `SELECT * FROM u WHERE id = ${req.params.id}`;",
    riskImpact: "An attacker reads the whole users table.",
    explanation: "The value reaches db.query unparameterised.",
    fixSteps: ["Use a parameterised query."],
    ...overrides,
  };
}

function openAiResponse(content: string) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    }),
  };
}

function anthropicResponse(content: string) {
  return {
    ok: true,
    json: async () => ({
      content: [{ type: "text", text: content }],
      usage: { input_tokens: 100, output_tokens: 50 },
    }),
  };
}

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

function fetchMock() {
  return global.fetch as ReturnType<typeof vi.fn>;
}

/** The URL the single fetch call was made against. */
function calledUrl(): string {
  return String(fetchMock().mock.calls[0][0]);
}

/** The parsed JSON body of the single fetch call. */
function calledBody(): Record<string, unknown> {
  const init = fetchMock().mock.calls[0][1] as { body: string };
  return JSON.parse(init.body);
}

beforeEach(() => {
  mockQuery.mockReset();
  // No user_ai_configs row: resolveUserEndpoint returns null and the review
  // falls through to the server endpoint built from the env vars below.
  mockQuery.mockResolvedValue({ rows: [] });
  mockRecordGithubReviewTokens.mockReset();

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

describe("runGithubAiReview: Anthropic-shaped endpoints", () => {
  it("calls /messages, not /chat/completions, on an /anthropic base URL", async () => {
    process.env.AI_BASE_URL = "https://api.minimax.io/anthropic";
    fetchMock().mockResolvedValueOnce(
      anthropicResponse(JSON.stringify([finding()])),
    );

    const result = await runGithubAiReview(FILES, 1, false, false);

    expect(calledUrl()).toBe("https://api.minimax.io/anthropic/messages");
    expect(calledUrl()).not.toContain("chat/completions");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].title).toBe("SQL injection");
  });

  it("sends the review prompt as Anthropic's top-level system field", async () => {
    process.env.AI_BASE_URL = "https://api.anthropic.com/v1";
    fetchMock().mockResolvedValueOnce(anthropicResponse("[]"));

    await runGithubAiReview(FILES, 1, false, false);

    const body = calledBody();
    // Anthropic takes the system prompt out of band. Leaving it as a
    // messages[] entry with role "system" is a 400 on the real API.
    expect(typeof body.system).toBe("string");
    expect(String(body.system)).toContain("security code reviewer");
    const messages = body.messages as Array<{ role: string }>;
    expect(messages.every((m) => m.role !== "system")).toBe(true);
  });

  it("bills the real token usage Anthropic reports", async () => {
    process.env.AI_BASE_URL = "https://api.minimax.io/anthropic";
    fetchMock().mockResolvedValueOnce(anthropicResponse("[]"));

    const result = await runGithubAiReview(FILES, 1, false, false);

    expect(result.totalTokensUsed).toBe(150);
    expect(mockRecordGithubReviewTokens).toHaveBeenCalledWith(
      1,
      150,
      undefined,
      false,
    );
  });

  it("does not bill a user running on their own AI key", async () => {
    process.env.AI_BASE_URL = "https://api.minimax.io/anthropic";
    fetchMock().mockResolvedValueOnce(anthropicResponse("[]"));

    await runGithubAiReview(FILES, 1, true, false);

    expect(mockRecordGithubReviewTokens).not.toHaveBeenCalled();
  });
});

describe("runGithubAiReview: OpenAI-compatible endpoints", () => {
  it("still posts to /chat/completions with a system message", async () => {
    fetchMock().mockResolvedValueOnce(
      openAiResponse(JSON.stringify([finding()])),
    );

    const result = await runGithubAiReview(FILES, 1, false, false);

    expect(calledUrl()).toBe(
      "https://api.example-llm.test/v1/chat/completions",
    );
    const messages = calledBody().messages as Array<{ role: string }>;
    expect(messages[0].role).toBe("system");
    expect(result.findings).toHaveLength(1);
  });

  it("asks a reasoning model to reason before judging a line", async () => {
    process.env.AI_BASE_URL = "https://api.openai.com/v1";
    process.env.AI_MODEL = "gpt-5.4";
    fetchMock().mockResolvedValueOnce(openAiResponse("[]"));

    await runGithubAiReview(FILES, 1, false, false);

    // "verify" effort: deciding whether a specific line is exploitable is the
    // same kind of judgement finding verification makes, and the same kind a
    // snap answer gets wrong.
    expect(calledBody().reasoning_effort).toBe("high");
  });

  it("retries without reasoning_effort when the endpoint rejects it", async () => {
    process.env.AI_BASE_URL = "https://api.openai.com/v1";
    process.env.AI_MODEL = "gpt-5.4";
    fetchMock()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        clone: () => ({
          text: async () => "unknown parameter: reasoning_effort",
        }),
        text: async () => "unknown parameter: reasoning_effort",
      })
      .mockResolvedValueOnce(openAiResponse(JSON.stringify([finding()])));

    const result = await runGithubAiReview(FILES, 1, false, false);

    // A whole batch of files is worth more than an optional quality knob.
    expect(fetchMock()).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(
      (fetchMock().mock.calls[1][1] as { body: string }).body,
    );
    expect(retryBody.reasoning_effort).toBeUndefined();
    expect(result.findings).toHaveLength(1);
  });
});

describe("runGithubAiReview: confidence", () => {
  it("keeps the confidence the model reported instead of stamping every finding 60", async () => {
    fetchMock().mockResolvedValueOnce(
      openAiResponse(JSON.stringify([finding({ confidence: 95 })])),
    );

    const result = await runGithubAiReview(FILES, 1, false, false);

    expect(result.findings[0].confidence).toBe(95);
  });

  it("drops a finding the model itself scored below the reporting floor", async () => {
    fetchMock().mockResolvedValueOnce(
      openAiResponse(JSON.stringify([finding({ confidence: 30 })])),
    );

    const result = await runGithubAiReview(FILES, 1, false, false);

    // The prompt says not to file below 60, because that is the model calling
    // its own finding a guess. Models comply unevenly, so it is enforced here.
    expect(result.findings).toHaveLength(0);
  });

  it("falls back to 60 when the model omits the field entirely", async () => {
    const noConfidence = finding();
    delete (noConfidence as Record<string, unknown>).confidence;
    fetchMock().mockResolvedValueOnce(
      openAiResponse(JSON.stringify([noConfidence])),
    );

    const result = await runGithubAiReview(FILES, 1, false, false);

    expect(result.findings[0].confidence).toBe(60);
  });

  it("clamps an out-of-range confidence rather than trusting it", async () => {
    fetchMock().mockResolvedValueOnce(
      openAiResponse(JSON.stringify([finding({ confidence: 900 })])),
    );

    const result = await runGithubAiReview(FILES, 1, false, false);

    expect(result.findings[0].confidence).toBe(100);
  });
});

describe("runGithubAiReview: parsing", () => {
  it("drops a finding whose file path is not one of the files sent", async () => {
    fetchMock().mockResolvedValueOnce(
      openAiResponse(JSON.stringify([finding({ file: "src/invented.js" })])),
    );

    const result = await runGithubAiReview(FILES, 1, false, false);

    expect(result.findings).toHaveLength(0);
  });

  it("returns no findings and no endpoint flag when no AI is configured", async () => {
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    delete process.env.AI_PROVIDER;

    const result = await runGithubAiReview(FILES, 1, false, false);

    expect(result.noEndpoint).toBe(true);
    expect(result.findings).toHaveLength(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
