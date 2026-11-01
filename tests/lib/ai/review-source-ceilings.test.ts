/**
 * A repo review call has to fit inside what the route reserved, on the
 * repository's own text, before the call is made.
 *
 * The ceiling counted four characters per token. Text in CJK scripts, emoji
 * and symbol-heavy code tokenise near one token per character or denser, so a
 * review of such a repository spent several times its reservation, and the
 * settle charged the overrun afterwards with a floor at zero.
 *
 * The provider below bills every call at the most a byte-level tokenizer can:
 * one input token per UTF-8 byte sent, plus the whole output allowance.
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

const { runGithubAiReview, estimateGithubReviewTokens } =
  await import("@/lib/ai/review-source");

function worstCaseProvider() {
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
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "[]" } }],
          usage: {
            prompt_tokens: input,
            completion_tokens: body.max_tokens,
            total_tokens: input + body.max_tokens,
          },
        }),
      };
    },
  );
}

/** A file of `lines` lines of `line`, the way the tree and fetch see it. */
function file(path: string, line: string, lines: number): RepoFile {
  return {
    path,
    content: Array.from({ length: lines }, () => line).join("\n"),
  };
}

/** What the route reserves: the GitHub tree reports sizes in bytes. */
function treeSizes(files: RepoFile[]): number[] {
  return files.map((f) => Buffer.byteLength(f.content, "utf8"));
}

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  process.env.AI_BASE_URL = "https://api.example-llm.test/v1";
  process.env.AI_API_KEY = "test-key";
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;
  global.fetch = vi.fn();
  worstCaseProvider();
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe("a repo review stays inside its reservation on dense text", () => {
  it.each([
    ["CJK text", "// 漢字で書かれたコメントと説明文です"],
    ["emoji", "const s = '\u{1F600}\u{1F525}\u{1F680}\u{1F4A5}\u{1F44D}';"],
    ["symbol-heavy code", "x=>{a[b]^=~c|d&e;}?(f):!g;"],
  ])("a file of %s costs no more than was reserved", async (_, line) => {
    const files = [
      file("src/a.js", line, 600),
      file("src/b.js", line, 600),
      file("src/c.js", line, 600),
    ];
    const budget = await estimateGithubReviewTokens(treeSizes(files));

    const result = await runGithubAiReview(files, 1, false, budget);

    expect(global.fetch).toHaveBeenCalled();
    expect(result.stoppedAtBudget).toBe(false);
    expect(result.totalTokensUsed).toBeLessThanOrEqual(budget);
  });

  it("refuses a batch whose prompt would overrun what is left, before sending it", async () => {
    // The route reserves from the sizes the tree reported, before any content
    // is fetched. Content that turns out larger than that (the branch moved
    // on, or bytes that do not decode and come back as three-byte
    // replacement characters) builds a prompt the reservation cannot cover.
    const files = [file("src/a.js", "漢字".repeat(20), 400)];
    const budget = await estimateGithubReviewTokens([1_000]);

    const result = await runGithubAiReview(files, 1, false, budget);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.stoppedAtBudget).toBe(true);
    expect(result.totalTokensUsed).toBe(0);
  });
});
