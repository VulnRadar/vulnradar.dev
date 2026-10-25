import { it, expect } from "vitest";
import pool from "@/lib/database/db";
import { getAiUsageReport } from "@/lib/admin/ai-usage-report";
import { resolveCurrentWindow } from "@/lib/billing/ai-usage";
import { describeIntegration, createUser } from "./_db";

/**
 * The billing overview's AI usage section, against real ai_usage rows.
 *
 * The per-window totals are a GROUP BY over a SUM that node-postgres hands
 * back as a string, and the leaderboard is a join and an ORDER BY, so a
 * mocked pool cannot say whether either is right.
 */
async function spend(userId: number, windowStart: Date, tokens: number) {
  await pool.query(
    `INSERT INTO ai_usage (user_id, window_start, tokens_used)
     VALUES ($1, $2, $3)`,
    [userId, windowStart, tokens],
  );
}

describeIntegration("the AI usage report", () => {
  it("totals each window across accounts and ranks the current window's spenders", async () => {
    const { windowStart, windowHours } = await resolveCurrentWindow();
    const previous = new Date(
      windowStart.getTime() - windowHours * 60 * 60 * 1000,
    );
    const heavy = await createUser();
    const light = await createUser();

    // Other suites may have written rows too, so the report is read before
    // and after and the assertions are on what these rows add.
    const before = await getAiUsageReport();
    const baseline = (start: Date) =>
      before.windows.find((w) => w.windowStart === start.toISOString()) ?? {
        tokensUsed: 0,
        users: 0,
      };

    await spend(heavy.id, windowStart, 9_000_000);
    await spend(light.id, windowStart, 40);
    await spend(heavy.id, previous, 500);

    const after = await getAiUsageReport();
    const current = after.windows.find(
      (w) => w.windowStart === windowStart.toISOString(),
    );
    const earlier = after.windows.find(
      (w) => w.windowStart === previous.toISOString(),
    );

    // Newest first, and the sum is a number, not the string pg returns.
    expect(after.windows[0].windowStart).toBe(windowStart.toISOString());
    expect(current?.tokensUsed).toBe(
      baseline(windowStart).tokensUsed + 9_000_040,
    );
    expect(current?.users).toBe(baseline(windowStart).users + 2);
    expect(earlier?.tokensUsed).toBe(baseline(previous).tokensUsed + 500);

    // The 9M account outranks everyone else's rows in this window.
    expect(after.topUsers[0]).toMatchObject({
      id: heavy.id,
      tokensUsed: 9_000_000,
    });
    expect(after.topUsers.length).toBeLessThanOrEqual(10);

    await pool.query("DELETE FROM ai_usage WHERE user_id = ANY($1::int[])", [
      [heavy.id, light.id],
    ]);
  });
});
