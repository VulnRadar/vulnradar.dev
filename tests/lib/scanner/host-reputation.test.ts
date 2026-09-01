/**
 * Tests for lib/scanner/host-reputation.ts: host normalization and the
 * host_reputation upsert used by every scan-completion path (single-URL,
 * crawl, bulk, authenticated).
 *
 * Mocks only the database pool (the boundary this module actually crosses).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Vulnerability } from "@/lib/scanner/types";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const {
  normalizeHostForReputation,
  upsertHostReputation,
  getExactUrlReputation,
} = await import("@/lib/scanner/host-reputation");

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

  it("strips a leading www.", () => {
    expect(normalizeHostForReputation("https://www.example.com")).toBe(
      "example.com",
    );
  });

  it("keeps a subdomain distinct from its organizational root domain -- reputation is per-host, not per-organization", () => {
    expect(normalizeHostForReputation("https://sandbox.example.com")).toBe(
      "sandbox.example.com",
    );
    expect(normalizeHostForReputation("https://panel.vulnradar.dev")).toBe(
      "panel.vulnradar.dev",
    );
    expect(normalizeHostForReputation("https://vulnradar.dev")).toBe(
      "vulnradar.dev",
    );
  });

  it("accepts a bare hostname with no scheme", () => {
    expect(normalizeHostForReputation("example.com")).toBe("example.com");
  });

  it("ignores the path -- reputation is host-level, so a scheme-less host with a trailing path still keys to the bare host", () => {
    expect(normalizeHostForReputation("shop.example.co.uk/checkout")).toBe(
      "shop.example.co.uk",
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
      findings: [
        { severity: "critical", title: "SQL Injection" } as Vulnerability,
      ],
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

  it("computes and stores auto tags (lib/tags/auto-tags.ts) from the same findings, as the last INSERT column", async () => {
    await upsertHostReputation({
      url: "https://example.com",
      findings: [
        {
          severity: "critical",
          title: "SQL Injection",
          cwe: "CWE-89",
        } as Vulnerability,
      ],
      summary: { critical: 1, high: 0, medium: 0, low: 0, info: 0 },
      scanId: 1,
      scannedAt: "2026-01-01T00:00:00.000Z",
    });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("auto_tags");
    expect(sql).toContain("auto_tags = EXCLUDED.auto_tags");
    const autoTags = JSON.parse(params[params.length - 1]);
    expect(autoTags).toContain("Critical Exposure");
    expect(autoTags).toContain("SQL Injection Risk");
  });

  it("stores the 'Clean' auto tag for a findings-free scan", async () => {
    await upsertHostReputation({
      url: "https://example.com",
      findings: [],
      summary: {},
      scanId: 1,
      scannedAt: "2026-01-01T00:00:00.000Z",
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(JSON.parse(params[params.length - 1])).toEqual(["Clean"]);
  });
});

// AUDIT-013#cov-18: getExactUrlReputation was the whole uncovered half of this
// module. It is the first thing GET /api/v3/scan/reputation tries, and it is
// the path that decides whether a private scan can leak through a public
// lookup, so "no test would fail" was not an acceptable state for it.
describe("getExactUrlReputation", () => {
  const scannedAt = new Date("2026-01-01T00:00:00.000Z");

  function rowFor(overrides: Record<string, unknown> = {}) {
    return {
      id: 42,
      url: "https://example.com/",
      findings: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      scanned_at: scannedAt,
      ...overrides,
    };
  }

  it("only ever reads public, completed scans", async () => {
    mockQuery.mockResolvedValue({ rows: [rowFor()], rowCount: 1 });

    await getExactUrlReputation("https://example.com/");

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("is_public = true");
    expect(sql).toContain("status = 'completed'");
  });

  it("returns the most recent matching scan as a reputation result", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        rowFor({
          summary: { critical: 1, high: 2, medium: 0, low: 3, info: 0 },
        }),
      ],
      rowCount: 1,
    });

    const result = await getExactUrlReputation("https://example.com/");

    expect(result).toMatchObject({
      url: "https://example.com/",
      scanId: 42,
      lastScannedAt: "2026-01-01T00:00:00.000Z",
      severityCounts: { critical: 1, high: 2, medium: 0, low: 3, info: 0 },
    });
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("ORDER BY scanned_at DESC");
  });

  it("normalizes the lookup URL the same way a stored scan URL was normalized", async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    // No scheme: prepended. Fragment: dropped, since it never reaches the
    // server and so never reaches scan_history.url either.
    await getExactUrlReputation("  example.com/page#section  ");

    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBe("https://example.com/page");
  });

  it("returns null without querying for an unusable URL", async () => {
    expect(await getExactUrlReputation("   ")).toBeNull();
    expect(await getExactUrlReputation("http://")).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns null when no public scan of that exact URL exists", async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await getExactUrlReputation("https://example.com/")).toBeNull();
  });

  it("parses findings stored as a JSON string, not just as an array", async () => {
    // The column is jsonb, but a driver/serialization path can hand this back
    // as a string; a silently-empty findings array would produce a "safe"
    // verdict for a host with a critical finding.
    mockQuery.mockResolvedValue({
      rows: [
        rowFor({
          findings: JSON.stringify([
            {
              severity: "critical",
              title: "SQL Injection",
              cwe: "CWE-89",
            } as Vulnerability,
          ]),
          summary: { critical: 1, high: 0, medium: 0, low: 0, info: 0 },
        }),
      ],
      rowCount: 1,
    });

    const result = await getExactUrlReputation("https://example.com/");
    expect(result?.dangerScore).toBeGreaterThan(0);
    expect(result?.verdict).toBeDefined();
  });

  it("treats a non-array findings value as no findings rather than throwing", async () => {
    mockQuery.mockResolvedValue({
      rows: [rowFor({ findings: null, summary: null })],
      rowCount: 1,
    });

    const result = await getExactUrlReputation("https://example.com/");
    expect(result?.severityCounts).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    });
  });

  it("accepts scanned_at as a string as well as a Date", async () => {
    mockQuery.mockResolvedValue({
      rows: [rowFor({ scanned_at: "2026-01-01T00:00:00.000Z" })],
      rowCount: 1,
    });

    const result = await getExactUrlReputation("https://example.com/");
    expect(result?.lastScannedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("returns null instead of throwing when the query fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mockQuery.mockRejectedValue(new Error("db down"));
      expect(await getExactUrlReputation("https://example.com/")).toBeNull();
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
