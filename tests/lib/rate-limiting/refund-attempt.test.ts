/**
 * refundRateLimitAttempt is called on a success path, so it must never turn
 * that success into an error. What the statement updates is proved against a
 * real table in tests/integration/rate-limit-refund.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { refundRateLimitAttempt } =
  await import("@/lib/rate-limiting/refund-attempt");

beforeEach(() => {
  mockQuery.mockReset();
});

describe("refundRateLimitAttempt", () => {
  it("decrements the newest bucket that had started by the reservation, never below zero", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const reservedBefore = new Date("2026-11-11T10:14:59.900Z");
    await refundRateLimitAttempt("admin-reauth:2:127.0.0.1", reservedBefore);
    const [sql, params] = mockQuery.mock.calls[0];
    const text = String(sql).replace(/\s+/g, " ");
    expect(text).toContain('SET "count" = "count" - 1');
    expect(text).toContain('"count" > 0');
    // Bounded by the reservation time, so a bucket opened after it (the next
    // window, holding later guesses) is never the one decremented.
    expect(text).toContain(
      "window_start = ( SELECT MAX(window_start) FROM rate_limits WHERE key = $1 AND window_start <= $2 )",
    );
    expect(params).toEqual(["admin-reauth:2:127.0.0.1", reservedBefore]);
  });

  it("swallows a database error and reports it", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("connection reset"));
    await expect(
      refundRateLimitAttempt("k", new Date()),
    ).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
