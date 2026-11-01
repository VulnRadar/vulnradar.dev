import { it, expect, vi, beforeAll, afterAll } from "vitest";
import pool from "@/lib/database/db";
import { runDomainReverifyPass } from "@/lib/domains/reverify-worker";
import {
  describeIntegration,
  createUser,
  setSettings,
  clearSettings,
  unique,
} from "./_db";

/**
 * Domains whose DNS never answers must not starve the ones behind them.
 *
 * The worker takes a fixed-size batch of due domains each pass. Ordered by
 * last_checked_at alone, a domain whose nameserver times out keeps the oldest
 * value forever (that column only moves on an answer), so enough of them filled
 * every batch and the domains after them were never re-checked, which are the
 * ones that may have changed hands. The ordering is a SQL fact, so it is proved
 * against rows. DNS itself is the one thing faked.
 *
 * Every other suite that writes to `domains` deletes its rows when it
 * finishes, so this suite's three rows are the whole due set. A leftover
 * verified row would never have been checked and would sort ahead of them.
 */
const mockCheck = vi.fn();
vi.mock("@/lib/domains/verification", () => ({
  checkDnsVerification: (...args: unknown[]) => mockCheck(...args),
}));

describeIntegration("domain re-verification rotation", () => {
  const names = {
    deadOldest: `${unique("dead1")}.example.test`,
    deadNext: `${unique("dead2")}.example.test`,
    answers: `${unique("live")}.example.test`,
  };
  let userId: number;

  async function seed(domain: string, daysSinceChecked: number) {
    await pool.query(
      `INSERT INTO domains (user_id, domain, status, verification_token, last_checked_at)
       VALUES ($1, $2, 'verified', $3, NOW() - ($4 * INTERVAL '1 day'))`,
      [userId, domain, unique("tok"), daysSinceChecked],
    );
  }

  beforeAll(async () => {
    await setSettings({
      FEATURE_DOMAIN_VERIFICATION: true,
      DOMAIN_REVERIFY_ENABLED: true,
      DOMAIN_REVERIFY_INTERVAL_DAYS: 30,
      DOMAIN_REVERIFY_BATCH_SIZE: 2,
    });
    userId = (await createUser()).id;
    // The two that never answer are the oldest, so they sort first by
    // last_checked_at. The one that answers is the newest of the three.
    await seed(names.deadOldest, 90);
    await seed(names.deadNext, 80);
    await seed(names.answers, 70);

    mockCheck.mockImplementation(async (domain: string) =>
      domain === names.answers
        ? { outcome: "verified" }
        : {
            outcome: "lookup_error",
            error: "DNS lookup timed out",
            cause: new Error("DNS lookup timed out"),
          },
    );
  });

  afterAll(async () => {
    await pool.query("DELETE FROM domains WHERE user_id = $1", [userId]);
    await clearSettings();
  });

  it("reaches the domain behind the unanswerable ones on the second pass", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    const first = await runDomainReverifyPass();
    expect(first.checked).toBe(2);
    expect(first.failed).toBe(2);
    expect(mockCheck.mock.calls.map((c) => c[0])).toEqual([
      names.deadOldest,
      names.deadNext,
    ]);

    mockCheck.mockClear();
    const second = await runDomainReverifyPass();
    quiet.mockRestore();

    // The untried domain goes first, then the one tried longest ago. Without
    // last_attempt_at the batch would be the same two dead domains again.
    expect(mockCheck.mock.calls.map((c) => c[0])).toEqual([
      names.answers,
      names.deadOldest,
    ]);
    expect(second.stillVerified).toBe(1);
    expect(second.failed).toBe(1);

    const { rows } = await pool.query<{
      domain: string;
      checked_recently: boolean;
      attempted: boolean;
      status: string;
    }>(
      `SELECT domain,
              (last_checked_at > NOW() - INTERVAL '1 day') AS checked_recently,
              (last_attempt_at IS NOT NULL) AS attempted,
              status
         FROM domains WHERE user_id = $1`,
      [userId],
    );
    const byName = new Map(rows.map((r) => [r.domain, r]));
    // An answer moves both columns.
    expect(byName.get(names.answers)).toMatchObject({
      checked_recently: true,
      attempted: true,
      status: "verified",
    });
    // A lookup with no answer moves only the attempt: the domain stays due,
    // and keeps its permission, since silence is not a verdict.
    for (const dead of [names.deadOldest, names.deadNext]) {
      expect(byName.get(dead)).toMatchObject({
        checked_recently: false,
        attempted: true,
        status: "verified",
      });
    }
  });
});
