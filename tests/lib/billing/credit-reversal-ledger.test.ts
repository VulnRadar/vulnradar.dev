import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * lib/billing/credit-reversal-ledger.ts against a faked pool. What the SQL
 * itself does (the floor, the ON CONFLICT refusal, the restore claim) is
 * proven against Postgres in tests/integration/stripe-events.test.ts; this
 * covers the decisions made in TypeScript around it.
 */
const mockQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockRelease = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: async () => ({
      query: (...args: unknown[]) => mockClientQuery(...args),
      release: () => mockRelease(),
    }),
  },
}));

const {
  creditPurchaseFromMetadata,
  recordReversedCreditPurchase,
  reverseCreditsForDispute,
  restorableToMetadata,
  restorableFromMetadata,
  restoreCreditsAfterDispute,
} = await import("@/lib/billing/credit-reversal-ledger");

beforeEach(() => {
  mockQuery.mockReset();
  mockClientQuery.mockReset();
  mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockRelease.mockReset();
});

describe("creditPurchaseFromMetadata", () => {
  it("reads each tier key in its ledger's unit", () => {
    expect(
      creditPurchaseFromMetadata({
        userId: "42",
        aiCreditTierId: "ai_credits_1m",
      }),
    ).toEqual({ kind: "ai", userId: 42, amount: 1_000_000 });
    expect(
      creditPurchaseFromMetadata({
        userId: "42",
        githubCreditTierId: "github_credits_3m",
      }),
    ).toEqual({ kind: "github", userId: 42, amount: 3_000_000 });
    expect(
      creditPurchaseFromMetadata({
        userId: "42",
        browserbaseCreditTierId: "browserbase_credits_30m",
      }),
    ).toEqual({ kind: "browserbase", userId: 42, amount: 1800 });
  });

  it("is null for a subscription invoice, an unknown tier or a missing buyer", () => {
    expect(creditPurchaseFromMetadata({})).toBeNull();
    expect(creditPurchaseFromMetadata(null)).toBeNull();
    expect(
      creditPurchaseFromMetadata({ userId: "42", aiCreditTierId: "nope" }),
    ).toBeNull();
    expect(
      creditPurchaseFromMetadata({ aiCreditTierId: "ai_credits_1m" }),
    ).toBeNull();
    expect(
      creditPurchaseFromMetadata({
        userId: "abc",
        aiCreditTierId: "ai_credits_1m",
      }),
    ).toBeNull();
  });
});

describe("recordReversedCreditPurchase", () => {
  it("inserts the purchase already reversed, and never over an existing row", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{}], rowCount: 1 });

    const recorded = await recordReversedCreditPurchase("pi_1", {
      kind: "browserbase",
      userId: 7,
      amount: 1800,
    });

    expect(recorded).toBe(true);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain(
      "INSERT INTO browserbase_credit_purchases (payment_intent_id, user_id, seconds, refunded_at)",
    );
    expect(sql).toContain("ON CONFLICT (payment_intent_id) DO NOTHING");
    expect(params).toEqual(["pi_1", 7, 1800]);
  });

  it("reports false when the purchase was already in the ledger", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(
      await recordReversedCreditPurchase("pi_1", {
        kind: "ai",
        userId: 7,
        amount: 1,
      }),
    ).toBe(false);
  });
});

describe("reverseCreditsForDispute", () => {
  function ledgerHas(table: string, amount: number, balance: number) {
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql.startsWith(`UPDATE ${table} SET refunded_at = NOW()`)) {
        return { rows: [{ user_id: 9, amount: String(amount) }], rowCount: 1 };
      }
      if (sql.includes("FOR UPDATE")) {
        return { rows: [{ balance: String(balance) }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
  }

  it("takes only what is left and records zero when the purchase was spent", async () => {
    ledgerHas("github_credit_purchases", 3_000_000, 0);
    const record = vi.fn().mockResolvedValue(undefined);

    const reversals = await reverseCreditsForDispute("pi_1", null, record);

    expect(reversals).toEqual([
      {
        kind: "github",
        userId: 9,
        amount: 3_000_000,
        restorable: 0,
        neverCredited: false,
      },
    ]);
    const debits = mockClientQuery.mock.calls.filter(([sql]) =>
      String(sql).startsWith("UPDATE users"),
    );
    expect(debits).toHaveLength(0);
    // Zero is still written down, so a later win knows there is nothing owed.
    expect(record).toHaveBeenCalledWith(reversals);
    expect(restorableToMetadata(reversals)).toEqual({
      vulnradar_reversal_recorded: "1",
      vulnradar_restorable_github: "0",
    });
  });

  it("records an empty reversal when a refund already reversed the purchase, so a win restores nothing", async () => {
    // Refunded first, disputed after. The ledger row is already reversed, so
    // nothing is taken and no tombstone is written over it. Leaving the
    // dispute with no record at all made a later win raise the "restore by
    // hand" alert for credit the customer already had the money back for.
    const record = vi.fn().mockResolvedValue(undefined);

    const reversals = await reverseCreditsForDispute(
      "pi_1",
      { kind: "ai", userId: 9, amount: 10 },
      record,
    );

    expect(reversals).toEqual([]);
    expect(record).toHaveBeenCalledWith([]);
    expect(restorableFromMetadata(restorableToMetadata([]))).toEqual({});
    expect(mockClientQuery.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("writes nothing to Stripe for a dispute that is not about a credit purchase", async () => {
    const record = vi.fn();

    expect(await reverseCreditsForDispute("pi_sub", null, record)).toEqual([]);
    expect(record).not.toHaveBeenCalled();
  });

  it("rolls back and releases the client when recording fails", async () => {
    ledgerHas("ai_credit_purchases", 100, 100);
    const record = vi.fn().mockRejectedValue(new Error("stripe down"));

    await expect(
      reverseCreditsForDispute("pi_1", null, record),
    ).rejects.toThrow("stripe down");

    const statements = mockClientQuery.mock.calls.map(([sql]) => String(sql));
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});

describe("restorable metadata", () => {
  it("round-trips through the dispute's metadata", () => {
    const metadata = restorableToMetadata([
      {
        kind: "ai",
        userId: 1,
        amount: 10,
        restorable: 4,
        neverCredited: false,
      },
      {
        kind: "browserbase",
        userId: 1,
        amount: 60,
        restorable: 60,
        neverCredited: true,
      },
    ]);
    expect(restorableFromMetadata(metadata)).toEqual({
      ai: 4,
      browserbase: 60,
    });
  });

  it("reads a record with no amounts as nothing to restore, not as no record", () => {
    expect(
      restorableFromMetadata({ vulnradar_reversal_recorded: "1" }),
    ).toEqual({});
  });

  it("is null for a dispute with no record, and ignores a value that is not a count", () => {
    expect(restorableFromMetadata({})).toBeNull();
    expect(restorableFromMetadata(null)).toBeNull();
    expect(
      restorableFromMetadata({ vulnradar_restorable_ai: "-5" }),
    ).toBeNull();
    expect(
      restorableFromMetadata({ vulnradar_restorable_ai: "1e400" }),
    ).toBeNull();
  });
});

describe("restoreCreditsAfterDispute", () => {
  it("restores each recorded ledger and reports only the ones that were still reversed", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 3 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const restored = await restoreCreditsAfterDispute("pi_1", {
      ai: 5,
      github: 0,
    });

    expect(restored).toEqual([{ kind: "ai", userId: 3, amount: 5 }]);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[0][1]).toEqual(["pi_1", 5]);
    expect(String(mockQuery.mock.calls[1][0])).toContain(
      "UPDATE github_credit_purchases SET refunded_at = NULL",
    );
  });
});
