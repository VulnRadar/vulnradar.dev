import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Phase 8C Commit 1 (C-4): tests for the rate-limit window logic.
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
    // Query 1: cleanup DELETE (no return shape used)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Query 2: SELECT current count for this key
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Query 3: DELETE any stale row for this key
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Query 4: INSERT fresh row
    mockQuery.mockResolvedValueOnce({ rows: [] });

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
    const windowStart = new Date(Date.now() - 5000);
    // Query 1: cleanup DELETE
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Query 2: SELECT current count
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, count: 3, window_start: windowStart.toISOString() }],
    });

    const result = await checkRateLimit({
      key: "test:2",
      maxAttempts: 3,
      windowSeconds: 60,
    });

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    // 60s window - 5s elapsed = ~55s remaining
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(55);
  });

  it("increments and allows when count < maxAttempts", async () => {
    // Query 1: cleanup DELETE
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Query 2: SELECT current count
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 7, count: 1, window_start: new Date().toISOString() }],
    });
    // Query 3: UPDATE increment
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await checkRateLimit({
      key: "test:3",
      maxAttempts: 3,
      windowSeconds: 60,
    });

    expect(result.allowed).toBe(true);
    // count=1 was the current; the function returns maxAttempts - count - 1
    // because the in-flight UPDATE will bring it to count+1.
    expect(result.remaining).toBe(1);
  });

  it("never allows more than maxAttempts even with a stale row", async () => {
    // Query 1: cleanup DELETE
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Query 2: SELECT current count (huge)
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, count: 999, window_start: new Date().toISOString() }],
    });

    const result = await checkRateLimit({
      key: "test:4",
      maxAttempts: 5,
      windowSeconds: 60,
    });

    expect(result.allowed).toBe(false);
  });
});
