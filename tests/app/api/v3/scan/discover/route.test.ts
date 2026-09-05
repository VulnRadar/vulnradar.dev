/**
 * Route-level tests for POST /api/v3/scan/discover.
 *
 * This route enumerates subdomains for a target (passive sources: crt.sh,
 * hackertarget, subdomain.center, rapiddns, alienvault, anubis, certspotter,
 * urlscan, wayback; plus a ~150-prefix DNS
 * brute-force), filters dead entries via DNS, then HTTP-probes the
 * survivors for reachability. Every discovered host is re-validated with
 * validateScanTarget immediately before it is actually probed, which is
 * the guard that stops DNS-based SSRF (a subdomain that resolves to an
 * internal IP must never be fetched, even though it is a legitimate
 * discovery result).
 *
 * Boundaries mocked: the database pool, session auth, the API-key
 * validator, the rate limiter, dns/promises (resolve4/resolve6, the only
 * two dns functions this file calls), and the network boundary itself
 * (global fetch for the passive sources, safeFetch/validateScanTarget for
 * the SSRF-guarded probing). Nothing below those boundaries is mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: () => mockGetSession() };
});

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/rate-limiting/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  };
});

const mockValidateApiKey = vi.fn();
vi.mock("@/lib/api/api-keys", () => ({
  validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args),
}));

const mockSafeFetch = vi.fn();
const mockValidateScanTarget = vi.fn();
vi.mock("@/lib/scanner/safe-fetch", () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
  validateScanTarget: (...args: unknown[]) => mockValidateScanTarget(...args),
}));

// Discovery now honours the admin blocklist and, on a forced refresh, charges
// the daily quota: a forced refresh skips the cache and runs the full engine
// (191-prefix DNS brute force plus probing), which used to be free.
const mockCheckAccessRules =
  vi.fn<(url: string) => Promise<{ allowed: boolean; reason?: string }>>();
const mockGetDailyLimit = vi.fn<(userId: number) => Promise<number>>();
const mockIncrementDailyCountCapped =
  vi.fn<
    (
      userId: number,
      limit: number,
    ) => Promise<{ recorded: boolean; count: number }>
  >();

// Subdomain discovery is a paid re-run: a forced refresh is a 191-prefix DNS
// brute force plus up to 1000 resolutions plus HTTP probing, and it was gated
// only in the browser. The route now calls the same helper the three sibling
// refresh routes use. Default to allowed here so the existing tests exercise
// the discovery path; the gate itself gets its own test below.
const mockRequireRefreshPlan = vi.fn(async () => ({ ok: true as const }));
vi.mock("@/lib/history/refresh-scan", () => ({
  requireRefreshPlan: () => mockRequireRefreshPlan(),
}));

vi.mock("@/lib/scanner/access-rules", () => ({
  checkAccessRules: (url: string) => mockCheckAccessRules(url),
}));
vi.mock("@/lib/rate-limiting/daily-limits", () => ({
  getDailyLimit: (userId: number) => mockGetDailyLimit(userId),
  incrementDailyCountCapped: (userId: number, limit: number) =>
    mockIncrementDailyCountCapped(userId, limit),
}));

const mockResolve4 = vi.fn();
const mockResolve6 = vi.fn();
const mockResolveCname = vi.fn();
vi.mock("dns/promises", () => ({
  default: {
    resolve4: (...args: unknown[]) => mockResolve4(...args),
    resolve6: (...args: unknown[]) => mockResolve6(...args),
    resolveCname: (...args: unknown[]) => mockResolveCname(...args),
  },
}));

const mockFetch = vi.fn();

const { POST } = await import("@/app/api/v3/scan/discover/route");

function postRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v3/scan/discover", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function enotfound() {
  return Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
}

interface DiscoveredSubdomainResult {
  subdomain: string;
  url: string;
  reachable: boolean;
  statusCode?: number;
  sources: string[];
}

function subdomainMap(subdomains: DiscoveredSubdomainResult[]) {
  return new Map(subdomains.map((s) => [s.subdomain, s] as const));
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);

  mockCheckAccessRules.mockReset();
  mockCheckAccessRules.mockResolvedValue({ allowed: true });
  mockGetDailyLimit.mockReset();
  mockGetDailyLimit.mockResolvedValue(100);
  mockIncrementDailyCountCapped.mockReset();
  mockIncrementDailyCountCapped.mockResolvedValue({ recorded: true, count: 1 });

  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });

  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });

  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 9,
    retryAfterSeconds: 0,
  });

  mockValidateApiKey.mockReset();

  mockSafeFetch.mockReset();
  mockValidateScanTarget.mockReset();
  mockValidateScanTarget.mockResolvedValue({ safe: true });

  mockResolve4.mockReset();
  mockResolve6.mockReset();
  mockResolveCname.mockReset();
  mockResolve4.mockRejectedValue(enotfound());
  mockResolve6.mockRejectedValue(enotfound());
  mockResolveCname.mockRejectedValue(enotfound());

  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: false,
    json: async () => [],
    text: async () => "",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/v3/scan/discover - auth", () => {
  it("rejects a request with no session and no API key, before touching the database", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
    // The settings snapshot is excluded: the PAUSE_SCANNING gate now runs
    // before auth and reads it, but the resolver caches it for 30 seconds
    // and shares it across every setting the request resolves, so it is not
    // per-request database work. Everything else must still be untouched.
    const nonSettingsQueries = mockQuery.mock.calls.filter(
      ([sql]) => !String(sql).includes("FROM system_settings"),
    );
    expect(nonSettingsQueries).toHaveLength(0);
  });

  it("rejects an invalid or revoked API key", async () => {
    mockGetSession.mockResolvedValue(null);
    mockValidateApiKey.mockResolvedValue(null);

    const res = await POST(
      postRequest(
        { url: "https://example.com" },
        { authorization: "Bearer vr_bad_key" },
      ),
    );

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Invalid or revoked API key.");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects an API key whose owner needs to accept updated terms", async () => {
    mockGetSession.mockResolvedValue(null);
    mockValidateApiKey.mockResolvedValue({
      keyId: 5,
      userId: 9,
      dailyLimit: 50,
      needsTermsAcceptance: true,
    });

    const res = await POST(
      postRequest(
        { url: "https://example.com" },
        { authorization: "Bearer vr_key" },
      ),
    );

    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("authenticates via a valid Bearer API key and rate-limits by that user id", async () => {
    mockGetSession.mockResolvedValue(null);
    mockValidateApiKey.mockResolvedValue({
      keyId: 5,
      userId: 9,
      dailyLimit: 50,
      needsTermsAcceptance: false,
    });

    const res = await POST(
      postRequest(
        { url: "https://example.com" },
        { authorization: "Bearer vr_key" },
      ),
    );

    expect(res.status).toBe(200);
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ key: "discover:9" }),
    );
  });
});

describe("POST /api/v3/scan/discover - rate limiting", () => {
  it("returns 429 and never queries the database when the limit is exceeded", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 30,
    });

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(429);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("keys the rate limit by the authenticated session user id", async () => {
    await POST(postRequest({ url: "https://example.com" }));

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ key: "discover:42" }),
    );
  });
});

describe("POST /api/v3/scan/discover - input validation", () => {
  it("rejects a body that is not valid JSON", async () => {
    const req = new NextRequest("http://localhost/api/v3/scan/discover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not valid json",
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid request body");
  });

  it("rejects a missing url", async () => {
    const res = await POST(postRequest({}));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("URL is required");
  });

  it("rejects a non-string url", async () => {
    const res = await POST(postRequest({ url: 12345 }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("URL is required");
  });

  it("rejects a url longer than the configured maximum length", async () => {
    const longUrl = `https://example.com/${"a".repeat(2100)}`;

    const res = await POST(postRequest({ url: longUrl }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/maximum length/i);
  });

  it("rejects a url that cannot be parsed", async () => {
    const res = await POST(postRequest({ url: "not a url" }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid URL");
  });
});

describe("POST /api/v3/scan/discover - SSRF guard on the discovery target", () => {
  it("blocks a target rejected by validateScanTarget and surfaces its reason", async () => {
    mockValidateScanTarget.mockResolvedValue({
      safe: false,
      reason:
        "Domain resolves to internal IP address. Scanning internal networks is not allowed.",
    });

    const res = await POST(
      postRequest({ url: "https://internal.example.com" }),
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe(
      "Domain resolves to internal IP address. Scanning internal networks is not allowed.",
    );
    // Blocked before any DNS/HTTP discovery work (and before the DB cache lookup).
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockResolve4).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("falls back to a generic message when validateScanTarget omits a reason", async () => {
    mockValidateScanTarget.mockResolvedValue({ safe: false });

    const res = await POST(
      postRequest({ url: "https://blocked-target.example.com" }),
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("URL blocked for security reasons");
  });
});

describe("POST /api/v3/scan/discover - cache", () => {
  it("returns a fresh cache entry without touching DNS or HTTP", async () => {
    const cachedSubdomains = [
      {
        subdomain: "api.example.com",
        url: "https://api.example.com",
        reachable: true,
        statusCode: 200,
        sources: ["crt.sh"],
      },
    ];
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          subdomains: cachedSubdomains,
          cached_at: "2026-01-01T00:00:00Z",
          expires_at: "2026-01-01T04:00:00Z",
        },
      ],
    });

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.cached).toBe(true);
    expect(json.subdomains).toEqual(cachedSubdomains);
    expect(json.total).toBe(1);
    expect(json.reachable).toBe(1);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockResolve4).not.toHaveBeenCalled();
    // Only the cache SELECT ran, no INSERT/write.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("computes the root domain across a double-barrelled TLD", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          subdomains: [],
          cached_at: "2026-01-01T00:00:00Z",
          expires_at: "2026-01-01T04:00:00Z",
        },
      ],
    });

    const res = await POST(postRequest({ url: "https://sub.example.co.uk" }));

    const json = await res.json();
    expect(json.domain).toBe("example.co.uk");
  });

  it("falls back to the bare hostname when it has no dot at all", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          subdomains: [],
          cached_at: "2026-01-01T00:00:00Z",
          expires_at: "2026-01-01T04:00:00Z",
        },
      ],
    });

    const res = await POST(postRequest({ url: "https://singlelabel" }));

    const json = await res.json();
    expect(json.domain).toBe("singlelabel");
  });

  it("bypasses a fresh cache entry when forceRefresh is set", async () => {
    const res = await POST(
      postRequest({ url: "https://example.com", forceRefresh: true }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.cached).toBe(false);
    // The cache SELECT is never issued at all when forceRefresh is true.
    const ranCacheSelect = mockQuery.mock.calls.some(([sql]) =>
      String(sql).includes("SELECT subdomains"),
    );
    expect(ranCacheSelect).toBe(false);
  });

  it("treats a cache read failure as a cache miss rather than failing the request", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.cached).toBe(false);
  });

  it("does not fail the request when the fire-and-forget cache write fails", async () => {
    mockQuery.mockReset();
    mockQuery.mockRejectedValue(new Error("insert failed"));

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(200);
  });
});

describe("POST /api/v3/scan/discover - full discovery pipeline (cache miss)", () => {
  function configurePassiveSources() {
    mockFetch.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("crt.sh")) {
        return {
          ok: true,
          json: async () => [
            {
              common_name: "crt-sub.example.com",
              name_value:
                "crt-sub.example.com\napi.example.com\nno-dns.example.com\nv6only.example.com",
            },
          ],
        };
      }
      if (url.includes("hackertarget")) {
        return {
          ok: true,
          text: async () =>
            "api.example.com,1.2.3.4\nhtarget-only.example.com,5.6.7.8\n",
        };
      }
      if (url.includes("subdomain.center")) {
        return {
          ok: true,
          json: async () => ["cdn.example.com", "blocked.example.com"],
        };
      }
      if (url.includes("rapiddns")) {
        return {
          ok: true,
          text: async () => "<html>rapid-only.example.com</html>",
        };
      }
      return { ok: false, json: async () => [], text: async () => "" };
    });
  }

  // Hosts that resolve via A records. "www", "api", and "cdn" are also
  // literal brute-force prefixes, so they get resolved a second time (and
  // merge sources) via the brute-force pass, on top of any passive hit.
  const v4Hosts = new Set([
    "crt-sub.example.com",
    "api.example.com",
    "htarget-only.example.com",
    "cdn.example.com",
    "blocked.example.com",
    "rapid-only.example.com",
    "www.example.com",
  ]);
  // Resolves only via AAAA, to exercise the resolve4-fails/resolve6-succeeds
  // fallback branch inside batchDnsResolve.
  const v6OnlyHosts = new Set(["v6only.example.com"]);

  function configureDns() {
    mockResolve4.mockImplementation(async (hostname: string) => {
      if (v4Hosts.has(hostname)) return ["1.2.3.4"];
      throw enotfound();
    });
    mockResolve6.mockImplementation(async (hostname: string) => {
      if (v6OnlyHosts.has(hostname)) return ["::1"];
      throw enotfound();
    });
  }

  function configureHttpProbe() {
    mockValidateScanTarget.mockImplementation(async (url: string) => {
      if (url.includes("blocked.example.com")) {
        return {
          safe: false,
          reason:
            "Domain resolves to internal IP address. Scanning internal networks is not allowed.",
        };
      }
      return { safe: true };
    });
    mockSafeFetch.mockImplementation(async (url: string) => {
      // api.example.com: https fails, http fallback succeeds.
      if (url.startsWith("https://api.example.com")) {
        throw new Error("https probe failed");
      }
      if (url.startsWith("http://api.example.com")) {
        return { status: 200 };
      }
      // rapid-only.example.com: both https and http fail.
      if (url.includes("rapid-only.example.com")) {
        throw new Error("unreachable");
      }
      return { status: 200 };
    });
  }

  beforeEach(() => {
    configurePassiveSources();
    configureDns();
    configureHttpProbe();
  });

  it("aggregates passive sources and DNS brute-force, filters by DNS, probes reachability, and sorts results", async () => {
    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.domain).toBe("example.com");
    expect(json.cached).toBe(false);
    expect(json.total).toBe(9);
    expect(json.reachable).toBe(6);

    expect(json.sources).toEqual({
      "crt.sh": 4,
      hackertarget: 2,
      "subdomain.center": 2,
      rapiddns: 1,
      alienvault: 0,
      anubis: 0,
      certspotter: 0,
      urlscan: 0,
      wayback: 0,
      "brute-force": 3,
    });

    const byName = subdomainMap(json.subdomains);
    const get = (name: string) => {
      const entry = byName.get(name);
      if (!entry) throw new Error(`expected ${name} in results`);
      return entry;
    };

    // Sources merge across passive hits and the brute-force pass.
    expect(get("api.example.com").sources).toEqual([
      "crt.sh",
      "hackertarget",
      "brute-force",
    ]);
    expect(get("cdn.example.com").sources).toEqual([
      "subdomain.center",
      "brute-force",
    ]);
    expect(get("www.example.com").sources).toEqual(["brute-force"]);

    // Reachable via https directly.
    expect(get("cdn.example.com").reachable).toBe(true);
    // Reachable via the http fallback after the https probe failed.
    expect(get("api.example.com").reachable).toBe(true);
    expect(get("api.example.com").statusCode).toBe(200);
    // Resolves via AAAA-only DNS and is still HTTP-checked.
    expect(get("v6only.example.com").reachable).toBe(true);
    // Resolves via DNS, but both HTTP attempts fail.
    expect(get("rapid-only.example.com").reachable).toBe(false);
    // No DNS record at all: excluded from HTTP probing, still listed as unreachable.
    expect(get("no-dns.example.com").reachable).toBe(false);
    expect(get("no-dns.example.com").statusCode).toBeUndefined();

    // Sort: reachable first, then alphabetical within each group.
    expect(
      json.subdomains.map((s: DiscoveredSubdomainResult) => s.subdomain),
    ).toEqual([
      "api.example.com",
      "cdn.example.com",
      "crt-sub.example.com",
      "htarget-only.example.com",
      "v6only.example.com",
      "www.example.com",
      "blocked.example.com",
      "no-dns.example.com",
      "rapid-only.example.com",
    ]);
  });

  it("never probes a discovered host blocked by validateScanTarget (SSRF-via-discovery guard)", async () => {
    const res = await POST(postRequest({ url: "https://example.com" }));
    const json = await res.json();

    const blocked = json.subdomains.find(
      (s: { subdomain: string }) => s.subdomain === "blocked.example.com",
    );
    expect(blocked).toBeDefined();
    // blocked.example.com resolved via DNS (it's a legitimate discovery
    // candidate) but validateScanTarget rejected it as an SSRF target, so
    // it is listed as unreachable rather than probed.
    expect(blocked.reachable).toBe(false);
    expect(blocked.statusCode).toBeUndefined();

    // The actual outbound probe (safeFetch) is never invoked for the
    // blocked host, over either scheme.
    const probedBlockedHost = mockSafeFetch.mock.calls.some(([url]) =>
      String(url).includes("blocked.example.com"),
    );
    expect(probedBlockedHost).toBe(false);

    // validateScanTarget was consulted for it, which is what produced the block.
    const checkedBlockedHost = mockValidateScanTarget.mock.calls.some(([url]) =>
      String(url).includes("blocked.example.com"),
    );
    expect(checkedBlockedHost).toBe(true);
  });

  it("caches the freshly discovered results, keyed by root domain", async () => {
    await POST(postRequest({ url: "https://example.com" }));

    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO subdomain_cache"),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1][0]).toBe("example.com");
    const storedSubdomains = JSON.parse(insertCall![1][1]);
    expect(Array.isArray(storedSubdomains)).toBe(true);
    expect(storedSubdomains.length).toBe(9);
  });

  it("does not fail the request when every passive source is unreachable or returns bad data", async () => {
    mockFetch.mockImplementation(async () => {
      throw new Error("network error");
    });

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(200);
    const json = await res.json();
    // Only the brute-force-only hits ("www", "api", "cdn" are literal
    // prefixes) survive; nothing from the (failed) passive sources does.
    expect(json.total).toBe(3);
    expect(
      json.subdomains.every((s: { sources: string[] }) =>
        s.sources.every((src) => src !== "crt.sh"),
      ),
    ).toBe(true);
  });
});

describe("POST /api/v3/scan/discover - dangling CNAME inclusion", () => {
  // These exercise the brute-force path specifically: unlike a passive-source
  // hit (always listed regardless of DNS status, see the "no-dns.example.com"
  // case in the full-pipeline suite above), a brute-force candidate is only
  // ever added to the results at all if batchDnsResolve resolves it -- so
  // this is the one path where the CNAME fallback changes whether a
  // subdomain is discovered, not just how it's reported.
  beforeEach(() => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => [],
      text: async () => "",
    });
  });

  it("discovers a brute-force candidate that only resolves via a CNAME (a dangling CNAME target with no A/AAAA of its own)", async () => {
    // "cdn" is a real entry in BRUTE_FORCE_PREFIXES. Neither A nor AAAA
    // resolves for it -- only its CNAME record does.
    mockResolveCname.mockImplementation(async (hostname: string) => {
      if (hostname === "cdn.example.com") {
        return ["dangling-target.example.net"];
      }
      throw enotfound();
    });

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(200);
    const json = await res.json();
    const found = json.subdomains.find(
      (s: { subdomain: string }) => s.subdomain === "cdn.example.com",
    );
    expect(found).toBeDefined();
    expect(found.sources).toEqual(["brute-force"]);
    // A dangling CNAME target never resolves to an IP, so the HTTP
    // reachability check correctly still fails -- being *discovered* at
    // all is the fix here, not reachability.
    expect(found.reachable).toBe(false);
  });

  it("never adds a brute-force candidate with no A, AAAA, or CNAME record at all", async () => {
    // resolve4/resolve6/resolveCname all reject by default (top-level
    // beforeEach) -- nothing needs to be configured for this case.
    const res = await POST(postRequest({ url: "https://example.com" }));

    const json = await res.json();
    expect(json.total).toBe(0);
  });
});

describe("POST /api/v3/scan/discover - passive-source sanitization (default DNS: nothing resolves)", () => {
  it("drops passive-source names containing wildcards, spaces, or @ before they reach DNS/HTTP", async () => {
    mockFetch.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("hackertarget")) {
        return {
          ok: true,
          text: async () =>
            "*.example.com,1.2.3.4\n" +
            "weird name.example.com,1.2.3.4\n" +
            "us@er.example.com,1.2.3.4\n" +
            "clean.example.com,1.2.3.4\n",
        };
      }
      return { ok: false, json: async () => [], text: async () => "" };
    });

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(
      json.subdomains.map((s: DiscoveredSubdomainResult) => s.subdomain),
    ).toEqual(["clean.example.com"]);
  });

  it('treats a hackertarget "API count exceeded" response as no results, not a crash', async () => {
    mockFetch.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("hackertarget")) {
        return { ok: true, text: async () => "API count exceeded per day" };
      }
      return { ok: false, json: async () => [], text: async () => "" };
    });

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sources.hackertarget).toBe(0);
  });
});

describe("POST /api/v3/scan/discover - additional passive sources", () => {
  it("merges and dedupes a new source's hosts with the existing sources, tagging each host by source", async () => {
    mockFetch.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("crt.sh")) {
        return {
          ok: true,
          json: async () => [
            {
              common_name: "shared.example.com",
              name_value: "shared.example.com",
            },
          ],
        };
      }
      // AlienVault OTX passive DNS shape: { passive_dns: [{ hostname }] }.
      if (url.includes("otx.alienvault.com")) {
        return {
          ok: true,
          json: async () => ({
            passive_dns: [
              { hostname: "shared.example.com" }, // overlaps crt.sh -> merge sources
              { hostname: "otx-only.example.com" }, // unique -> newly discovered
              { hostname: "off-target.example.net" }, // wrong domain -> filtered out
            ],
          }),
        };
      }
      return { ok: false, json: async () => [], text: async () => "" };
    });

    const res = await POST(postRequest({ url: "https://example.com" }));
    expect(res.status).toBe(200);
    const json = await res.json();

    const byName = subdomainMap(json.subdomains);
    // A host only the new source found is discovered and tagged with it.
    expect(byName.get("otx-only.example.com")?.sources).toEqual(["alienvault"]);
    // A host both sources found carries BOTH tags, as a single deduped entry.
    expect(byName.get("shared.example.com")?.sources).toEqual([
      "crt.sh",
      "alienvault",
    ]);
    expect(
      json.subdomains.filter(
        (s: DiscoveredSubdomainResult) => s.subdomain === "shared.example.com",
      ),
    ).toHaveLength(1);
    // A host outside the target registrable domain is never merged in.
    expect(byName.has("off-target.example.net")).toBe(false);
    // The per-source roll-up reflects the new source (post domain-filter count).
    expect(json.sources.alienvault).toBe(2);
    expect(json.sources["crt.sh"]).toBe(1);
  });

  it("swallows a passive source that throws and still returns the other sources' results", async () => {
    mockFetch.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("api.certspotter.com")) {
        throw new Error("certspotter exploded");
      }
      if (url.includes("crt.sh")) {
        return {
          ok: true,
          json: async () => [
            { common_name: "crt.example.com", name_value: "crt.example.com" },
          ],
        };
      }
      return { ok: false, json: async () => [], text: async () => "" };
    });

    const res = await POST(postRequest({ url: "https://example.com" }));

    // The throwing source degrades to zero results, never a failed request.
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sources.certspotter).toBe(0);
    // The healthy source's result is unaffected by the neighbour throwing.
    const byName = subdomainMap(json.subdomains);
    expect(byName.get("crt.example.com")?.sources).toEqual(["crt.sh"]);
  });
});

describe("POST /api/v3/scan/discover - error handling", () => {
  it("returns 500 when an unexpected error is thrown mid-request", async () => {
    mockGetSession.mockRejectedValue(new Error("boom"));

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Subdomain discovery failed");
  });
});
