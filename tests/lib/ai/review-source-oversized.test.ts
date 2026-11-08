/**
 * One file larger than GITHUB_REVIEW_MAX_TOKENS_PER_RUN by itself is skipped
 * and listed, and the AI review carries on with the rest (owner decision D20,
 * 2026-11-07). It used to stop the whole run at that batch: a single file of
 * about 235 KB early in tree order meant no AI review on anything after it,
 * reported as aiReviewStoppedAtRunCap.
 *
 * The provider below reports exactly the bytes it was sent as input.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { RepoFile } from "@/lib/scanner/github-repo-scan";

vi.mock("@/lib/database/db", () => ({
  default: { query: vi.fn(async () => ({ rows: [] })) },
}));

vi.mock("@/lib/billing/github-review-usage", () => ({
  recordGithubReviewTokens: vi.fn(),
}));

const { runGithubAiReview, planGithubReview } =
  await import("@/lib/ai/review-source");
const { CONFIG_GITHUB_REVIEW_MAX_TOKENS_PER_RUN: RUN_CAP } =
  await import("@/lib/config/config-values");

let sentPaths: string[][] = [];
let inputSent: number[] = [];
let failNext = 0;

function provider() {
  (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
    async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as {
        messages: { role: string; content: string }[];
      };
      // The user turn only: the system prompt quotes the header format.
      const prompt = body.messages
        .filter((m) => m.role === "user")
        .map((m) => m.content)
        .join("\n");
      sentPaths.push(
        [...prompt.matchAll(/--- FILE: (.+?) ---/g)].map((m) => m[1]),
      );
      if (failNext > 0) {
        failNext--;
        throw new Error("socket hang up");
      }
      const input = body.messages.reduce(
        (sum, m) => sum + Buffer.byteLength(m.content, "utf8"),
        0,
      );
      inputSent.push(input);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "[]" } }],
          usage: {
            prompt_tokens: input,
            completion_tokens: 10,
            total_tokens: input + 10,
          },
        }),
      };
    },
  );
}

/** A file of about `bytes` UTF-8 bytes of ordinary code. */
function file(path: string, bytes: number): RepoFile {
  const line = "const value = compute(input, options);";
  const lines = Math.floor(bytes / (line.length + 1));
  return {
    path,
    content: Array.from({ length: lines }, () => line).join("\n"),
  };
}

const SMALL = 30_000;
// Under the shipped per-file byte cap, so the filter lets it through, and
// over the per-run cap once the line numbers are added: the case the old run
// stopped at.
const HUGE = 290_000;

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  sentPaths = [];
  inputSent = [];
  failNext = 0;
  process.env.AI_BASE_URL = "https://api.example-llm.test/v1";
  process.env.AI_API_KEY = "test-key";
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;
  global.fetch = vi.fn();
  provider();
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe("a file over the per-run cap by itself", () => {
  it("is skipped and listed, and every file after it is still reviewed", async () => {
    const files = [
      file("src/a.ts", SMALL),
      file("data/huge.json", HUGE),
      file("src/b.ts", SMALL),
      file("src/c.ts", SMALL),
    ];

    const result = await runGithubAiReview(files, 1, false, null);

    expect(sentPaths.flat()).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(result.filesSkippedOverRunCap).toEqual(["data/huge.json"]);
    expect(result.filesReviewed).toBe(3);
    expect(result.filesTotal).toBe(4);
    expect(result.stoppedAtRunCap).toBe(false);
    expect(result.rejectedOverCap).toBe(false);
    expect(inputSent.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(RUN_CAP);
  });

  it("first in tree order: the run starts after it instead of not starting", async () => {
    const files = [file("data/huge.json", HUGE), file("src/a.ts", SMALL)];

    const result = await runGithubAiReview(files, 1, false, null);

    expect(sentPaths.flat()).toEqual(["src/a.ts"]);
    expect(result.filesSkippedOverRunCap).toEqual(["data/huge.json"]);
    expect(result.filesReviewed).toBe(1);
    expect(result.rejectedOverCap).toBe(false);
  });

  it("when every file is over the cap alone, nothing is sent and every one is listed", async () => {
    const files = [file("a.json", HUGE), file("b.json", HUGE)];

    const result = await runGithubAiReview(files, 1, false, null);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.filesSkippedOverRunCap).toEqual(["a.json", "b.json"]);
    expect(result.rejectedOverCap).toBe(true);
    expect(result.stoppedAtRunCap).toBe(false);
    expect(result.filesReviewed).toBe(0);
  });

  it("a batch that only crosses the cap with what was already sent still stops the run there", async () => {
    // Nine files that each fit, and together do not: a contiguous stop, as
    // before. Only a batch over the cap by itself is skipped.
    const files = Array.from({ length: 9 }, (_, i) =>
      file(`src/f${i}.ts`, 39_000),
    );

    const result = await runGithubAiReview(files, 1, false, null);

    expect(result.stoppedAtRunCap).toBe(true);
    expect(result.filesSkippedOverRunCap).toEqual([]);
    expect(result.filesReviewed).toBeLessThan(9);
    expect(inputSent.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(RUN_CAP);
  });

  it("the plan from tree sizes makes the same cut: it skips the oversized batch and plans the rest", async () => {
    const plan = await planGithubReview([SMALL, HUGE, SMALL]);
    const alone = await planGithubReview([SMALL]);

    expect(plan.batchesTotal).toBe(3);
    expect(plan.batchesWithinCap).toBe(2);
    expect(plan.estimate).toBe(alone.estimate * 2);
    expect(plan.firstBatch).toBe(alone.estimate);

    const first = await planGithubReview([HUGE, SMALL]);
    expect(first.batchesWithinCap).toBe(1);
    expect(first.firstBatch).toBe(alone.estimate);
  });
});

describe("a file the plan skipped that the real prompt would fit", () => {
  // Over the cap with the plan's 25% framing allowance, under it with the
  // real line prefixes of ordinary 38-character lines.
  const BETWEEN = 250_000;

  it("a metered run skips it too, instead of stopping at a budget planned without it", async () => {
    const files = [file("data/big.json", BETWEEN), file("src/a.ts", SMALL)];
    const plan = await planGithubReview(
      files.map((f) => Buffer.byteLength(f.content, "utf8")),
    );
    expect(plan.batchesWithinCap).toBe(1);

    const result = await runGithubAiReview(files, 1, false, plan.estimate);

    expect(sentPaths.flat()).toEqual(["src/a.ts"]);
    expect(result.filesSkippedOverRunCap).toEqual(["data/big.json"]);
    expect(result.stoppedAtBudget).toBe(false);
    expect(result.filesReviewed).toBe(1);
  });

  it("a run nothing caps still sends it, since its real prompt is under the cap", async () => {
    const files = [file("data/big.json", BETWEEN)];

    const result = await runGithubAiReview(files, 1, false, null);

    expect(sentPaths.flat()).toEqual(["data/big.json"]);
    expect(result.filesSkippedOverRunCap).toEqual([]);
    expect(result.filesReviewed).toBe(1);
    expect(inputSent.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(RUN_CAP);
  });
});

describe("the count of batches that failed", () => {
  it("a first batch whose call failed and a later batch stopped by the budget are told apart", async () => {
    const files = [file("src/a.ts", SMALL), file("src/b.ts", SMALL)];
    const plan = await planGithubReview([SMALL]);
    // Room for one batch's worst case: the failed call is held at its
    // ceiling, because the provider may have billed it.
    failNext = 1;

    const result = await runGithubAiReview(files, 1, false, plan.estimate);

    expect(sentPaths.flat()).toEqual(["src/a.ts"]);
    expect(result.batchesFailed).toBe(1);
    expect(result.batchesReviewed).toBe(0);
    expect(result.filesReviewed).toBe(0);
    expect(result.stoppedAtBudget).toBe(true);
  });
});
