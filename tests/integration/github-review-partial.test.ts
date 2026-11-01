import { it, expect, beforeEach, afterAll } from "vitest";
import pool from "@/lib/database/db";
import { resolveCurrentWindow } from "@/lib/billing/ai-usage";
import {
  reserveGithubReviewTokens,
  settleGithubReviewTokens,
  getGithubCreditBalance,
  getGithubReviewTokensUsed,
} from "@/lib/billing/github-review-usage";
import {
  describeIntegration,
  createUser,
  setSettings,
  clearSettings,
} from "./_db";

/**
 * A repo review reserves what the window and the balance hold, between the
 * first batch's worst case and the whole estimate, instead of refusing every
 * repo whose worst case is past what is left. The split between window and
 * credits, and the refund at settle, are statements Postgres runs under the
 * user's row lock, which the unit tier's in-memory ledger only imitates.
 */
describeIntegration("GitHub review partial reservations", () => {
  beforeEach(async () => {
    await setSettings({
      BILLING_ENABLED: true,
      BILLING_FREE_GITHUB_REVIEW_TOKENS_PER_WINDOW: 200_000,
    });
  });

  afterAll(async () => {
    await clearSettings();
  });

  async function userWith(balance: number, used: number) {
    const user = await createUser();
    const { windowStart } = await resolveCurrentWindow();
    await pool.query(
      `UPDATE users SET github_credit_balance = $2 WHERE id = $1`,
      [user.id, balance],
    );
    await pool.query(
      `INSERT INTO github_review_usage (user_id, window_start, tokens_used, updated_at)
       VALUES ($1, $2, $3, NOW())`,
      [user.id, windowStart, used],
    );
    return { user, windowStart };
  }

  it("partial fit: takes everything left when the first batch fits, and settles the unused part back", async () => {
    const { user, windowStart } = await userWith(5_000, 150_000);

    const gate = await reserveGithubReviewTokens(user.id, 213_520, 53_000);

    if (!gate.allowed) throw new Error(gate.message);
    expect(gate.reservation.budget).toBe(55_000);
    expect(gate.reservation.windowPortion).toBe(50_000);
    expect(gate.reservation.creditPortion).toBe(5_000);
    expect(await getGithubCreditBalance(user.id)).toBe(0);
    expect(await getGithubReviewTokensUsed(user.id, windowStart)).toBe(205_000);

    await settleGithubReviewTokens(gate.reservation, 51_000);

    expect(await getGithubCreditBalance(user.id)).toBe(4_000);
    expect(await getGithubReviewTokensUsed(user.id, windowStart)).toBe(201_000);
  });

  it("no fit: refuses and leaves the window and the balance as they were", async () => {
    const { user, windowStart } = await userWith(1_000, 190_000);

    const gate = await reserveGithubReviewTokens(user.id, 213_520, 53_000);

    expect(gate.allowed).toBe(false);
    expect(await getGithubCreditBalance(user.id)).toBe(1_000);
    expect(await getGithubReviewTokensUsed(user.id, windowStart)).toBe(190_000);
  });

  it("two parallel partial reservations never hand out more than was left", async () => {
    const { user, windowStart } = await userWith(5_000, 150_000);

    const gates = await Promise.all([
      reserveGithubReviewTokens(user.id, 213_520, 10_000),
      reserveGithubReviewTokens(user.id, 213_520, 10_000),
    ]);

    // Single-flight lets one in; the row lock would hold the second to what
    // the first left even without it.
    const allowed = gates.filter((g) => g.allowed);
    expect(allowed).toHaveLength(1);
    expect(await getGithubCreditBalance(user.id)).toBe(0);
    expect(await getGithubReviewTokensUsed(user.id, windowStart)).toBe(205_000);
    for (const g of allowed) {
      if (g.allowed) await settleGithubReviewTokens(g.reservation, 0);
    }
    expect(await getGithubCreditBalance(user.id)).toBe(5_000);
    expect(await getGithubReviewTokensUsed(user.id, windowStart)).toBe(150_000);
  });
});
