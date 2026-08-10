/**
 * Tests for lib/scanner/scan-privacy.ts's resolveScanIsPublic -- the shared
 * "is this new scan public?" decision used by app/api/v3/scan/route.ts,
 * app/api/v3/scan/crawl/route.ts, and lib/scanner/scheduled-scans-worker.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { resolveScanIsPublic } = await import("@/lib/scanner/scan-privacy");

beforeEach(() => {
  mockQuery.mockReset();
});

describe("resolveScanIsPublic", () => {
  it("returns the explicit request value without touching the database, when isPublic is true", async () => {
    const result = await resolveScanIsPublic(42, true);
    expect(result).toBe(true);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns the explicit request value without touching the database, when isPublic is false", async () => {
    const result = await resolveScanIsPublic(42, false);
    expect(result).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("falls back to the account default (public) when the request says nothing and the account hasn't opted into private-by-default", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });

    const result = await resolveScanIsPublic(42, undefined);

    expect(result).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      "SELECT scans_private_by_default FROM users WHERE id = $1",
      [42],
    );
  });

  it("falls back to the account default (private) when the request says nothing and the account opted into private-by-default", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: true }],
    });

    const result = await resolveScanIsPublic(42, undefined);

    expect(result).toBe(false);
  });

  it("treats a missing user row as no preference set (public)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await resolveScanIsPublic(42, undefined);

    expect(result).toBe(true);
  });

  it("fails closed to private when the lookup itself throws", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("connection terminated"));

    const result = await resolveScanIsPublic(42, undefined);

    expect(result).toBe(false);
    consoleErrorSpy.mockRestore();
  });
});
