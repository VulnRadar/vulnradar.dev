import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeLedgerDb } from "./_token-ledger-fake";

/**
 * The free plan's edge. A plan with no review allowance of its own
 * (githubReviewTokensPerWindow 0) gets the trial, then only what its
 * purchased credits pay for. The route refused zero credits with a 403 and
 * no scan, but credits below one AI batch fell through the gate as an
 * ordinary "allowance too small" refusal, and the route ran the pattern scan
 * for it: one token of credit was a free pattern scan on every request, and
 * the credits were never spent. The gate now marks that refusal as the plan
 * gate, the same one zero credits hits, and a paid plan's refusal is not.
 */

let fake = createFakeLedgerDb();
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => fake.pool.query(sql, params),
    connect: () => fake.pool.connect(),
  },
}));

vi.mock("@/lib/ai/verify-findings", () => ({
  resolveUserEndpoint: async () => null,
}));

const mockGetUserPlanLimits = vi.fn();
vi.mock("@/lib/billing/plan-limits", () => ({
  getUserPlanLimits: (...args: unknown[]) => mockGetUserPlanLimits(...args),
}));

vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: async (key: string) =>
    key === "GITHUB_REVIEW_FREE_TRIAL_WINDOW_HOURS" ? 24 : 5,
}));

const { reserveGithubReviewTokens } =
  await import("@/lib/billing/github-review-usage");
const { resolveCurrentWindow } = await import("@/lib/billing/ai-usage");

// A fresh account per case: a reservation let in and never settled keeps its
// single-flight slot, which would read as busy to the next case.
let USER = 30;
const ESTIMATE = 120_000;
const ONE_BATCH = 53_000;

function plan(githubReviewTokensPerWindow: number) {
  mockGetUserPlanLimits.mockResolvedValue({ githubReviewTokensPerWindow });
}

beforeEach(() => {
  USER++;
  mockGetUserPlanLimits.mockReset();
});

describe("reserveGithubReviewTokens at the free plan's edge", () => {
  it("trial used, zero credits: refused by the plan gate", async () => {
    plan(0);
    fake = createFakeLedgerDb({ githubBalance: 0, trialUsed: true });

    const gate = await reserveGithubReviewTokens(USER, ESTIMATE, ONE_BATCH);

    expect(gate.allowed).toBe(false);
    if (gate.allowed) return;
    expect(gate.busy).toBe(false);
    expect(gate.planGate).toBe(true);
  });

  it("trial used, credits below one batch: refused by the same plan gate, and nothing is spent", async () => {
    plan(0);
    fake = createFakeLedgerDb({
      githubBalance: ONE_BATCH - 1,
      trialUsed: true,
    });

    const gate = await reserveGithubReviewTokens(USER, ESTIMATE, ONE_BATCH);

    expect(gate.allowed).toBe(false);
    if (gate.allowed) return;
    expect(gate.busy).toBe(false);
    expect(gate.planGate).toBe(true);
    expect(gate.message).toMatch(/Buy GitHub review credits/);
    expect(fake.state.balances.github_credit_balance).toBe(ONE_BATCH - 1);
  });

  it("trial used, credits of exactly one batch: let in, paid from the credits", async () => {
    plan(0);
    fake = createFakeLedgerDb({ githubBalance: ONE_BATCH, trialUsed: true });

    const gate = await reserveGithubReviewTokens(USER, ESTIMATE, ONE_BATCH);

    expect(gate.allowed).toBe(true);
    if (!gate.allowed) return;
    expect(gate.reservation.creditCovered).toBe(true);
    expect(gate.reservation.isFreeTrial).toBe(false);
    expect(gate.reservation.budget).toBe(ONE_BATCH);
    expect(fake.state.balances.github_credit_balance).toBe(0);
  });

  it("trial unused: let in as the trial, whatever the credits", async () => {
    plan(0);
    fake = createFakeLedgerDb({ githubBalance: 1 });

    const gate = await reserveGithubReviewTokens(USER, ESTIMATE, ONE_BATCH);

    expect(gate.allowed).toBe(true);
    if (!gate.allowed) return;
    expect(gate.reservation.isFreeTrial).toBe(true);
  });

  it("a paid plan with its window used and credits below one batch is not the plan gate", async () => {
    plan(200_000);
    const { windowStart } = await resolveCurrentWindow();
    fake = createFakeLedgerDb({
      githubBalance: ONE_BATCH - 1,
      githubUsed: { windowStart, tokens: 200_000 },
    });

    const gate = await reserveGithubReviewTokens(USER, ESTIMATE, ONE_BATCH);

    expect(gate.allowed).toBe(false);
    if (gate.allowed) return;
    expect(gate.busy).toBe(false);
    expect(gate.planGate).toBe(false);
  });

  it("a second review while one runs is busy, not the plan gate", async () => {
    plan(0);
    fake = createFakeLedgerDb({ githubBalance: 500_000, trialUsed: true });

    const [a, b] = await Promise.all([
      reserveGithubReviewTokens(USER, ESTIMATE, ONE_BATCH),
      reserveGithubReviewTokens(USER, ESTIMATE, ONE_BATCH),
    ]);
    const refused = [a, b].find((g) => !g.allowed);

    expect(refused).toBeDefined();
    if (!refused || refused.allowed) return;
    expect(refused.busy).toBe(true);
    expect(refused.planGate).toBe(false);
  });
});
