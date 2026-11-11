import { it, expect, beforeEach, afterAll } from "vitest";
import pool from "@/lib/database/db";
import {
  reserveAiTokens,
  settleAiTokens,
  getAiCreditBalance,
  getAiTokensUsed,
  resolveCurrentWindow,
  recordAiTokens,
  checkAiUsageQuota,
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

/**
 * ai_usage is keyed by (user_id, window_start, kind) and only 'verify' is
 * metered. Chat, scan summaries and auto-tags used to write into the same row
 * as verification, so a free feature used up the allowance bought or granted
 * for verifying findings. Whether the kinds really land in separate rows is a
 * question about the unique key Postgres enforces, so it is asked here.
 */
describeIntegration("ai_usage kinds: only verification is metered", () => {
  beforeEach(async () => {
    await setSettings({ BILLING_ENABLED: true });
  });

  afterAll(async () => {
    await clearSettings();
  });

  it("80000 chat tokens leave checkAiUsageQuota allowed with usedTokens 0", async () => {
    await setSettings({ BILLING_FREE_AI_TOKENS_PER_WINDOW: 50_000 });
    const user = await createUser();
    const { windowStart } = await resolveCurrentWindow();

    await recordAiTokens(user.id, 80_000, windowStart, false, "chat");

    const quota = await checkAiUsageQuota(user.id);
    expect(quota.allowed).toBe(true);
    expect(quota.usedTokens).toBe(0);

    // The row is kept for the admin spend report, under its own kind.
    const rows = await pool.query<{ kind: string; tokens_used: number }>(
      "SELECT kind, tokens_used FROM ai_usage WHERE user_id = $1 AND window_start = $2",
      [user.id, windowStart],
    );
    expect(rows.rows).toEqual([{ kind: "chat", tokens_used: 80_000 }]);
  });

  it("400k chat tokens with a 1000 credit balance spend nothing", async () => {
    await setSettings({ BILLING_FREE_AI_TOKENS_PER_WINDOW: 0 });
    const user = await createUser({ aiCreditBalance: 1000 });
    const { windowStart } = await resolveCurrentWindow();

    await recordAiTokens(user.id, 400_000, windowStart, false, "chat");
    // Even a caller that asks to charge cannot charge a free kind.
    await recordAiTokens(user.id, 400_000, windowStart, true, "chat");

    expect(await getAiCreditBalance(user.id)).toBe(1000);
    expect(await getAiTokensUsed(user.id, windowStart)).toBe(0);
  });

  it("chat, summary and tag rows sit beside the verification row without merging into it", async () => {
    await setSettings({ BILLING_FREE_AI_TOKENS_PER_WINDOW: 20_000 });
    const user = await createUser({ aiCreditBalance: 1000 });
    const { windowStart } = await resolveCurrentWindow();

    await recordAiTokens(user.id, 15_000, windowStart, false, "chat");
    await recordAiTokens(user.id, 15_000, windowStart, false, "summary");
    await recordAiTokens(user.id, 15_000, windowStart, false, "tag");
    // Fits the 20000 allowance whole once the free kinds are not counted.
    await recordAiTokens(user.id, 10_000, windowStart, true, "verify");

    expect(await getAiTokensUsed(user.id, windowStart)).toBe(10_000);
    expect(await getAiCreditBalance(user.id)).toBe(1000);
    const kinds = await pool.query<{ kind: string }>(
      "SELECT kind FROM ai_usage WHERE user_id = $1 AND window_start = $2 ORDER BY kind",
      [user.id, windowStart],
    );
    expect(kinds.rows.map((r) => r.kind)).toEqual([
      "chat",
      "summary",
      "tag",
      "verify",
    ]);
  });

  it("a verification reservation is not shrunk by chat spent earlier in the window", async () => {
    await setSettings({ BILLING_FREE_AI_TOKENS_PER_WINDOW: 1000 });
    const user = await createUser();
    const { windowStart } = await resolveCurrentWindow();

    await recordAiTokens(user.id, 5000, windowStart, false, "chat");

    const gate = await reserveAiTokens(user.id, 1000);
    if (!gate.allowed) throw new Error(gate.message);
    expect(gate.reservation.windowPortion).toBe(1000);
    expect(gate.reservation.creditPortion).toBe(0);

    await settleAiTokens(gate.reservation, 400);
    expect(await getAiTokensUsed(user.id, windowStart)).toBe(400);
    const chat = await pool.query<{ tokens_used: number }>(
      "SELECT tokens_used FROM ai_usage WHERE user_id = $1 AND window_start = $2 AND kind = 'chat'",
      [user.id, windowStart],
    );
    expect(chat.rows[0]?.tokens_used).toBe(5000);
  });
});
