import { it, expect, beforeEach, afterAll } from "vitest";
import pool from "@/lib/database/db";
import {
  reserveAiTokens,
  settleAiTokens,
  getAiCreditBalance,
  getAiTokensUsed,
  resolveCurrentWindow,
} from "@/lib/billing/ai-usage";
import {
  reserveGithubReviewTokens,
  settleGithubReviewTokens,
  getGithubCreditBalance,
  getGithubReviewTokensUsed,
} from "@/lib/billing/github-review-usage";
import {
  debitWindowAndBalance,
  AI_TOKEN_LEDGER,
  GITHUB_REVIEW_TOKEN_LEDGER,
} from "@/lib/billing/token-reservation";
import {
  describeIntegration,
  createUser,
  setSettings,
  clearSettings,
} from "./_db";

/**
 * The AI and GitHub review credit gates, where "atomic" is a claim about
 * Postgres's row locks rather than about JavaScript.
 *
 * The gate these replace asked whether any balance was left and charged after
 * the run with a floor at zero. A free account with 1000 credits could start
 * two verifications at once, both were let in on "1000 > 0", and each then
 * recorded 300000 tokens: 600000 tokens of operator-paid AI for 1000 bought.
 *
 * Now the gate debits the estimate before the run inside a transaction that
 * holds the user's row lock, so the second gate reads the first one's debit.
 * That ordering is exactly what a faked pool cannot show: it answers whatever
 * the test scripted, in whatever order the promises happen to resolve.
 */
describeIntegration("AI and GitHub review credit reservations", () => {
  beforeEach(async () => {
    await setSettings({
      BILLING_ENABLED: true,
      // A free plan whose AI and review allowance is zero, so every token the
      // runs below are let in for comes out of the purchased balance.
      BILLING_FREE_AI_TOKENS_PER_WINDOW: 0,
      BILLING_FREE_GITHUB_REVIEW_TOKENS_PER_WINDOW: 0,
    });
  });

  afterAll(async () => {
    await clearSettings();
  });

  it("free user with 1000 credits: two parallel gates, two 300000-token records, the second gate refuses and the balance never covers more than was bought", async () => {
    const user = await createUser({ aiCreditBalance: 1000 });

    const gates = await Promise.all([
      reserveAiTokens(user.id, 600),
      reserveAiTokens(user.id, 600),
    ]);
    expect(gates.filter((g) => g.allowed)).toHaveLength(1);
    expect(await getAiCreditBalance(user.id)).toBe(400);

    for (const gate of gates) {
      if (gate.allowed) await settleAiTokens(gate.reservation, 300_000);
    }

    const balance = await getAiCreditBalance(user.id);
    expect(balance).toBe(0);
    expect(balance).toBeGreaterThanOrEqual(0);

    // And with the balance spent, the next gate refuses outright.
    const next = await reserveAiTokens(user.id, 1);
    expect(next.allowed).toBe(false);
  });

  it("the row lock serialises two parallel debits from separate connections, single-flight aside", async () => {
    const user = await createUser({ aiCreditBalance: 1000 });
    const { windowStart } = await resolveCurrentWindow();

    const debits = await Promise.all([
      debitWindowAndBalance(AI_TOKEN_LEDGER, user.id, windowStart, 0, 600, 600),
      debitWindowAndBalance(AI_TOKEN_LEDGER, user.id, windowStart, 0, 600, 600),
    ]);

    expect(debits.filter((d) => d.ok)).toHaveLength(1);
    expect(await getAiCreditBalance(user.id)).toBe(400);
    expect(await getAiTokensUsed(user.id, windowStart)).toBe(600);
  });

  it("the window allowance alone is not handed out twice", async () => {
    await setSettings({ BILLING_FREE_AI_TOKENS_PER_WINDOW: 1000 });
    const user = await createUser();
    const { windowStart } = await resolveCurrentWindow();

    const debits = await Promise.all([
      debitWindowAndBalance(
        AI_TOKEN_LEDGER,
        user.id,
        windowStart,
        1000,
        800,
        800,
      ),
      debitWindowAndBalance(
        AI_TOKEN_LEDGER,
        user.id,
        windowStart,
        1000,
        800,
        800,
      ),
    ]);

    expect(debits.filter((d) => d.ok)).toHaveLength(1);
    expect(await getAiTokensUsed(user.id, windowStart)).toBe(800);
  });

  it("settlement returns the unused credit and brings the window counter down to the real count", async () => {
    await setSettings({ BILLING_FREE_AI_TOKENS_PER_WINDOW: 1000 });
    const user = await createUser({ aiCreditBalance: 500 });
    const { windowStart } = await resolveCurrentWindow();

    const gate = await reserveAiTokens(user.id, 1200);
    if (!gate.allowed) throw new Error(gate.message);
    expect(gate.reservation.windowPortion).toBe(1000);
    expect(gate.reservation.creditPortion).toBe(200);
    expect(await getAiCreditBalance(user.id)).toBe(300);

    await settleAiTokens(gate.reservation, 700);

    expect(await getAiCreditBalance(user.id)).toBe(500);
    expect(await getAiTokensUsed(user.id, windowStart)).toBe(700);
  });

  it("GitHub review: with the trial spent, two parallel gates against 1000 credits let one in and the balance never goes below zero", async () => {
    const user = await createUser();
    await pool.query(
      `UPDATE users SET github_credit_balance = 1000, free_github_review_used_at = NOW() WHERE id = $1`,
      [user.id],
    );

    const gates = await Promise.all([
      reserveGithubReviewTokens(user.id, 600),
      reserveGithubReviewTokens(user.id, 600),
    ]);
    expect(gates.filter((g) => g.allowed)).toHaveLength(1);
    expect(await getGithubCreditBalance(user.id)).toBe(400);

    for (const gate of gates) {
      if (gate.allowed)
        await settleGithubReviewTokens(gate.reservation, 300_000);
    }
    expect(await getGithubCreditBalance(user.id)).toBe(0);
  });

  it("GitHub review: two parallel debits from separate connections are held to one by the row lock", async () => {
    const user = await createUser();
    await pool.query(
      `UPDATE users SET github_credit_balance = 1000 WHERE id = $1`,
      [user.id],
    );
    const { windowStart } = await resolveCurrentWindow();

    const debits = await Promise.all([
      debitWindowAndBalance(
        GITHUB_REVIEW_TOKEN_LEDGER,
        user.id,
        windowStart,
        0,
        600,
        600,
      ),
      debitWindowAndBalance(
        GITHUB_REVIEW_TOKEN_LEDGER,
        user.id,
        windowStart,
        0,
        600,
        600,
      ),
    ]);

    expect(debits.filter((d) => d.ok)).toHaveLength(1);
    expect(await getGithubCreditBalance(user.id)).toBe(400);
    expect(await getGithubReviewTokensUsed(user.id, windowStart)).toBe(600);
  });
});
