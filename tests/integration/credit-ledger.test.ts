import { it, expect, beforeAll, afterAll } from "vitest";
import pool from "@/lib/database/db";
import {
  creditAiCreditPurchase,
  reverseAiCreditPurchase,
  getAiCreditBalance,
  recordAiTokens,
  currentWindowStart,
} from "@/lib/billing/ai-usage";
import {
  creditBrowserbaseCreditPurchase,
  reverseBrowserbaseCreditPurchase,
} from "@/lib/billing/browserbase-usage";
import {
  describeIntegration,
  createUser,
  setSettings,
  clearSettings,
  unique,
} from "./_db";

/**
 * The credit ledgers, where "atomic" is a claim about SQL rather than about
 * JavaScript.
 *
 * Both crediting and reversal are written as one data-modifying CTE so a
 * crash cannot land the guard row without the balance change. The guard is
 * the ON CONFLICT DO NOTHING against a payment_intent_id primary key, and the
 * balance UPDATE only matches a row when the insert actually happened. That
 * whole argument lives in the statement text and nowhere else, so a mocked
 * pool asserts the string and proves nothing about it. Here two callers
 * really do reach the same PaymentIntent at once.
 */
describeIntegration("credit ledgers", () => {
  beforeAll(async () => {
    await setSettings({
      BILLING_ENABLED: true,
      BILLING_FREE_AI_TOKENS_PER_WINDOW: 100,
    });
  });

  afterAll(async () => {
    await clearSettings();
  });

  /**
   * The balance columns are BIGINT and node-postgres hands BIGINT back as a
   * STRING, so these getters used to resolve to `"12500"` while their
   * signatures promised `Promise<number>`. Nothing in the unit suite could
   * see it: with pool.query faked, the fake returns whatever number the test
   * wrote into it, so the string never appeared.
   *
   * It reached the UI. The value is serialised into GET /api/v3/billing and
   * components/profile/tabs/profile-billing-tab.tsx calls
   * `creditBalance.toLocaleString()` on it. On a String that is a no-op, so a
   * balance of 12500 rendered as "12500" rather than "12,500". The `> 0`
   * gates around it survived only through JavaScript's coercion, which is why
   * it went unnoticed.
   *
   * lib/billing now coerces at the data-access boundary. This test is what
   * holds that contract: if the Number() call is ever removed, or a new
   * balance getter is added without one, the typeof assertion fails here
   * rather than showing up as an unformatted number in someone's billing tab.
   */
  it("returns BIGINT balances as numbers, formattable by toLocaleString", async () => {
    const user = await createUser();
    await creditAiCreditPurchase(unique("pi"), user.id, 12500);
    const balance = await getAiCreditBalance(user.id);
    expect(typeof balance).toBe("number");
    expect(balance).toBe(12500);
    // The exact symptom that was wrong before: a real number groups digits.
    expect(balance.toLocaleString("en-US")).toBe("12,500");
  });

  /**
   * Kept as a helper after the BIGINT coercion landed: the Number() is now a
   * no-op, but every arithmetic assertion below reads through one place, so a
   * regression in the coercion shows up as a type failure in the test above
   * rather than as silent string concatenation down here.
   */
  const numericBalance = async (userId: number): Promise<number> =>
    Number(await getAiCreditBalance(userId));

  it("credits an AI purchase exactly once however many callers arrive", async () => {
    const user = await createUser();
    const intent = unique("pi");

    // The real redundancy: app/actions/stripe.ts's confirm path and the
    // Stripe webhook's payment_intent.succeeded handler can both reach this
    // for one payment. Six at once is the same race, louder.
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        creditAiCreditPurchase(intent, user.id, 500),
      ),
    );
    expect(results.filter((r) => r.credited).length).toBe(1);
    expect(await numericBalance(user.id)).toBe(500);

    const { rows } = await pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM ai_credit_purchases WHERE payment_intent_id = $1",
      [intent],
    );
    expect(rows[0].n).toBe(1);
  });

  it("never writes the guard row without also moving the balance", async () => {
    const user = await createUser();
    const intent = unique("pi");
    await creditAiCreditPurchase(intent, user.id, 250);

    // The failure this asserts against is a ledger row that exists while the
    // balance was never credited: both crediting paths would then see the
    // guard already claimed and skip, stranding the purchase permanently.
    const { rows } = await pool.query<{ tokens: string; balance: string }>(
      `SELECT p.tokens, u.ai_credit_balance AS balance
         FROM ai_credit_purchases p JOIN users u ON u.id = p.user_id
        WHERE p.payment_intent_id = $1`,
      [intent],
    );
    expect(Number(rows[0].tokens)).toBe(250);
    expect(Number(rows[0].balance)).toBe(250);
  });

  it("reverses a refunded AI purchase at most once", async () => {
    const user = await createUser();
    const intent = unique("pi");
    await creditAiCreditPurchase(intent, user.id, 400);

    const first = await reverseAiCreditPurchase(intent);
    expect(first).toMatchObject({
      reversed: true,
      userId: user.id,
      tokens: 400,
    });
    expect(await numericBalance(user.id)).toBe(0);

    // A redelivered refund event, or the dispute handler arriving after the
    // refund handler. The refunded_at NULL-guard has to make it a no-op.
    const second = await reverseAiCreditPurchase(intent);
    expect(second.reversed).toBe(false);
    expect(await numericBalance(user.id)).toBe(0);
  });

  it("claws back only what is left of a partly spent balance", async () => {
    const user = await createUser();
    const intent = unique("pi");
    await creditAiCreditPurchase(intent, user.id, 300);
    // The user spent most of it before the refund landed.
    await pool.query("UPDATE users SET ai_credit_balance = 50 WHERE id = $1", [
      user.id,
    ]);

    const result = await reverseAiCreditPurchase(intent);
    expect(result.reversed).toBe(true);
    // GREATEST(..., 0): 50 - 300 must floor at zero, not go negative. A
    // negative balance would read as "owes us tokens" everywhere it is shown.
    expect(await numericBalance(user.id)).toBe(0);
  });

  it("returns reversed:false for a payment intent this ledger never saw", async () => {
    // A subscription-invoice refund reaches the same webhook handler.
    expect(await reverseAiCreditPurchase(unique("pi"))).toEqual({
      reversed: false,
    });
  });

  it("runs the Browserbase ledger on the same guarantees", async () => {
    const user = await createUser();
    const intent = unique("pi");

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        creditBrowserbaseCreditPurchase(intent, user.id, 900),
      ),
    );
    expect(results.filter((r) => r.credited).length).toBe(1);

    // Raw SQL read, so this genuinely is a string: the coercion added for the
    // defect above lives in lib/billing, not in pg itself. Read as a number
    // here so the arithmetic below means what it looks like.
    const balance = async () => {
      const { rows } = await pool.query<{ b: string }>(
        "SELECT browserbase_credit_seconds_balance AS b FROM users WHERE id = $1",
        [user.id],
      );
      return Number(rows[0].b);
    };
    expect(await balance()).toBe(900);

    expect(await reverseBrowserbaseCreditPurchase(intent)).toMatchObject({
      reversed: true,
      seconds: 900,
    });
    expect(await balance()).toBe(0);
    expect((await reverseBrowserbaseCreditPurchase(intent)).reversed).toBe(
      false,
    );
  });

  it("spends the free window allowance before touching purchased credits", async () => {
    const user = await createUser({ aiCreditBalance: 1000 });
    const windowStart = currentWindowStart(new Date(), 5);

    // Cap is 100 tokens per window (set in beforeAll). 60 fits entirely in
    // the free allowance, so the purchased balance must not move.
    await recordAiTokens(user.id, 60, windowStart);
    expect(await numericBalance(user.id)).toBe(1000);

    // 60 more: 40 finishes the free allowance, 20 spills onto credits. The
    // split is computed from the UPSERT's own RETURNING value, which is the
    // part that cannot be tested without executing the statement.
    await recordAiTokens(user.id, 60, windowStart);
    expect(await numericBalance(user.id)).toBe(980);

    const { rows } = await pool.query<{ tokens_used: number }>(
      "SELECT tokens_used FROM ai_usage WHERE user_id = $1 AND window_start = $2",
      [user.id, windowStart],
    );
    expect(rows[0].tokens_used).toBe(120);
  });

  it("cannot double-spend the same slice of credits from concurrent calls", async () => {
    const user = await createUser({ aiCreditBalance: 1000 });
    const windowStart = currentWindowStart(new Date(), 5);

    // Ten calls of 50 tokens against a 100-token free allowance: 100 free,
    // 400 on credits, whatever order they interleave in. If the pre/post
    // split were read separately from the increment, several calls would each
    // believe they were the first past the ceiling and undercharge.
    await Promise.all(
      Array.from({ length: 10 }, () =>
        recordAiTokens(user.id, 50, windowStart),
      ),
    );

    const { rows } = await pool.query<{ tokens_used: number }>(
      "SELECT tokens_used FROM ai_usage WHERE user_id = $1 AND window_start = $2",
      [user.id, windowStart],
    );
    expect(rows[0].tokens_used).toBe(500);
    expect(await numericBalance(user.id)).toBe(600);
  });
});
