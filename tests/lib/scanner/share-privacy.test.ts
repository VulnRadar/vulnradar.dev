/**
 * Tests for lib/scanner/share-privacy.ts's resolveSharePubliclyListed -- the
 * "should this new share be listed in /public-scans?" decision used by
 * app/api/v3/history/[id]/share/route.ts's POST handler. Deliberately
 * separate from resolveScanIsPublic (lib/scanner/scan-privacy.ts), which
 * gates a different, unrelated flag (scan_history.is_public).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { resolveSharePubliclyListed } =
  await import("@/lib/scanner/share-privacy");

beforeEach(() => {
  mockQuery.mockReset();
});

describe("resolveSharePubliclyListed", () => {
  it("returns the explicit request value without touching the database, when publiclyListed is true", async () => {
    const result = await resolveSharePubliclyListed(42, true);
    expect(result).toBe(true);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns the explicit request value without touching the database, when publiclyListed is false", async () => {
    const result = await resolveSharePubliclyListed(42, false);
    expect(result).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("falls back to the account default (listed) when the request says nothing and the account hasn't opted out", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ share_publicly_listed_by_default: true }],
    });

    const result = await resolveSharePubliclyListed(42, undefined);

    expect(result).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      "SELECT share_publicly_listed_by_default FROM users WHERE id = $1",
      [42],
    );
  });

  it("falls back to the account default (not listed) when the request says nothing and the account opted out", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ share_publicly_listed_by_default: false }],
    });

    const result = await resolveSharePubliclyListed(42, undefined);

    expect(result).toBe(false);
  });

  it("treats a missing user row as no preference set (listed -- matches the column's own true default)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await resolveSharePubliclyListed(42, undefined);

    expect(result).toBe(true);
  });

  it("fails closed to NOT listed when the lookup itself throws -- the opposite direction from resolveScanIsPublic", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("connection terminated"));

    const result = await resolveSharePubliclyListed(42, undefined);

    expect(result).toBe(false);
    consoleErrorSpy.mockRestore();
  });
});
