/**
 * Tests for lib/scanner/host-reputation.ts: host normalization and the
 * host_reputation upsert used by every scan-completion path (single-URL,
 * crawl, bulk, authenticated).
 *
 * Mocks only the database pool (the boundary this module actually crosses).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { normalizeHostForReputation, upsertHostReputation } =
  await import("@/lib/scanner/host-reputation");

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("normalizeHostForReputation", () => {
  it("strips protocol, path, and port and lowercases", () => {
    expect(
      normalizeHostForReputation("https://Example.com:8443/path?q=1"),
    ).toBe("example.com");
  });

  it("strips a leading www. via the root-domain grouping", () => {
    expect(normalizeHostForReputation("https://www.example.com")).toBe(
      "example.com",
    );
  });

  it("collapses a subdomain to its organizational root domain", () => {
    expect(normalizeHostForReputation("https://sandbox.example.com")).toBe(
      "example.com",
    );
  });

  it("accepts a bare hostname with no scheme", () => {
    expect(normalizeHostForReputation("example.com")).toBe("example.com");
  });

  it("handles multi-label TLDs", () => {
    expect(normalizeHostForReputation("https://shop.example.co.uk")).toBe(
      "example.co.uk",
    );
  });

  it("returns null for a raw IPv4 literal", () => {
    expect(normalizeHostForReputation("http://192.168.1.1/admin")).toBeNull();
  });

  it("returns null for a raw IPv6 literal", () => {
    expect(normalizeHostForReputation("http://[::1]/")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(normalizeHostForReputation("")).toBeNull();
    expect(normalizeHostForReputation("   ")).toBeNull();
  });

  it("returns null when URL parsing throws (a scheme with no host)", () => {
    expect(normalizeHostForReputation("https://")).toBeNull();
  });
});

describe("upsertHostReputation", () => {
  it("upserts the normalized host with severity counts and a computed danger score", async () => {
    await upsertHostReputation({
      url: "https://www.example.com/some/path",
      findings: [{ severity: "critical", title: "SQL Injection" }],
      summary: { critical: 1, high: 0, medium: 0, low: 0, info: 2 },
      scanId: 55,
      scannedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("INSERT INTO host_reputation");
    expect(sql).toContain("ON CONFLICT (host) DO UPDATE");
    expect(params[0]).toBe("example.com");
    expect(typeof params[1]).toBe("number");
    expect(JSON.parse(params[2])).toEqual({
      critical: 1,
      high: 0,
      medium: 0,
      low: 0,
      info: 2,
    });
    expect(params[3]).toBe("2026-01-01T00:00:00.000Z");
    expect(params[4]).toBe(55);
  });

  it("defaults missing severity fields to 0", async () => {
    await upsertHostReputation({
      url: "https://example.com",
      findings: [],
      summary: {},
      scanId: null,
      scannedAt: "2026-01-01T00:00:00.000Z",
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(JSON.parse(params[2])).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    });
    expect(params[4]).toBeNull();
  });

  it("converts a Date scannedAt to an ISO string", async () => {
    await upsertHostReputation({
      url: "https://example.com",
      findings: [],
      summary: {},
      scanId: 1,
      scannedAt: new Date("2026-02-02T00:00:00.000Z"),
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(params[3]).toBe("2026-02-02T00:00:00.000Z");
  });

  it("skips the upsert entirely for a raw-IP target", async () => {
    await upsertHostReputation({
      url: "http://192.168.1.1/",
      findings: [],
      summary: {},
      scanId: 1,
      scannedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("swallows a query failure instead of throwing (fire-and-forget safe)", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));

    await expect(
      upsertHostReputation({
        url: "https://example.com",
        findings: [],
        summary: {},
        scanId: 1,
        scannedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).resolves.toBeUndefined();
  });
});
