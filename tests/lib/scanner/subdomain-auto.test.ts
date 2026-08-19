/**
 * Tests for the automatic in-scan subdomain capture (lib/scanner/subdomain-auto.ts).
 *
 * autoDiscoverSubdomains runs the shared discovery engine best-effort during
 * a scan and leaves the result in a per-host side channel that executeScan /
 * executeCrawlScan read back. These tests mock the three boundaries it talks
 * to -- the read-only per-domain cache, the SSRF guard, and the discovery
 * engine itself -- and verify:
 *
 *   - best-effort: it NEVER throws, whatever the engine/cache does
 *   - a cache hit is recorded instantly without touching the engine (reuse)
 *   - a fresh (cache-miss) discovery is SSRF-guarded, then recorded
 *   - an empty discovery, a rejecting engine, a blocked target, and a raw-IP
 *     target all record nothing (panel stays absent, manual button remains)
 *   - a slow engine is bounded by the timeout, not awaited forever
 *   - the per-host side channel round-trips case-insensitively and peeks
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DiscoveryResult } from "@/lib/scanner/subdomain-types";

const mockValidateScanTarget = vi.fn();
vi.mock("@/lib/scanner/safe-fetch", () => ({
  validateScanTarget: (...args: unknown[]) => mockValidateScanTarget(...args),
}));

const mockGetCachedSnapshot = vi.fn();
vi.mock("@/lib/scanner/subdomain-cache", () => ({
  getCachedSubdomainSnapshot: (...args: unknown[]) =>
    mockGetCachedSnapshot(...args),
}));

const mockDiscover = vi.fn();
vi.mock("@/lib/scanner/subdomain-discovery-engine", () => ({
  discoverSubdomainsForRoot: (...args: unknown[]) => mockDiscover(...args),
}));

const {
  autoDiscoverSubdomains,
  recordSubdomains,
  readSubdomains,
} = await import("@/lib/scanner/subdomain-auto");

function makeResult(overrides: Partial<DiscoveryResult> = {}): DiscoveryResult {
  return {
    domain: "example.com",
    total: 1,
    reachable: 1,
    subdomains: [
      {
        subdomain: "api.example.com",
        url: "https://api.example.com",
        reachable: true,
        statusCode: 200,
        sources: ["crt.sh"],
      },
    ],
    cached: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockValidateScanTarget.mockReset();
  mockValidateScanTarget.mockResolvedValue({ safe: true });
  mockGetCachedSnapshot.mockReset();
  mockGetCachedSnapshot.mockResolvedValue(null);
  mockDiscover.mockReset();
  mockDiscover.mockResolvedValue(makeResult());
});

describe("autoDiscoverSubdomains - cache hit (reuse)", () => {
  it("records a cache snapshot instantly and never touches the engine", async () => {
    const snapshot: DiscoveryResult = makeResult({
      domain: "cachehit.com",
      cached: true,
      cachedAt: "2026-01-01T00:00:00Z",
      expiresAt: "2026-01-01T04:00:00Z",
      subdomains: [
        {
          subdomain: "www.cachehit.com",
          url: "https://www.cachehit.com",
          reachable: true,
          statusCode: 200,
          sources: ["crt.sh"],
        },
      ],
    });
    mockGetCachedSnapshot.mockResolvedValue(snapshot);

    await autoDiscoverSubdomains("https://cachehit.com/path");

    expect(readSubdomains("cachehit.com")).toEqual(snapshot);
    // Reuse: the expensive engine sweep never ran, and no SSRF check was
    // needed because no external sweep happened.
    expect(mockDiscover).not.toHaveBeenCalled();
    expect(mockValidateScanTarget).not.toHaveBeenCalled();
  });
});

describe("autoDiscoverSubdomains - fresh discovery (cache miss)", () => {
  it("SSRF-guards the target, runs the engine, and records the result", async () => {
    mockDiscover.mockResolvedValue(
      makeResult({ domain: "fresh-ok.com", total: 2, reachable: 1 }),
    );

    await autoDiscoverSubdomains("https://fresh-ok.com");

    expect(mockValidateScanTarget).toHaveBeenCalledWith("https://fresh-ok.com");
    // Enumerates by registrable domain.
    expect(mockDiscover).toHaveBeenCalledWith("fresh-ok.com");
    const recorded = readSubdomains("fresh-ok.com");
    expect(recorded?.total).toBe(2);
  });

  it("records nothing when the discovery finds no subdomains", async () => {
    mockDiscover.mockResolvedValue(
      makeResult({ domain: "empty.com", total: 0, reachable: 0, subdomains: [] }),
    );

    await autoDiscoverSubdomains("https://empty.com");

    expect(readSubdomains("empty.com")).toBeUndefined();
  });

  it("never throws and records nothing when the engine rejects", async () => {
    mockDiscover.mockRejectedValue(new Error("engine blew up"));

    await expect(
      autoDiscoverSubdomains("https://boom.com"),
    ).resolves.toBeUndefined();
    expect(readSubdomains("boom.com")).toBeUndefined();
  });

  it("skips the engine entirely when the target fails the SSRF guard", async () => {
    mockValidateScanTarget.mockResolvedValue({
      safe: false,
      reason: "internal IP",
    });

    await autoDiscoverSubdomains("https://blocked.com");

    expect(mockDiscover).not.toHaveBeenCalled();
    expect(readSubdomains("blocked.com")).toBeUndefined();
  });
});

describe("autoDiscoverSubdomains - persists unreachable subdomains (BUG 1 regression)", () => {
  // A DiscoveryResult carries BOTH reachable and unreachable hosts. The auto
  // path must record the WHOLE result into the side channel (which
  // execute-scan then stores verbatim into result_meta.subdomains), never a
  // reachable-only subset -- otherwise History shows fewer subdomains than the
  // manual "Discover" refresh, which keeps the unreachables.
  const mixed: DiscoveryResult = {
    domain: "mixed.com",
    total: 3,
    reachable: 1,
    cached: false,
    subdomains: [
      {
        subdomain: "api.mixed.com",
        url: "https://api.mixed.com",
        reachable: true,
        statusCode: 200,
        sources: ["crt.sh"],
      },
      {
        subdomain: "dev.mixed.com",
        url: "https://dev.mixed.com",
        reachable: false,
        sources: ["crt.sh"],
      },
      {
        subdomain: "old.mixed.com",
        url: "https://old.mixed.com",
        reachable: false,
        sources: ["brute-force"],
      },
    ],
  };

  it("records the unreachable hosts from a fresh (cache-miss) discovery", async () => {
    mockDiscover.mockResolvedValue(mixed);

    await autoDiscoverSubdomains("https://mixed.com");

    const recorded = readSubdomains("mixed.com");
    expect(recorded?.subdomains).toHaveLength(3);
    expect(recorded?.subdomains.filter((s) => !s.reachable).map((s) => s.subdomain)).toEqual([
      "dev.mixed.com",
      "old.mixed.com",
    ]);
    // The whole result round-trips, not a reachable-only slice.
    expect(recorded).toEqual(mixed);
  });

  it("records the unreachable hosts from a cache hit", async () => {
    mockGetCachedSnapshot.mockResolvedValue({ ...mixed, domain: "cached-mixed.com", cached: true });

    await autoDiscoverSubdomains("https://cached-mixed.com");

    const recorded = readSubdomains("cached-mixed.com");
    expect(recorded?.subdomains.filter((s) => !s.reachable)).toHaveLength(2);
    expect(mockDiscover).not.toHaveBeenCalled();
  });
});

describe("autoDiscoverSubdomains - targets with no registrable domain", () => {
  it("skips a raw IPv4 target without touching the cache or engine", async () => {
    await autoDiscoverSubdomains("https://93.184.216.34/");

    expect(mockGetCachedSnapshot).not.toHaveBeenCalled();
    expect(mockDiscover).not.toHaveBeenCalled();
  });

  it("skips a single-label host with no dot", async () => {
    await autoDiscoverSubdomains("https://localhost");

    expect(mockGetCachedSnapshot).not.toHaveBeenCalled();
    expect(mockDiscover).not.toHaveBeenCalled();
  });

  it("does not throw on an unparseable URL", async () => {
    await expect(
      autoDiscoverSubdomains("not a url"),
    ).resolves.toBeUndefined();
  });
});

describe("autoDiscoverSubdomains - timeout tolerance", () => {
  it("bounds a slow engine by the timeout and records nothing", async () => {
    // Engine that never settles: the timeout must win so the scan proceeds.
    mockDiscover.mockReturnValue(new Promise(() => {}));

    await autoDiscoverSubdomains("https://slow.com", { timeoutMs: 50 });

    expect(readSubdomains("slow.com")).toBeUndefined();
  });
});

describe("subdomain-auto side channel", () => {
  const rec = makeResult({ domain: "roundtrip.com" });

  it("round-trips by hostname case-insensitively and peeks without deleting", () => {
    recordSubdomains("RoundTrip.com", rec);
    expect(readSubdomains("roundtrip.com")).toEqual(rec);
    // A read peeks: the entry is still there for a second, concurrent reader.
    expect(readSubdomains("ROUNDTRIP.COM")).toEqual(rec);
  });

  it("returns undefined for a host that was never recorded", () => {
    expect(readSubdomains("never-recorded.invalid")).toBeUndefined();
  });
});
