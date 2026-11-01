import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { RepoFile } from "@/lib/scanner/github-repo-scan";
import { createFakeLedgerDb } from "./_token-ledger-fake";

/**
 * A repo too large for what the account has left is partly reviewed, and the
 * account is never charged past what was reserved for it.
 *
 * The whole path runs for real except the database (the in-memory ledger) and
 * the provider (fetch), which bills every call at the most a byte-level
 * tokenizer can: one input token per UTF-8 byte sent, plus the whole output
 * allowance. That is the bill the reservation has to survive.
 */

let fake = createFakeLedgerDb();
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => fake.pool.query(sql, params),
    connect: () => fake.pool.connect(),
  },
}));

vi.mock("@/lib/ai/verify-findings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/verify-findings")>()),
  resolveUserEndpoint: async () => null,
}));

const mockGetUserPlanLimits = vi.fn();
vi.mock("@/lib/billing/plan-limits", () => ({
  getUserPlanLimits: (...args: unknown[]) => mockGetUserPlanLimits(...args),
}));

vi.mock("@/lib/config/runtime-config", async () => {
  const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");
  const resolve = (key: string) =>
    (SETTINGS_REGISTRY as Record<string, { default: unknown }>)[key]?.default;
  return {
    getSetting: (key: string) => Promise.resolve(resolve(key)),
    getSettings: (keys: readonly string[]) =>
      Promise.resolve(Object.fromEntries(keys.map((k) => [k, resolve(k)]))),
  };
});

const { reserveGithubReviewTokens, settleGithubReviewTokens } =
  await import("@/lib/billing/github-review-usage");
const { planGithubReview, runGithubAiReview } =
  await import("@/lib/ai/review-source");
const { resolveCurrentWindow } = await import("@/lib/billing/ai-usage");

const USER = 21;

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

/** `count` files of about `bytes` UTF-8 bytes each, built from `line`. */
function repo(line: string, count: number, bytes: number): RepoFile[] {
  const lineBytes = Buffer.byteLength(line, "utf8") + 1;
  const lines = Math.floor(bytes / lineBytes);
  return Array.from({ length: count }, (_, i) => ({
    path: `src/f${i}.txt`,
    content: Array.from({ length: lines }, () => line).join("\n"),
  }));
}

const TEXTS = [
  ["symbol-heavy code", "x=>{a[b]^=~c|d&e;}?(f):!g;"],
  ["CJK text", "// 漢字で書かれたコメントと説明文です"],
  ["emoji", "const s = '\u{1F600}\u{1F525}\u{1F680}\u{1F4A5}\u{1F44D}';"],
] as const;

/** The route's sequence: plan, reserve, run, settle. A refused gate still
 *  runs, as the route does, with a budget of zero. */
async function review(files: RepoFile[]) {
  const sizes = files.map((f) => Buffer.byteLength(f.content, "utf8"));
  const plan = await planGithubReview(sizes);
  const gate = await reserveGithubReviewTokens(
    USER,
    plan.estimate,
    plan.firstBatch,
  );
  if (!gate.allowed) {
    const result = await runGithubAiReview(files, USER, false, 0);
    return { plan, gate, result };
  }
  const result = await runGithubAiReview(
    files,
    USER,
    false,
    gate.reservation.budget,
  );
  await settleGithubReviewTokens(gate.reservation, result.totalTokensUsed);
  return { plan, gate, result };
}

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.AI_BASE_URL = "https://api.example-llm.test/v1";
  process.env.AI_API_KEY = "test-key";
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;
  global.fetch = vi.fn();
  worstCaseProvider();
  mockGetUserPlanLimits.mockReset();
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe("a repo review against what the account has left", () => {
  it.each(TEXTS)(
    "partial fit, %s: reviews what the reservation covers, stops at a batch boundary, and charges no more than it reserved",
    async (_, line) => {
      mockGetUserPlanLimits.mockResolvedValue({
        githubReviewTokensPerWindow: 200_000,
      });
      const { windowStart } = await resolveCurrentWindow();
      fake = createFakeLedgerDb({
        githubBalance: 20_000,
        githubUsed: { windowStart, tokens: 150_000 },
      });
      const files = repo(line, 6, 39_000);

      const { plan, gate, result } = await review(files);

      if (!gate.allowed || !result) throw new Error("expected a review");
      const budget = gate.reservation.budget!;
      expect(budget).toBe(70_000);
      expect(budget).toBeLessThan(plan.estimate);
      expect(result.stoppedAtBudget).toBe(true);
      expect(result.filesReviewed).toBeGreaterThan(0);
      expect(result.filesReviewed).toBeLessThan(files.length);
      expect(result.filesTotal).toBe(files.length);
      expect(result.totalTokensUsed).toBeGreaterThan(0);
      expect(result.totalTokensUsed).toBeLessThanOrEqual(budget);

      // What the account paid: the counter moved by the real spend, the
      // credits by the part of it past the window, and neither by more than
      // was reserved.
      const used = fake.state.usage.github_review_usage.get(
        windowStart.toISOString(),
      )!;
      const creditsSpent = 20_000 - fake.state.balances.github_credit_balance;
      expect(used - 150_000).toBe(result.totalTokensUsed);
      expect(used - 150_000).toBeLessThanOrEqual(budget);
      expect(creditsSpent).toBe(Math.max(0, result.totalTokensUsed - 50_000));
      expect(creditsSpent).toBeLessThanOrEqual(gate.reservation.creditPortion);
    },
  );

  it("full fit: a repo the account covers is reviewed whole", async () => {
    mockGetUserPlanLimits.mockResolvedValue({
      githubReviewTokensPerWindow: 1_000_000,
    });
    fake = createFakeLedgerDb();
    const files = repo(TEXTS[1][1], 4, 39_000);

    const { plan, gate, result } = await review(files);

    if (!gate.allowed || !result) throw new Error("expected a review");
    expect(gate.reservation.budget).toBe(plan.estimate);
    expect(result.stoppedAtBudget).toBe(false);
    expect(result.filesReviewed).toBe(4);
    expect(result.totalTokensUsed).toBeLessThanOrEqual(plan.estimate);
  });

  it("no fit: when not even the first batch fits, nothing is reserved and nothing is sent", async () => {
    mockGetUserPlanLimits.mockResolvedValue({
      githubReviewTokensPerWindow: 200_000,
    });
    const { windowStart } = await resolveCurrentWindow();
    fake = createFakeLedgerDb({
      githubBalance: 1_000,
      githubUsed: { windowStart, tokens: 195_000 },
    });

    const { gate, result } = await review(repo(TEXTS[1][1], 3, 39_000));

    expect(gate.allowed).toBe(false);
    // The run still happens, on a budget of zero, and stops before the first
    // batch: a null budget here would mean uncapped.
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result?.stoppedAtBudget).toBe(true);
    expect(result?.filesReviewed).toBe(0);
    expect(result?.filesTotal).toBe(3);
    expect(result?.totalTokensUsed).toBe(0);
    expect(fake.state.balances.github_credit_balance).toBe(1_000);
    expect(
      fake.state.usage.github_review_usage.get(windowStart.toISOString()),
    ).toBe(195_000);
  });
});
