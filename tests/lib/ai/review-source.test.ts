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

// The review must not charge anything itself any more: the route reserves
// before it and settles after it. Mocked so a stray call would show up here.
const mockRecordGithubReviewTokens = vi.fn();
vi.mock("@/lib/billing/github-review-usage", () => ({
  recordGithubReviewTokens: (...args: unknown[]) =>
    mockRecordGithubReviewTokens(...args),
}));

const { runGithubAiReview, planGithubReview } =
  await import("@/lib/ai/review-source");

/** What the route reserves for files of these sizes, inside the per-run cap. */
async function estimateGithubReviewTokens(sizes: number[]): Promise<number> {
  return (await planGithubReview(sizes)).estimate;
}

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

    const result = await runGithubAiReview(FILES, 1, false, null);

    expect(calledUrl()).toBe("https://api.minimax.io/anthropic/messages");
    expect(calledUrl()).not.toContain("chat/completions");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].title).toBe("SQL injection");
  });

  it("sends the review prompt as Anthropic's top-level system field", async () => {
    process.env.AI_BASE_URL = "https://api.anthropic.com/v1";
    fetchMock().mockResolvedValueOnce(anthropicResponse("[]"));

    await runGithubAiReview(FILES, 1, false, null);

    const body = calledBody();
    // Anthropic takes the system prompt out of band. Leaving it as a
    // messages[] entry with role "system" is a 400 on the real API.
    expect(typeof body.system).toBe("string");
    expect(String(body.system)).toContain("security code reviewer");
    const messages = body.messages as Array<{ role: string }>;
    expect(messages.every((m) => m.role !== "system")).toBe(true);
  });

  it("reports the real token usage Anthropic reports, for the route to settle with", async () => {
    process.env.AI_BASE_URL = "https://api.minimax.io/anthropic";
    fetchMock().mockResolvedValueOnce(anthropicResponse("[]"));

    const result = await runGithubAiReview(FILES, 1, false, null);

    expect(result.totalTokensUsed).toBe(150);
  });
});

describe("runGithubAiReview: OpenAI-compatible endpoints", () => {
  it("still posts to /chat/completions with a system message", async () => {
    fetchMock().mockResolvedValueOnce(
      openAiResponse(JSON.stringify([finding()])),
    );

    const result = await runGithubAiReview(FILES, 1, false, null);

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

    await runGithubAiReview(FILES, 1, false, null);

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

    const result = await runGithubAiReview(FILES, 1, false, null);

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

    const result = await runGithubAiReview(FILES, 1, false, null);

    expect(result.findings[0].confidence).toBe(95);
  });

  it("drops a finding the model itself scored below the reporting floor", async () => {
    fetchMock().mockResolvedValueOnce(
      openAiResponse(JSON.stringify([finding({ confidence: 30 })])),
    );

    const result = await runGithubAiReview(FILES, 1, false, null);

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

    const result = await runGithubAiReview(FILES, 1, false, null);

    expect(result.findings[0].confidence).toBe(60);
  });

  it("clamps an out-of-range confidence rather than trusting it", async () => {
    fetchMock().mockResolvedValueOnce(
      openAiResponse(JSON.stringify([finding({ confidence: 900 })])),
    );

    const result = await runGithubAiReview(FILES, 1, false, null);

    expect(result.findings[0].confidence).toBe(100);
  });
});

describe("runGithubAiReview: parsing", () => {
  it("drops a finding whose file path is not one of the files sent", async () => {
    fetchMock().mockResolvedValueOnce(
      openAiResponse(JSON.stringify([finding({ file: "src/invented.js" })])),
    );

    const result = await runGithubAiReview(FILES, 1, false, null);

    expect(result.findings).toHaveLength(0);
  });

  it("returns no findings and no endpoint flag when no AI is configured", async () => {
    delete process.env.AI_BASE_URL;
    delete process.env.AI_API_KEY;
    delete process.env.AI_PROVIDER;

    const result = await runGithubAiReview(FILES, 1, false, null);

    expect(result.noEndpoint).toBe(true);
    expect(result.findings).toHaveLength(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("runGithubAiReview: held to the route's reservation", () => {
  /** Files large enough that each lands in its own call-sized batch. */
  function bigFiles(n: number): RepoFile[] {
    return Array.from({ length: n }, (_, i) => ({
      path: `src/f${i}.js`,
      content: "x".repeat(39_000),
    }));
  }

  it("reviews every batch when the budget covers the estimate, and records nothing itself", async () => {
    fetchMock().mockImplementation(async () => openAiResponse("[]"));
    const files = bigFiles(3);
    const budget = await estimateGithubReviewTokens(
      files.map((f) => f.content.length),
    );

    const result = await runGithubAiReview(files, 1, false, budget);

    expect(fetchMock()).toHaveBeenCalledTimes(3);
    expect(result.stoppedAtBudget).toBe(false);
    expect(result.totalTokensUsed).toBe(450);
    expect(mockRecordGithubReviewTokens).not.toHaveBeenCalled();
  });

  it("stops before a batch the budget cannot cover at its worst case", async () => {
    // A call that really costs 20000 tokens leaves too little of a one-batch
    // reservation for the next batch's ceiling.
    fetchMock().mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "[]" } }],
        usage: { prompt_tokens: 15_000, completion_tokens: 5_000 },
      }),
    }));
    const files = bigFiles(3);
    const oneBatch = await estimateGithubReviewTokens([39_000]);

    const result = await runGithubAiReview(files, 1, false, oneBatch + 100);

    expect(fetchMock()).toHaveBeenCalledTimes(1);
    expect(result.stoppedAtBudget).toBe(true);
    expect(result.totalTokensUsed).toBe(20_000);
  });

  it("counts a batch that came back without a cost at its ceiling, so timeouts cannot send every batch", async () => {
    // A timed-out call is settled at zero, since nothing says what it cost,
    // but the provider may still bill it. Counting it at zero let a run whose
    // calls all timed out send every batch on a one-batch reservation.
    fetchMock().mockRejectedValue(new Error("This operation was aborted"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const oneBatch = await estimateGithubReviewTokens([39_000]);

    const result = await runGithubAiReview(
      bigFiles(3),
      1,
      false,
      oneBatch + 100,
    );

    expect(fetchMock()).toHaveBeenCalledTimes(1);
    expect(result.stoppedAtBudget).toBe(true);
    expect(result.totalTokensUsed).toBe(0);
    errors.mockRestore();
  });

  it("keeps a call's token count when its answer cannot be parsed", async () => {
    // The repo's own text steers the model's answer. A null element used to
    // throw inside the parse, and the catch around it reported the call as
    // costing nothing, so the route handed the whole reservation back.
    fetchMock().mockResolvedValueOnce(openAiResponse("[null]"));

    const result = await runGithubAiReview(FILES, 1, false, null);

    expect(result.findings).toHaveLength(0);
    expect(result.totalTokensUsed).toBe(150);
  });

  it("an uncapped run (own key, billing off, free trial) is held to nothing but the per-run ceiling", async () => {
    fetchMock().mockImplementation(async () => openAiResponse("[]"));

    const result = await runGithubAiReview(bigFiles(3), 1, false, null);

    expect(fetchMock()).toHaveBeenCalledTimes(3);
    expect(result.stoppedAtBudget).toBe(false);
  });
});

describe("estimateGithubReviewTokens", () => {
  it("is zero for no files", async () => {
    expect(await estimateGithubReviewTokens([])).toBe(0);
  });

  it("covers each batch's input and its whole output allowance", async () => {
    const { CONFIG_GITHUB_REVIEW_MAX_TOKENS_PER_CALL } =
      await import("@/lib/config/config-values");
    const one = await estimateGithubReviewTokens([39_000]);
    const three = await estimateGithubReviewTokens([39_000, 39_000, 39_000]);

    expect(one).toBeGreaterThan(
      CONFIG_GITHUB_REVIEW_MAX_TOKENS_PER_CALL + 39_000 / 4,
    );
    // Three files over the per-call budget are three calls, each with its
    // own system prompt and output allowance.
    expect(three).toBe(one * 3);
  });
});
