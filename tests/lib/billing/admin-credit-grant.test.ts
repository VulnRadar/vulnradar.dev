import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const {
  ADMIN_CREDIT_TYPES,
  validateGrantCreditsInput,
  validateAdjustCreditsInput,
  applyCreditGrant,
  applyCreditAdjustment,
  formatGrantAmount,
  formatCreditBalance,
} = await import("@/lib/billing/admin-credit-grant");

beforeEach(() => {
  mockQuery.mockReset();
});

type ValidationResult = ReturnType<typeof validateGrantCreditsInput>;

// TS assertion functions rather than a plain `expect(result.ok).toBe(...)`:
// GrantCreditsValidationResult's two members don't share `value`/`error` (an
// earlier draft made both optional on both sides, which quietly defeated
// this file's own narrowing -- see the type's own comment), so a bare
// property read after a truthy check doesn't compile. Asserting first lets
// every test below read `result.value` or `result.error` directly.
function assertOk(
  result: ValidationResult,
): asserts result is Extract<ValidationResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`expected a valid result, got error: ${result.error}`);
  }
}

function assertRejected(
  result: ValidationResult,
): asserts result is Extract<ValidationResult, { ok: false }> {
  if (result.ok) {
    throw new Error("expected a rejected result, got a valid one");
  }
}

describe("validateGrantCreditsInput", () => {
  const valid = { creditType: "ai", amount: 1000, reason: "test grant" };

  it("accepts a valid ai grant", () => {
    const result = validateGrantCreditsInput(valid);
    assertOk(result);
    expect(result.value).toEqual({
      creditType: "ai",
      amount: 1000,
      reason: "test grant",
    });
  });

  it("trims the reason", () => {
    const result = validateGrantCreditsInput({
      ...valid,
      reason: "  padded reason  ",
    });
    assertOk(result);
    expect(result.value.reason).toBe("padded reason");
  });

  it.each(["", "not_a_type", null, undefined, 123])(
    "rejects a bad creditType: %j",
    (creditType) => {
      const result = validateGrantCreditsInput({ ...valid, creditType });
      assertRejected(result);
      expect(result.error).toMatch(/creditType must be one of/);
    },
  );

  it("rejects a zero amount", () => {
    const result = validateGrantCreditsInput({ ...valid, amount: 0 });
    assertRejected(result);
    expect(result.error).toMatch(/positive whole number/);
  });

  it("rejects a negative amount", () => {
    const result = validateGrantCreditsInput({ ...valid, amount: -500 });
    assertRejected(result);
    expect(result.error).toMatch(/positive whole number/);
  });

  it("rejects a non-integer amount", () => {
    const result = validateGrantCreditsInput({ ...valid, amount: 100.5 });
    assertRejected(result);
    expect(result.error).toMatch(/positive whole number/);
  });

  it("rejects a non-numeric amount", () => {
    const result = validateGrantCreditsInput({ ...valid, amount: "abc" });
    assertRejected(result);
    expect(result.error).toMatch(/positive whole number/);
  });

  it("accepts a numeric string amount", () => {
    const result = validateGrantCreditsInput({ ...valid, amount: "1000" });
    assertOk(result);
    expect(result.value.amount).toBe(1000);
  });

  it("rejects an ai amount over the 20,000,000 token ceiling", () => {
    const result = validateGrantCreditsInput({
      ...valid,
      amount: 20_000_001,
    });
    assertRejected(result);
    expect(result.error).toMatch(/cannot exceed 20,000,000 tokens/);
  });

  it("accepts an ai amount at exactly the ceiling", () => {
    const result = validateGrantCreditsInput({
      ...valid,
      amount: 20_000_000,
    });
    assertOk(result);
  });

  it("rejects a github amount over the 20,000,000 token ceiling", () => {
    const result = validateGrantCreditsInput({
      creditType: "github",
      amount: 25_000_000,
      reason: "test",
    });
    assertRejected(result);
    expect(result.error).toMatch(/cannot exceed 20,000,000 tokens/);
  });

  it("rejects a browser amount over the 500 minute ceiling", () => {
    const result = validateGrantCreditsInput({
      creditType: "browser",
      amount: 501,
      reason: "test",
    });
    assertRejected(result);
    expect(result.error).toMatch(/cannot exceed 500 minutes/);
  });

  it("accepts a browser amount at exactly the 500 minute ceiling", () => {
    const result = validateGrantCreditsInput({
      creditType: "browser",
      amount: 500,
      reason: "test",
    });
    assertOk(result);
  });

  it("rejects a missing reason", () => {
    const result = validateGrantCreditsInput({ ...valid, reason: undefined });
    assertRejected(result);
    expect(result.error).toMatch(/reason is required/);
  });

  it("rejects a blank/whitespace-only reason", () => {
    const result = validateGrantCreditsInput({ ...valid, reason: "   " });
    assertRejected(result);
    expect(result.error).toMatch(/reason is required/);
  });

  it("rejects a reason over 200 characters", () => {
    const result = validateGrantCreditsInput({
      ...valid,
      reason: "x".repeat(201),
    });
    assertRejected(result);
    expect(result.error).toMatch(/cannot exceed 200 characters/);
  });

  it("accepts a reason at exactly 200 characters", () => {
    const result = validateGrantCreditsInput({
      ...valid,
      reason: "x".repeat(200),
    });
    assertOk(result);
  });
});

describe("applyCreditGrant", () => {
  it("credits the ai_credit_balance column and returns the new balance", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ai_credit_balance: "5000" }] });
    const result = await applyCreditGrant(7, "ai", 1000);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/ai_credit_balance = ai_credit_balance \+ \$2/);
    expect(sql).toMatch(/RETURNING ai_credit_balance/);
    expect(params).toEqual([7, 1000]);
    expect(result).toEqual({ balance: 5000 });
  });

  it("credits the github_credit_balance column and returns the new balance", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ github_credit_balance: 3000 }],
    });
    const result = await applyCreditGrant(7, "github", 1000);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/github_credit_balance = github_credit_balance \+ \$2/);
    expect(params).toEqual([7, 1000]);
    expect(result).toEqual({ balance: 3000 });
  });

  it("converts browser minutes to seconds for the column and returns both units", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ browserbase_credit_seconds_balance: "7200" }],
    });
    const result = await applyCreditGrant(7, "browser", 60);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(
      /browserbase_credit_seconds_balance = browserbase_credit_seconds_balance \+ \$2/,
    );
    // 60 minutes in -> 3600 seconds sent to the column.
    expect(params).toEqual([7, 3600]);
    // Column now holds 7200s total -> reported back as 120 minutes.
    expect(result).toEqual({ balance: 7200, balanceMinutes: 120 });
  });

  it("never builds the UPDATE by interpolating creditType into a string", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ai_credit_balance: "1" }] });
    await applyCreditGrant(7, "ai", 1);
    const [sql] = mockQuery.mock.calls[0];
    expect(typeof sql).toBe("string");
    // The literal, hand-written column name -- not `${creditType}_credit_balance`.
    expect(sql).toContain("ai_credit_balance = ai_credit_balance");
  });
});

describe("validateAdjustCreditsInput", () => {
  const valid = { creditType: "ai", amount: 1000, reason: "typo in the grant" };

  it("accepts the same shape a grant does", () => {
    const result = validateAdjustCreditsInput(valid);
    assertOk(result);
    expect(result.value).toEqual({
      creditType: "ai",
      amount: 1000,
      reason: "typo in the grant",
    });
  });

  it("requires a reason: it is the only record of why a balance moved", () => {
    assertRejected(validateAdjustCreditsInput({ ...valid, reason: " " }));
    assertRejected(validateAdjustCreditsInput({ ...valid, reason: undefined }));
  });

  it("rejects zero, negative and fractional amounts", () => {
    for (const amount of [0, -1, 2.5, "abc"]) {
      assertRejected(validateAdjustCreditsInput({ ...valid, amount }));
    }
  });

  it("names the adjustment, not a grant, when the ceiling is exceeded", () => {
    const result = validateAdjustCreditsInput({ ...valid, amount: 20_000_001 });
    assertRejected(result);
    expect(result.error).toBe(
      "amount cannot exceed 20,000,000 tokens per adjustment",
    );
  });

  it("leaves the grant's own message alone", () => {
    const result = validateGrantCreditsInput({ ...valid, amount: 20_000_001 });
    assertRejected(result);
    expect(result.error).toContain("per grant");
  });
});

describe("applyCreditAdjustment", () => {
  it("clamps at zero and reports before and after from one locked statement", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ balance_before: "5000", balance_after: "0" }],
    });
    const result = await applyCreditAdjustment(7, "ai", 9000);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("GREATEST(u.ai_credit_balance - $2, 0)");
    // The row is locked in the sub-select, so "before" is what was subtracted from.
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("RETURNING prev.balance_before");
    expect(params).toEqual([7, 9000]);
    expect(result).toEqual({
      balanceBefore: 5000,
      balanceAfter: 0,
      removed: 5000,
    });
  });

  it("uses the github column for github credit", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ balance_before: 100, balance_after: 40 }],
    });
    const result = await applyCreditAdjustment(7, "github", 60);
    expect(mockQuery.mock.calls[0][0]).toContain(
      "GREATEST(u.github_credit_balance - $2, 0)",
    );
    expect(result?.removed).toBe(60);
  });

  it("converts browser minutes to seconds and adds minutes to the result", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ balance_before: "7200", balance_after: "3600" }],
    });
    const result = await applyCreditAdjustment(7, "browser", 60);
    expect(mockQuery.mock.calls[0][0]).toContain(
      "GREATEST(u.browserbase_credit_seconds_balance - $2, 0)",
    );
    expect(mockQuery.mock.calls[0][1]).toEqual([7, 3600]);
    expect(result).toEqual({
      balanceBefore: 7200,
      balanceAfter: 3600,
      removed: 3600,
      balanceMinutes: 60,
    });
  });

  it("returns null for a user that does not exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await applyCreditAdjustment(404, "ai", 1)).toBeNull();
  });

  it("only ever splices a column from the closed map", async () => {
    // A value the type forbids, to prove the runtime path has no way through:
    // it is refused before any statement is built.
    await expect(
      applyCreditAdjustment(7, "ai; DROP TABLE users" as never, 1),
    ).rejects.toThrow("Unknown credit type");
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("formatCreditBalance", () => {
  it("shows tokens as tokens and browser seconds as whole minutes", () => {
    expect(formatCreditBalance("ai", 1_234_000)).toBe("1,234,000 tokens");
    expect(formatCreditBalance("browser", 7230)).toBe("120 minutes");
  });
});

describe("formatGrantAmount", () => {
  it("formats tokens with thousands separators", () => {
    expect(formatGrantAmount("ai", 1_000_000)).toBe("1,000,000 tokens");
  });

  it("formats minutes for the browser type", () => {
    expect(formatGrantAmount("browser", 60)).toBe("60 minutes");
  });
});

describe("ADMIN_CREDIT_TYPES", () => {
  it("caps ai and github at the largest purchasable tier (20,000,000 tokens)", () => {
    expect(ADMIN_CREDIT_TYPES.ai.maxPerGrant).toBe(20_000_000);
    expect(ADMIN_CREDIT_TYPES.github.maxPerGrant).toBe(20_000_000);
  });

  it("caps browser at the largest purchasable tier (500 minutes)", () => {
    expect(ADMIN_CREDIT_TYPES.browser.maxPerGrant).toBe(500);
  });
});
