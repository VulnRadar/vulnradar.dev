import { describe, it, expect, beforeEach, vi } from "vitest";

/**
tests for the rate-limit window logic.
 *
 * The rate-limit module is the only one we test that touches the
 * database. We mock the pg pool so the test is hermetic and fast.
 */

// Mock pg pool BEFORE importing the module under test.
const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

// Mock getClientIp so the deprecated getClientIP re-export works.
vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
}));

const { checkRateLimit } = await import("@/lib/rate-limiting/rate-limit");

beforeEach(() => {
  mockQuery.mockReset();
});

describe("checkRateLimit", () => {
  it("allows the first attempt in a window and inserts a fresh row", async () => {
    // Query 1: cleanup DELETE for this key
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Query 2: atomic INSERT/UPSERT with RETURNING count (first insert)
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "1" }] });

    const result = await checkRateLimit({
      key: "test:1",
      maxAttempts: 3,
      windowSeconds: 60,
    });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
    expect(result.retryAfterSeconds).toBe(0);
  });

  it("denies when count >= maxAttempts and reports retryAfter", async () => {
    // Query 1: cleanup DELETE
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Query 2: atomic UPSERT returns count=4 (was 3, +1 for this attempt)
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "4" }] });
    // Query 3: rollback UPDATE pins the counter back at the cap
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await checkRateLimit({
      key: "test:2",
      maxAttempts: 3,
      windowSeconds: 60,
    });

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("increments and allows when count < maxAttempts", async () => {
    // Query 1: cleanup DELETE
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Query 2: atomic UPSERT returns count=2 (was 1, +1)
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "2" }] });

    const result = await checkRateLimit({
      key: "test:3",
      maxAttempts: 3,
      windowSeconds: 60,
    });

    expect(result.allowed).toBe(true);
    // count=2 post-increment; remaining = maxAttempts - count = 1
    expect(result.remaining).toBe(1);
  });

  it("never allows more than maxAttempts even with a stale row", async () => {
    // Query 1: cleanup DELETE
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Query 2: atomic UPSERT returns count=1000 (was 999, +1)
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "1000" }] });
    // Query 3: rollback UPDATE
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await checkRateLimit({
      key: "test:4",
      maxAttempts: 5,
      windowSeconds: 60,
    });

    expect(result.allowed).toBe(false);
  });
});
