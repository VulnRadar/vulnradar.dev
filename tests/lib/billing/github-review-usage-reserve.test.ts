import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeLedgerDb } from "./_token-ledger-fake";

/**
 * reserveGithubReviewTokens / settleGithubReviewTokens. A repo review is the
 * largest single AI spend in the product (up to GITHUB_REVIEW_MAX_TOKENS_PER_RUN
 * per run), and its gate used to let a review in on any positive balance and
 * charge afterwards with a floor at zero: one credit bought a whole review.
 */

let fake = createFakeLedgerDb();
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => fake.pool.query(sql, params),
    connect: () => fake.pool.connect(),
  },
}));

const mockResolveUserEndpoint = vi.fn();
vi.mock("@/lib/ai/verify-findings", () => ({
  resolveUserEndpoint: (...args: unknown[]) => mockResolveUserEndpoint(...args),
}));

const mockGetUserPlanLimits = vi.fn();
vi.mock("@/lib/billing/plan-limits", () => ({
  getUserPlanLimits: (...args: unknown[]) => mockGetUserPlanLimits(...args),
}));

vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: async (key: string) =>
    key === "GITHUB_REVIEW_FREE_TRIAL_WINDOW_HOURS" ? 24 : 5,
}));

const { reserveGithubReviewTokens, settleGithubReviewTokens } =
  await import("@/lib/billing/github-review-usage");
const { currentWindowStart } = await import("@/lib/billing/ai-usage");

const USER = 11;

function plan(githubReviewTokensPerWindow: number) {
  mockGetUserPlanLimits.mockResolvedValue({ githubReviewTokensPerWindow });
}

beforeEach(() => {
  fake = createFakeLedgerDb();
  mockResolveUserEndpoint.mockReset();
  mockResolveUserEndpoint.mockResolvedValue(null);
  mockGetUserPlanLimits.mockReset();
});

describe("reserveGithubReviewTokens on a plan with no review allowance", () => {
  it("claims the free trial when it is unused, and charges nothing for it", async () => {
    plan(0);
    fake = createFakeLedgerDb({ githubBalance: 50 });

    const gate = await reserveGithubReviewTokens(USER, 120_000);

    expect(gate.allowed).toBe(true);
    if (!gate.allowed) return;
    expect(gate.reservation.isFreeTrial).toBe(true);
    expect(gate.reservation.creditCovered).toBe(false);
    expect(gate.reservation.budget).toBeNull();
    expect(fake.state.trialUsed).toBe(true);

    await settleGithubReviewTokens(gate.reservation, 90_000);
    expect(fake.state.balances.github_credit_balance).toBe(50);
    expect([...fake.state.usage.github_review_usage.values()]).toEqual([
      90_000,
    ]);
  });

  it("with the trial spent, one of two parallel gates is let in against 1000 credits and the balance never pays for more", async () => {
    plan(0);
    fake = createFakeLedgerDb({ githubBalance: 1000, trialUsed: true });

    const [a, b] = await Promise.all([
      reserveGithubReviewTokens(USER, 600),
      reserveGithubReviewTokens(USER, 600),
    ]);

    const allowed = [a, b].filter((g) => g.allowed);
    expect(allowed).toHaveLength(1);
    expect(fake.state.balances.github_credit_balance).toBe(400);
    for (const g of [a, b]) {
      if (g.allowed) {
        expect(g.reservation.creditCovered).toBe(true);
        await settleGithubReviewTokens(g.reservation, 300_000);
      }
    }
    expect(fake.state.balances.github_credit_balance).toBe(0);
  });

  it("refuses when the trial is spent and the balance does not cover the repo's estimate", async () => {
    plan(0);
    fake = createFakeLedgerDb({ githubBalance: 1, trialUsed: true });

    const gate = await reserveGithubReviewTokens(USER, 120_000);

    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.message).toMatch(/120,000/);
    expect(fake.state.balances.github_credit_balance).toBe(1);
  });

  it("refuses with the trial message when the trial is spent and there is no balance", async () => {
    plan(0);
    fake = createFakeLedgerDb({ trialUsed: true });

    const gate = await reserveGithubReviewTokens(USER, 1_000);

    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.message).toMatch(/free GitHub AI review/);
      expect(gate.message).toMatch(/24 hours/);
    }
  });
});

describe("reserveGithubReviewTokens on a plan with a review allowance", () => {
  it("debits the window first and the balance for the rest, then refunds the unused part", async () => {
    plan(200_000);
    const windowStart = currentWindowStart(new Date(), 5);
    fake = createFakeLedgerDb({
      githubBalance: 100_000,
      githubUsed: { windowStart, tokens: 150_000 },
    });

    const gate = await reserveGithubReviewTokens(USER, 120_000);
    if (!gate.allowed) throw new Error("expected the gate to allow");
    expect(gate.reservation.windowPortion).toBe(50_000);
    expect(gate.reservation.creditPortion).toBe(70_000);
    expect(fake.state.balances.github_credit_balance).toBe(30_000);

    await settleGithubReviewTokens(gate.reservation, 80_000);

    // 50000 of window, 30000 of credit: 40000 of credit comes back.
    expect(fake.state.balances.github_credit_balance).toBe(70_000);
    expect(
      fake.state.usage.github_review_usage.get(windowStart.toISOString()),
    ).toBe(230_000);
  });

  it("refuses when the window and the balance together fall short, instead of letting the review run on a positive balance", async () => {
    plan(200_000);
    const windowStart = currentWindowStart(new Date(), 5);
    fake = createFakeLedgerDb({
      githubBalance: 1,
      githubUsed: { windowStart, tokens: 200_000 },
    });

    const gate = await reserveGithubReviewTokens(USER, 120_000);

    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.busy).toBe(false);
  });

  it("a second review for the same user is refused as busy until the first settles", async () => {
    plan(1_000_000);
    const first = await reserveGithubReviewTokens(USER, 10_000);
    const second = await reserveGithubReviewTokens(USER, 10_000);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    if (!second.allowed) expect(second.busy).toBe(true);
    if (first.allowed) await settleGithubReviewTokens(first.reservation, 0);
  });

  it("a user with their own AI key is let in with no budget and nothing is recorded", async () => {
    mockResolveUserEndpoint.mockResolvedValue({
      baseUrl: "https://own.test",
      model: "m",
      apiKey: "k",
    });
    const gate = await reserveGithubReviewTokens(USER, 5_000_000);
    expect(gate.allowed).toBe(true);
    if (!gate.allowed) return;
    expect(gate.reservation.usingOwnAi).toBe(true);
    await settleGithubReviewTokens(gate.reservation, 5_000_000);
    expect(fake.statements).toEqual([]);
  });
});
