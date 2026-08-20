/**
 * Tests for the software inventory + version-to-CVE correlation module
 * (lib/scanner/software-inventory.ts).
 *
 * Every external boundary is mocked at the network layer, never the DB:
 *   - global fetch  -> NVD's CPE-matched REST API.
 *   - queryOsv      -> OSV.dev lookups (mocked at the osv-lookup module).
 *   - runtime-config -> resolves the per-lookup timeout from the shipped
 *     registry default, so no real DB connection is attempted.
 *
 * The module-level correlation cache + fingerprint side channel are cleared
 * before each test via the exported test-only reset helper.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/config/runtime-config", async () => {
  const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");
  return {
    getSetting: vi.fn(
      async (key: keyof typeof SETTINGS_REGISTRY) =>
        SETTINGS_REGISTRY[key].default,
    ),
  };
});

const mockQueryOsv = vi.fn();
vi.mock("@/lib/scanner/osv-lookup", () => ({
  queryOsv: (...args: unknown[]) => mockQueryOsv(...args),
}));

import {
  fingerprintSoftware,
  correlateSoftwareCves,
  analyzeSoftwareInventory,
  recordSoftwareFingerprint,
  readSoftwareFingerprint,
  __resetSoftwareInventoryForTests,
  type SoftwareItem,
} from "@/lib/scanner/software-inventory";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** NVD "N CVEs for this exact version" response. */
function nvdVulnerable(
  cves: Array<{ id: string; score?: number }>,
  totalResults?: number,
): Response {
  return json({
    totalResults: totalResults ?? cves.length,
    vulnerabilities: cves.map((c) => ({
      cve: {
        id: c.id,
        metrics:
          c.score !== undefined
            ? { cvssMetricV31: [{ cvssData: { baseScore: c.score } }] }
            : {},
      },
    })),
  });
}

/** Install a fetch mock that dispatches NVD by URL. */
function stubFetch(nvd?: () => Response) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const u = String(input);
    if (u.includes("services.nvd.nist.gov")) {
      if (nvd) return nvd();
      throw new Error("network error");
    }
    throw new Error(`unexpected fetch: ${u}`);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function item(partial: Partial<SoftwareItem> & { name: string }): SoftwareItem {
  return {
    category: "server",
    source: "Server header",
    ...partial,
  };
}

beforeEach(() => {
  __resetSoftwareInventoryForTests();
  mockQueryOsv.mockReset();
  mockQueryOsv.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Fingerprint parsing (pure, no network) ──────────────────────────────────

describe("fingerprintSoftware", () => {
  it("reads a server product + version out of the Server header", () => {
    const h = new Headers({ Server: "nginx/1.18.0" });
    const items = fingerprintSoftware(h, "", "https://example.com");
    expect(items).toContainEqual({
      name: "nginx",
      version: "1.18.0",
      category: "server",
      source: "Server header",
    });
  });

  it("parses multiple products out of one Server header", () => {
    const h = new Headers({ Server: "Apache/2.4.41 (Ubuntu) OpenSSL/1.1.1f" });
    const items = fingerprintSoftware(h, "", "https://example.com");
    const byName = Object.fromEntries(items.map((i) => [i.name, i]));
    expect(byName["Apache HTTP Server"]).toMatchObject({ version: "2.4.41" });
    expect(byName["OpenSSL"]).toMatchObject({
      version: "1.1.1f",
      category: "runtime",
    });
  });

  it("reads a language + version out of X-Powered-By", () => {
    const h = new Headers({ "X-Powered-By": "PHP/8.1.2" });
    const items = fingerprintSoftware(h, "", "https://example.com");
    expect(items).toContainEqual({
      name: "PHP",
      version: "8.1.2",
      category: "language",
      source: "X-Powered-By header",
    });
  });

  it("lists a recognized but versionless X-Powered-By product (no version)", () => {
    const h = new Headers({ "X-Powered-By": "Express" });
    const items = fingerprintSoftware(h, "", "https://example.com");
    const express = items.find((i) => i.name === "Express");
    expect(express).toBeDefined();
    expect(express?.version).toBeUndefined();
    expect(express?.category).toBe("framework");
  });

  it("reads a CMS + version out of a generator meta tag", () => {
    const body = `<html><head><meta name="generator" content="WordPress 6.1" /></head></html>`;
    const items = fingerprintSoftware(
      new Headers(),
      body,
      "https://example.com",
    );
    expect(items).toContainEqual({
      name: "WordPress",
      version: "6.1",
      category: "cms",
      source: "meta generator",
    });
  });

  it("returns [] when nothing recognizable is present", () => {
    const h = new Headers({ Server: "cloud-proxy-internal" });
    const items = fingerprintSoftware(
      h,
      "<html></html>",
      "https://example.com",
    );
    expect(items).toEqual([]);
  });
});

// ── CVE correlation: NVD path ───────────────────────────────────────────────

describe("correlateSoftwareCves: NVD", () => {
  it("raises ONE aggregated finding for a version with known CVEs, listing the CVEs", async () => {
    const fetchMock = stubFetch(() =>
      nvdVulnerable([
        { id: "CVE-2021-23017", score: 9.4 },
        { id: "CVE-2019-9511", score: 7.5 },
      ]),
    );
    const result = await correlateSoftwareCves("https://example.com", [
      item({ name: "nginx", version: "1.18.0" }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
    expect(result!.findings).toHaveLength(1);
    const f = result!.findings[0];
    expect(f.severity).toBe("critical"); // max of the two CVE scores
    expect(f.category).toBe("supply-chain");
    expect(f.evidence).toContain("CVE-2021-23017");
    expect(f.evidence).toContain("CVE-2019-9511");
    expect(f.cveIds).toContain("CVE-2021-23017");
    // Inventory entry reflects the vulnerable verdict.
    const entry = result!.inventory.items.find((e) => e.name === "nginx");
    expect(entry?.cveStatus).toBe("vulnerable");
    expect(entry?.cve?.count).toBe(2);
    expect(result!.inventory.vulnerableCount).toBe(1);
  });

  it("keeps the finding id stable across two hosts-paths of the same host+software", async () => {
    stubFetch(() => nvdVulnerable([{ id: "CVE-2021-23017", score: 9.4 }]));
    const a = await correlateSoftwareCves("https://example.com/a", [
      item({ name: "nginx", version: "1.18.0" }),
    ]);
    __resetSoftwareInventoryForTests();
    stubFetch(() => nvdVulnerable([{ id: "CVE-2021-23017", score: 9.4 }]));
    const b = await correlateSoftwareCves("https://example.com/b", [
      item({ name: "nginx", version: "1.18.0" }),
    ]);
    expect(a!.findings[0].id).toBe(b!.findings[0].id);
  });

  it("marks a reached-but-empty result clean (no finding)", async () => {
    stubFetch(() => nvdVulnerable([], 0));
    const result = await correlateSoftwareCves("https://example.com", [
      item({ name: "nginx", version: "1.18.0" }),
    ]);
    expect(result!.findings).toEqual([]);
    const entry = result!.inventory.items.find((e) => e.name === "nginx");
    expect(entry?.cveStatus).toBe("clean");
  });

  it("treats an NVD error as unknown, NOT clean (unavailable != safe)", async () => {
    stubFetch(() => new Response("rate limited", { status: 503 }));
    const result = await correlateSoftwareCves("https://example.com", [
      item({ name: "nginx", version: "1.18.0" }),
    ]);
    expect(result!.findings).toEqual([]);
    const entry = result!.inventory.items.find((e) => e.name === "nginx");
    expect(entry?.cveStatus).toBe("unknown");
  });

  it("never throws even when the NVD call rejects at the network boundary", async () => {
    stubFetch(() => {
      throw new Error("boom");
    });
    await expect(
      correlateSoftwareCves("https://example.com", [
        item({ name: "nginx", version: "1.18.0" }),
      ]),
    ).resolves.not.toBeNull();
  });

  it("does not correlate a versionless item (listed only)", async () => {
    const fetchMock = stubFetch(() => nvdVulnerable([{ id: "CVE-x" }]));
    const result = await correlateSoftwareCves("https://example.com", [
      item({ name: "nginx" }),
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result!.inventory.items[0].cveStatus).toBeUndefined();
  });

  it("does not correlate client-side libraries (osv-check owns those)", async () => {
    const fetchMock = stubFetch(() => nvdVulnerable([{ id: "CVE-x" }]));
    const result = await correlateSoftwareCves("https://example.com", [
      item({
        name: "jQuery",
        version: "1.8.2",
        category: "library",
        source: "script src",
      }),
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockQueryOsv).not.toHaveBeenCalled();
    expect(result!.findings).toEqual([]);
  });
});

// ── CVE correlation: OSV path ───────────────────────────────────────────────

describe("correlateSoftwareCves: OSV", () => {
  it("uses OSV.dev for a packaged-ecosystem item and raises a finding", async () => {
    stubFetch();
    mockQueryOsv.mockResolvedValueOnce([
      {
        id: "GHSA-2mjm-x38v-jh2r",
        aliases: ["CVE-2023-25577"],
        summary: "Werkzeug DoS",
        severity: [
          {
            type: "CVSS_V3",
            score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H",
          },
        ],
      },
    ]);
    const result = await correlateSoftwareCves("https://example.com", [
      item({ name: "Werkzeug", version: "2.0.0", category: "framework" }),
    ]);
    expect(mockQueryOsv).toHaveBeenCalledWith("PyPI", "werkzeug", "2.0.0");
    expect(result!.findings).toHaveLength(1);
    expect(result!.findings[0].evidence).toContain("CVE-2023-25577");
    expect(result!.findings[0].detectionMethod).toContain("OSV.dev");
    expect(result!.inventory.items[0].cve?.source).toBe("OSV.dev");
  });

  it("marks an OSV item with no advisory clean", async () => {
    stubFetch();
    mockQueryOsv.mockResolvedValue([]);
    const result = await correlateSoftwareCves("https://example.com", [
      item({ name: "Werkzeug", version: "9.9.9", category: "framework" }),
    ]);
    expect(result!.findings).toEqual([]);
    expect(result!.inventory.items[0].cveStatus).toBe("clean");
  });
});

// ── Cache reuse ─────────────────────────────────────────────────────────────

describe("correlateSoftwareCves: cache", () => {
  it("caches per host+item: a second correlation makes no new network call", async () => {
    const fetchMock = stubFetch(() =>
      nvdVulnerable([{ id: "CVE-2021-23017", score: 9.4 }]),
    );
    await correlateSoftwareCves("https://example.com", [
      item({ name: "nginx", version: "1.18.0" }),
    ]);
    await correlateSoftwareCves("https://example.com", [
      item({ name: "nginx", version: "1.18.0" }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not share a cache entry across different versions of the same software", async () => {
    const fetchMock = stubFetch(() => nvdVulnerable([], 0));
    await correlateSoftwareCves("https://example.com", [
      item({ name: "nginx", version: "1.18.0" }),
    ]);
    await correlateSoftwareCves("https://example.com", [
      item({ name: "nginx", version: "1.20.0" }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ── External-lookup cap ─────────────────────────────────────────────────────

describe("correlateSoftwareCves: lookup cap", () => {
  it("caps external lookups per scan and lists the overflow as unknown, logging the cap", async () => {
    const fetchMock = stubFetch(() => nvdVulnerable([], 0)); // all clean
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Nine version-bearing, catalogued NVD items: eight fit the cap, the
    // ninth is listed as "unknown" without a lookup.
    const items: SoftwareItem[] = [
      item({ name: "nginx", version: "1.0.0" }),
      item({ name: "Apache HTTP Server", version: "2.4.0" }),
      item({ name: "Apache Tomcat", version: "9.0.0" }),
      item({ name: "OpenSSL", version: "1.1.1", category: "runtime" }),
      item({ name: "PHP", version: "8.0.0", category: "language" }),
      item({ name: "Microsoft IIS", version: "10.0" }),
      item({ name: "WordPress", version: "6.0", category: "cms" }),
      item({ name: "Drupal", version: "9.0", category: "cms" }),
      item({ name: "gunicorn", version: "20.0.0" }), // 9th (OSV) - over the cap
    ];
    const result = await correlateSoftwareCves("https://example.com", items);

    // Exactly eight external lookups (all NVD); the 9th never reached OSV.
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(mockQueryOsv).not.toHaveBeenCalled();
    const unknown = result!.inventory.items.filter(
      (e) => e.cveStatus === "unknown",
    );
    expect(unknown).toHaveLength(1);
    expect(unknown[0].name).toBe("gunicorn");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("lookup cap"),
    );
  });
});

// ── SSRF / raw-IP + private host guard ──────────────────────────────────────

describe("correlateSoftwareCves: host guard", () => {
  it("skips external lookups for a raw IP target but still lists the inventory", async () => {
    const fetchMock = stubFetch(() =>
      nvdVulnerable([{ id: "CVE-x", score: 9 }]),
    );
    const result = await correlateSoftwareCves("https://93.184.216.34/", [
      item({ name: "nginx", version: "1.18.0" }),
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result!.findings).toEqual([]);
    // Still surfaced in the inventory, just not CVE-correlated.
    expect(result!.inventory.items[0]).toMatchObject({
      name: "nginx",
      version: "1.18.0",
    });
    expect(result!.inventory.items[0].cveStatus).toBeUndefined();
  });

  it("skips external lookups for a private/internal hostname", async () => {
    const fetchMock = stubFetch(() =>
      nvdVulnerable([{ id: "CVE-x", score: 9 }]),
    );
    const result = await correlateSoftwareCves("http://localhost/", [
      item({ name: "nginx", version: "1.18.0" }),
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result!.findings).toEqual([]);
  });
});

// ── analyzeSoftwareInventory (fingerprint + correlate) ──────────────────────

describe("analyzeSoftwareInventory", () => {
  it("fingerprints from headers/body and correlates in one call", async () => {
    stubFetch(() => nvdVulnerable([{ id: "CVE-2021-23017", score: 9.4 }]));
    const headers = new Headers({ Server: "nginx/1.18.0" });
    const result = await analyzeSoftwareInventory(
      "https://example.com",
      headers,
      "",
    );
    expect(result!.findings).toHaveLength(1);
    const entry = result!.inventory.items.find((e) => e.name === "nginx");
    expect(entry?.cveStatus).toBe("vulnerable");
  });

  it("returns null when nothing is detected (clean host renders no panel)", async () => {
    const result = await analyzeSoftwareInventory(
      "https://example.com",
      new Headers(),
      "<html></html>",
    );
    expect(result).toBeNull();
  });
});

// ── Fingerprint side channel (crawl path) ───────────────────────────────────

describe("software fingerprint side channel", () => {
  it("merges fingerprints recorded across pages of the same host", () => {
    recordSoftwareFingerprint("example.com", [
      item({ name: "nginx", version: "1.18.0" }),
    ]);
    recordSoftwareFingerprint("example.com", [
      item({
        name: "PHP",
        version: "8.1.2",
        category: "language",
        source: "X-Powered-By header",
      }),
    ]);
    const merged = readSoftwareFingerprint("example.com");
    expect(merged?.map((i) => i.name).sort()).toEqual(["PHP", "nginx"]);
  });

  it("prefers a versioned entry over a versionless one for the same software", () => {
    recordSoftwareFingerprint("example.com", [
      item({ name: "WordPress", category: "cms", source: "wp-content markup" }),
    ]);
    recordSoftwareFingerprint("example.com", [
      item({
        name: "WordPress",
        version: "6.1",
        category: "cms",
        source: "meta generator",
      }),
    ]);
    const merged = readSoftwareFingerprint("example.com");
    expect(merged).toHaveLength(1);
    expect(merged![0].version).toBe("6.1");
  });

  it("returns undefined for a host with no recorded fingerprint", () => {
    expect(readSoftwareFingerprint("nothing.example.com")).toBeUndefined();
  });
});
