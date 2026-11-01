/**
 * GITHUB_REVIEW_MAX_TOKENS_PER_RUN bounds what one repo review may send to a
 * provider, on every run, including the ones no reservation caps: the free
 * trial, a user's own key, billing turned off. Those runs skip the per-batch
 * admission against a reservation, so the run cap is the only thing between
 * the repository's text and the operator's key.
 *
 * It was counted as four characters per token (the run) or four bytes per
 * token (the route's tree estimate). CJK text and emoji tokenise near one
 * token per character, so a repo of either passed the check at a quarter of
 * its real size and sent several times the cap. Both paths now count one
 * token per UTF-8 byte, the bound the reservation uses.
 *
 * The provider below reports exactly the bytes it was sent as input.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { RepoFile } from "@/lib/scanner/github-repo-scan";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

vi.mock("@/lib/billing/github-review-usage", () => ({
  recordGithubReviewTokens: vi.fn(),
}));

const { runGithubAiReview, planGithubReview } =
  await import("@/lib/ai/review-source");
const { CONFIG_GITHUB_REVIEW_MAX_TOKENS_PER_RUN: RUN_CAP } =
  await import("@/lib/config/config-values");

let inputSent: number[] = [];

function byteCountingProvider() {
  (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
    async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as {
        max_tokens: number;
        messages: { content: string }[];
      };
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

/** `count` files of about `bytes` UTF-8 bytes each, built from `line`. */
function denseFiles(line: string, count: number, bytes: number): RepoFile[] {
  const lineBytes = Buffer.byteLength(line, "utf8") + 1;
  const lines = Math.floor(bytes / lineBytes);
  return Array.from({ length: count }, (_, i) => ({
    path: `src/f${i}.txt`,
    content: Array.from({ length: lines }, () => line).join("\n"),
  }));
}

const DENSE = [
  ["CJK text", "漢字で書かれたコメントと説明文です"],
  ["emoji", "\u{1F600}\u{1F525}\u{1F680}\u{1F4A5}\u{1F44D}\u{1F680}\u{1F525}"],
] as const;

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  inputSent = [];
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  process.env.AI_BASE_URL = "https://api.example-llm.test/v1";
  process.env.AI_API_KEY = "test-key";
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;
  global.fetch = vi.fn();
  byteCountingProvider();
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe("the run path: an uncapped review never sends more than the per-run cap", () => {
  it.each(DENSE)(
    "a repo of %s stops at the batch that would cross the cap",
    async (_, line) => {
      // About 390 KB: a quarter of that by characters, so the old check
      // passed it, and well over the cap in bytes.
      const files = denseFiles(line, 10, 39_000);
      const chars = files.reduce((n, f) => n + f.content.length, 0);
      expect(Math.ceil(chars / 4)).toBeLessThan(RUN_CAP);

      const result = await runGithubAiReview(files, 1, false, null);

      const sent = inputSent.reduce((a, b) => a + b, 0);
      expect(inputSent.length).toBeGreaterThan(0);
      expect(sent).toBeLessThanOrEqual(RUN_CAP);
      expect(result.stoppedAtRunCap).toBe(true);
      expect(result.stoppedAtBudget).toBe(false);
      expect(result.filesTotal).toBe(10);
      expect(result.filesReviewed).toBe(inputSent.length);
      expect(result.filesReviewed).toBeLessThan(10);
      expect(result.batchesReviewed).toBe(inputSent.length);
      expect(result.batchesTotal).toBe(10);
    },
  );

  it("refuses the first batch outright when it alone is over the cap", async () => {
    const files = denseFiles("漢字".repeat(30), 2, 290_000);
    const result = await runGithubAiReview(files, 1, false, null);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.rejectedOverCap).toBe(true);
    expect(result.stoppedAtRunCap).toBe(true);
    expect(result.filesReviewed).toBe(0);
  });

  it("a repo inside the cap is reviewed whole and says so", async () => {
    const files = denseFiles(DENSE[0][1], 3, 20_000);
    const result = await runGithubAiReview(files, 1, false, null);

    expect(result.stoppedAtRunCap).toBe(false);
    expect(result.filesReviewed).toBe(3);
    expect(result.filesTotal).toBe(3);
  });
});

describe("the route path: the plan from tree sizes counts the cap by bytes", () => {
  it.each(DENSE)(
    "%s: plans only the batches whose input fits under the cap",
    async (_, line) => {
      const files = denseFiles(line, 10, 39_000);
      const sizes = files.map((f) => Buffer.byteLength(f.content, "utf8"));
      // The old route check: bytes / 4, under the cap.
      expect(Math.ceil(sizes.reduce((a, b) => a + b, 0) / 4)).toBeLessThan(
        RUN_CAP,
      );

      const plan = await planGithubReview(sizes);

      expect(plan.batchesTotal).toBe(10);
      expect(plan.batchesWithinCap).toBeGreaterThan(0);
      expect(plan.batchesWithinCap).toBeLessThan(10);
      expect(plan.inputWithinCap).toBeLessThanOrEqual(RUN_CAP);
      // Whatever the plan admits, the run itself never sends more.
      const result = await runGithubAiReview(files, 1, false, plan.estimate);
      expect(inputSent.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(RUN_CAP);
      expect(result.totalTokensUsed).toBeLessThanOrEqual(plan.estimate);
    },
  );

  it("names the first batch's ceiling as the least a reservation needs", async () => {
    const plan = await planGithubReview([39_000, 39_000, 39_000]);
    const one = await planGithubReview([39_000]);

    expect(plan.firstBatch).toBe(one.estimate);
    expect(plan.estimate).toBe(one.estimate * 3);
  });

  it("plans nothing when the first batch alone is over the cap", async () => {
    const plan = await planGithubReview([RUN_CAP]);

    expect(plan.batchesWithinCap).toBe(0);
    expect(plan.estimate).toBe(0);
    expect(plan.firstBatch).toBe(0);
  });
});
