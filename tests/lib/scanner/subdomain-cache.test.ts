/**
 * Tests for lib/scanner/subdomain-cache.ts: the read-only subdomain_cache
 * lookup used by the anonymous/shared scan view, which has no session or
 * API key to authenticate a discovery POST with and must only ever surface
 * an already-cached result.
 *
 * Mocks only the database pool (the boundary this module actually crosses).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { getCachedSubdomainSnapshot } = await import(
  "@/lib/scanner/subdomain-cache"
);

beforeEach(() => {
  mockQuery.mockReset();
});

describe("getCachedSubdomainSnapshot", () => {
  it("returns null when there is no cache row for the host", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getCachedSubdomainSnapshot("https://example.com");

    expect(result).toBeNull();
  });

  it("queries subdomain_cache keyed by the root domain, not the full host", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getCachedSubdomainSnapshot("https://shop.example.com/path");

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("FROM subdomain_cache");
    expect(sql).toContain("WHERE domain = $1");
    expect(params[0]).toBe("example.com");
    expect(params[1]).toBe(4); // SUBDOMAIN_CACHE_TTL_HOURS
  });

  it("accepts a bare hostname with no scheme", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getCachedSubdomainSnapshot("example.com");

    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBe("example.com");
  });

  it("lowercases the host before deriving the root domain", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getCachedSubdomainSnapshot("https://Example.COM");

    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBe("example.com");
  });

  it("returns null instead of querying when the input isn't a parseable host", async () => {
    const result = await getCachedSubdomainSnapshot("https://");

    expect(result).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("shapes a hit into a snapshot with computed total/reachable counts", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          subdomains: [
            {
              subdomain: "api.example.com",
              url: "https://api.example.com",
              reachable: true,
              statusCode: 200,
              sources: ["crt.sh"],
            },
            {
              subdomain: "old.example.com",
              url: "https://old.example.com",
              reachable: false,
              sources: ["brute-force"],
            },
          ],
          cached_at: "2026-08-08T00:00:00.000Z",
          expires_at: "2026-08-08T04:00:00.000Z",
        },
      ],
    });

    const result = await getCachedSubdomainSnapshot("https://example.com");

    expect(result).toEqual({
      domain: "example.com",
      total: 2,
      reachable: 1,
      cached: true,
      cachedAt: "2026-08-08T00:00:00.000Z",
      expiresAt: "2026-08-08T04:00:00.000Z",
      subdomains: [
        {
          subdomain: "api.example.com",
          url: "https://api.example.com",
          reachable: true,
          statusCode: 200,
          sources: ["crt.sh"],
        },
        {
          subdomain: "old.example.com",
          url: "https://old.example.com",
          reachable: false,
          sources: ["brute-force"],
        },
      ],
    });
  });

  it("returns null when the cache row has no subdomains payload", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ subdomains: null }] });

    const result = await getCachedSubdomainSnapshot("https://example.com");

    expect(result).toBeNull();
  });

  it("swallows a query failure and returns null instead of throwing", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));

    await expect(
      getCachedSubdomainSnapshot("https://example.com"),
    ).resolves.toBeNull();
  });
});
