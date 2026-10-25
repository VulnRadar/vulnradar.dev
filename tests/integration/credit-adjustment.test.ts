import { it, expect } from "vitest";
import pool from "@/lib/database/db";
import { applyCreditAdjustment } from "@/lib/billing/admin-credit-grant";
import { describeIntegration, createUser } from "./_db";

/**
 * Removing credit, against a real users row.
 *
 * The correction for a wrong grant has two promises that only Postgres can
 * keep: the balance never goes negative, and the "before" it reports is the
 * balance the statement actually subtracted from, even when a spend lands at
 * the same time. A mocked pool returns whatever it was told to.
 */
async function balances(userId: number) {
  const { rows } = await pool.query<{
    ai: string;
    github: string;
    browser: string;
  }>(
    `SELECT ai_credit_balance AS ai, github_credit_balance AS github,
            browserbase_credit_seconds_balance AS browser
       FROM users WHERE id = $1`,
    [userId],
  );
  return {
    ai: Number(rows[0].ai),
    github: Number(rows[0].github),
    browser: Number(rows[0].browser),
  };
}

describeIntegration("admin credit adjustment", () => {
  it("takes the requested amount off and reports before and after", async () => {
    const user = await createUser({ aiCreditBalance: 2_000_000 });
    const result = await applyCreditAdjustment(user.id, "ai", 1_800_000);
    expect(result).toEqual({
      balanceBefore: 2_000_000,
      balanceAfter: 200_000,
      removed: 1_800_000,
    });
    expect((await balances(user.id)).ai).toBe(200_000);
  });

  it("never takes a balance below zero", async () => {
    const user = await createUser({ aiCreditBalance: 500 });
    const result = await applyCreditAdjustment(user.id, "ai", 9_000_000);
    expect(result).toEqual({
      balanceBefore: 500,
      balanceAfter: 0,
      removed: 500,
    });
    expect((await balances(user.id)).ai).toBe(0);
    // And a second removal on the empty balance removes nothing.
    expect(await applyCreditAdjustment(user.id, "ai", 10)).toMatchObject({
      balanceAfter: 0,
      removed: 0,
    });
  });

  it("touches only the column for the credit type asked for", async () => {
    const user = await createUser({
      aiCreditBalance: 100,
      browserbaseCreditSeconds: 7200,
    });
    await pool.query(
      "UPDATE users SET github_credit_balance = 300 WHERE id = $1",
      [user.id],
    );

    const result = await applyCreditAdjustment(user.id, "browser", 60);
    // Minutes in, seconds in the column.
    expect(result).toEqual({
      balanceBefore: 7200,
      balanceAfter: 3600,
      removed: 3600,
      balanceMinutes: 60,
    });
    expect(await balances(user.id)).toEqual({
      ai: 100,
      github: 300,
      browser: 3600,
    });
  });

  it("returns null for a user that does not exist", async () => {
    expect(await applyCreditAdjustment(2_147_000_000, "ai", 1)).toBeNull();
  });

  it("stays consistent when removals race: nothing is removed twice, nothing goes negative", async () => {
    const user = await createUser({ aiCreditBalance: 1000 });
    // Ten removals of 300 against 1000: only 1000 can come off in total.
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        applyCreditAdjustment(user.id, "ai", 300),
      ),
    );
    const removed = results.reduce((sum, r) => sum + (r?.removed ?? 0), 0);
    expect(removed).toBe(1000);
    expect((await balances(user.id)).ai).toBe(0);
    // Each statement subtracted from the balance the previous one left, so the
    // balances they saw are exactly the steps down from 1000, with no two
    // statements ever seeing the same one. That is the row lock in the
    // sub-select; without it two of them would both report 1000.
    const effective = results
      .filter((r) => (r?.removed ?? 0) > 0)
      .map((r) => r!.balanceBefore)
      .sort((a, b) => b - a);
    expect(effective).toEqual([1000, 700, 400, 100]);
  });
});
