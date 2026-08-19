/**
 * Tests for the multi-source threat-intelligence reputation check
 * (lib/scanner/reputation-lookup.ts).
 *
 * Every external boundary is mocked at the network layer, never the DB:
 *   - global fetch  -> Google Web Risk + URLhaus (dispatched by URL so the
 *     order of the parallel calls never matters).
 *   - dns/promises  -> Spamhaus DBL (resolve4).
 *   - runtime-config -> resolves the per-source timeout from the shipped
 *     registry default, so no real DB connection is attempted.
 *
 * WEB_RISK_API_KEY is set/unset per test via process.env directly since the
 * module reads it fresh on every call. The module-level per-host caches are
 * cleared before each test via the exported test-only reset helper.
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

vi.mock("dns/promises", () => ({
  // Spamhaus DBL lookup. Defaults to NXDOMAIN (host not listed = clean).
  resolve4: vi.fn(async () => {
    throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
  }),
  // safe-fetch imports lookup(); never called from these code paths, but
  // present so the mocked module has the export.
  lookup: vi.fn(),
}));

import * as dns from "dns/promises";
import {
  checkReputation,
  isReputationCheckConfigured,
  queryUrlhaus,
  querySpamhausDbl,
  readThreatIntel,
  __resetReputationCachesForTests,
} from "@/lib/scanner/reputation-lookup";

const dnsMock = vi.mocked(dns);
const originalEnv = { ...process.env };

/** JSON Response helper. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Install a fetch mock that dispatches by request URL. Any endpoint not named
 * defaults to a network rejection, so a source with no explicit setup reads as
 * "unavailable" rather than accidentally "clean".
 */
function stubFetch(opts: { webRisk?: () => Response; urlhaus?: () => Response }) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const u = String(input);
    if (u.includes("webrisk.googleapis.com")) {
      if (opts.webRisk) return opts.webRisk();
      throw new Error("network error");
    }
    if (u.includes("urlhaus-api.abuse.ch")) {
      if (opts.urlhaus) return opts.urlhaus();
      throw new Error("network error");
    }
    throw new Error(`unexpected fetch: ${u}`);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  __resetReputationCachesForTests();
  dnsMock.resolve4.mockReset();
  dnsMock.resolve4.mockRejectedValue(
    Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

// ── isReputationCheckConfigured (Web Risk key gate) ─────────────────────────

describe("isReputationCheckConfigured", () => {
  it("is false when WEB_RISK_API_KEY is unset", () => {
    delete process.env.WEB_RISK_API_KEY;
    expect(isReputationCheckConfigured()).toBe(false);
  });

  it("is true when WEB_RISK_API_KEY is set", () => {
    process.env.WEB_RISK_API_KEY = "test-key";
    expect(isReputationCheckConfigured()).toBe(true);
  });
});

// ── Google Web Risk source (unchanged registry-backed findings) ─────────────

describe("checkReputation: Google Web Risk", () => {
  it("never queries Web Risk when no API key is configured", async () => {
    delete process.env.WEB_RISK_API_KEY;
    // URLhaus clean so nothing flags; Web Risk must not be called at all.
    const fetchMock = stubFetch({
      urlhaus: () => json({ query_status: "no_results" }),
    });
    const findings = await checkReputation("https://example.com");
    expect(findings).toEqual([]);
    const calledWebRisk = fetchMock.mock.calls.some((c) =>
      String(c[0]).includes("webrisk.googleapis.com"),
    );
    expect(calledWebRisk).toBe(false);
  });

  it("returns no findings when Web Risk reports no threat (host sources clean)", async () => {
    process.env.WEB_RISK_API_KEY = "test-key";
    stubFetch({
      webRisk: () => json({}),
      urlhaus: () => json({ query_status: "no_results" }),
    });
    const findings = await checkReputation("https://example.com");
    expect(findings).toEqual([]);
  });

  it("reports a finding for a single flagged threat type", async () => {
    process.env.WEB_RISK_API_KEY = "test-key";
    stubFetch({
      webRisk: () =>
        json({ threat: { threatTypes: ["MALWARE"], expireTime: "2026-08-13T00:00:00Z" } }),
      urlhaus: () => json({ query_status: "no_results" }),
    });
    const findings = await checkReputation("https://evil.example.com");
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toMatch(/^url-flagged-malware--/);
    expect(findings[0].category).toBe("reputation");
    expect(findings[0].severity).toBe("critical");
  });

  it("reports one finding per threat type when multiple are returned", async () => {
    process.env.WEB_RISK_API_KEY = "test-key";
    stubFetch({
      webRisk: () => json({ threat: { threatTypes: ["MALWARE", "SOCIAL_ENGINEERING"] } }),
      urlhaus: () => json({ query_status: "no_results" }),
    });
    const findings = await checkReputation("https://evil.example.com");
    const ids = findings.map((f) => f.id.split("--")[0]).sort();
    expect(ids).toEqual([
      "url-flagged-malware",
      "url-flagged-social-engineering",
    ]);
  });

  it("produces the same Web Risk finding id for the same URL across two calls", async () => {
    process.env.WEB_RISK_API_KEY = "test-key";
    stubFetch({
      webRisk: () => json({ threat: { threatTypes: ["UNWANTED_SOFTWARE"] } }),
      urlhaus: () => json({ query_status: "no_results" }),
    });
    const first = await checkReputation("https://evil.example.com");
    const second = await checkReputation("https://evil.example.com");
    expect(first[0].id).toBe(second[0].id);
  });

  it("fails open (no Web Risk finding) on a non-2xx Web Risk response", async () => {
    process.env.WEB_RISK_API_KEY = "test-key";
    stubFetch({
      webRisk: () => new Response("quota exceeded", { status: 429 }),
      urlhaus: () => json({ query_status: "no_results" }),
    });
    const findings = await checkReputation("https://example.com");
    expect(findings).toEqual([]);
    // ...and Web Risk is reported as unavailable, never clean.
    const summary = readThreatIntel("example.com");
    const webRisk = summary?.sources.find((s) => s.source === "Google Web Risk");
    expect(webRisk?.verdict).toBe("unavailable");
  });

  it("ignores an unknown/future Web Risk threatType instead of crashing", async () => {
    process.env.WEB_RISK_API_KEY = "test-key";
    stubFetch({
      webRisk: () => json({ threat: { threatTypes: ["SOME_NEW_THREAT_TYPE"] } }),
      urlhaus: () => json({ query_status: "no_results" }),
    });
    const findings = await checkReputation("https://example.com");
    expect(findings).toEqual([]);
  });

  it("sends the API key and all three threat types on the Web Risk request", async () => {
    process.env.WEB_RISK_API_KEY = "secret-key-123";
    const fetchMock = stubFetch({
      webRisk: () => json({}),
      urlhaus: () => json({ query_status: "no_results" }),
    });
    await checkReputation("https://example.com/path");

    const webRiskCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("webrisk.googleapis.com"),
    );
    expect(webRiskCall).toBeDefined();
    const parsed = new URL(String(webRiskCall![0]));
    expect(parsed.searchParams.get("key")).toBe("secret-key-123");
    expect(parsed.searchParams.get("uri")).toBe("https://example.com/path");
    expect(parsed.searchParams.getAll("threatTypes").sort()).toEqual([
      "MALWARE",
      "SOCIAL_ENGINEERING",
      "UNWANTED_SOFTWARE",
    ]);
  });
});

// ── URLhaus source ──────────────────────────────────────────────────────────

describe("queryUrlhaus", () => {
  it("reports clean on query_status no_results", async () => {
    stubFetch({ urlhaus: () => json({ query_status: "no_results" }) });
    const res = await queryUrlhaus("example.com", 5000);
    expect(res.verdict).toBe("clean");
  });

  it("reports flagged with a mapped category when the host has malicious URLs", async () => {
    stubFetch({
      urlhaus: () =>
        json({
          query_status: "ok",
          urls: [{ threat: "malware_download", url_status: "online" }],
        }),
    });
    const res = await queryUrlhaus("evil.example.com", 5000);
    expect(res.verdict).toBe("flagged");
    expect(res.categories).toContain("malware");
  });

  it("reports unavailable (never clean) on a non-2xx response", async () => {
    stubFetch({ urlhaus: () => new Response("nope", { status: 401 }) });
    const res = await queryUrlhaus("example.com", 5000);
    expect(res.verdict).toBe("unavailable");
  });

  it("reports unavailable on an unexpected query_status like invalid_host", async () => {
    stubFetch({ urlhaus: () => json({ query_status: "invalid_host" }) });
    const res = await queryUrlhaus("example.com", 5000);
    expect(res.verdict).toBe("unavailable");
  });

  it("never throws on a network error, resolving to unavailable", async () => {
    stubFetch({ urlhaus: () => { throw new Error("boom"); } });
    await expect(queryUrlhaus("example.com", 5000)).resolves.toMatchObject({
      verdict: "unavailable",
    });
  });

  it("caches per host: a second call within the TTL makes no new request", async () => {
    const fetchMock = stubFetch({
      urlhaus: () => json({ query_status: "no_results" }),
    });
    await queryUrlhaus("cache.example.com", 5000);
    await queryUrlhaus("cache.example.com", 5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ── Spamhaus DBL source ─────────────────────────────────────────────────────

describe("querySpamhausDbl", () => {
  it("reports clean on NXDOMAIN (host not listed)", async () => {
    dnsMock.resolve4.mockRejectedValue(
      Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }),
    );
    const res = await querySpamhausDbl("example.com", 5000);
    expect(res.verdict).toBe("clean");
  });

  it("reports flagged with the mapped category on a 127.0.1.x listing code", async () => {
    dnsMock.resolve4.mockResolvedValue(["127.0.1.5"]); // malware domain
    const res = await querySpamhausDbl("evil.example.com", 5000);
    expect(res.verdict).toBe("flagged");
    expect(res.categories).toEqual(["malware"]);
  });

  it("treats a 127.255.255.x error code as unavailable, NOT clean", async () => {
    dnsMock.resolve4.mockResolvedValue(["127.255.255.254"]); // public-resolver block
    const res = await querySpamhausDbl("example.com", 5000);
    expect(res.verdict).toBe("unavailable");
  });

  it("reports unavailable on a transient DNS error (SERVFAIL)", async () => {
    dnsMock.resolve4.mockRejectedValue(
      Object.assign(new Error("ESERVFAIL"), { code: "ESERVFAIL" }),
    );
    const res = await querySpamhausDbl("example.com", 5000);
    expect(res.verdict).toBe("unavailable");
  });

  it("reports unavailable on a timeout rather than hanging or throwing", async () => {
    dnsMock.resolve4.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(["127.0.1.2"]), 100)),
    );
    const res = await querySpamhausDbl("slow.example.com", 20);
    expect(res.verdict).toBe("unavailable");
  });

  it("caches per host: a second call within the TTL makes no new DNS query", async () => {
    dnsMock.resolve4.mockRejectedValue(
      Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }),
    );
    await querySpamhausDbl("cache-dbl.example.com", 5000);
    await querySpamhausDbl("cache-dbl.example.com", 5000);
    expect(dnsMock.resolve4).toHaveBeenCalledTimes(1);
  });
});

// ── Aggregation + summary side channel ──────────────────────────────────────

describe("checkReputation: aggregation", () => {
  it("emits one aggregated blocklist finding when a host source flags the host", async () => {
    delete process.env.WEB_RISK_API_KEY;
    stubFetch({
      urlhaus: () =>
        json({
          query_status: "ok",
          urls: [{ threat: "malware_download", url_status: "online" }],
        }),
    });
    const findings = await checkReputation("https://evil.example.com");
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe("reputation");
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].title).toMatch(/Threat-Intelligence Blocklist/i);
    expect(findings[0].evidence).toMatch(/URLhaus/);
  });

  it("keeps the aggregated finding id stable across two paths on the same host", async () => {
    delete process.env.WEB_RISK_API_KEY;
    stubFetch({
      urlhaus: () =>
        json({ query_status: "ok", urls: [{ threat: "malware_download" }] }),
    });
    const a = await checkReputation("https://evil.example.com/a");
    __resetReputationCachesForTests();
    stubFetch({
      urlhaus: () =>
        json({ query_status: "ok", urls: [{ threat: "malware_download" }] }),
    });
    const b = await checkReputation("https://evil.example.com/b");
    expect(a[0].id).toBe(b[0].id);
  });

  it("records unavailable distinctly from clean in the summary (unavailable != clean)", async () => {
    delete process.env.WEB_RISK_API_KEY;
    stubFetch({ urlhaus: () => new Response("x", { status: 500 }) }); // unavailable
    dnsMock.resolve4.mockRejectedValue(
      Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }), // clean
    );
    const findings = await checkReputation("https://example.com");
    expect(findings).toEqual([]); // nothing flagged

    const summary = readThreatIntel("example.com");
    expect(summary).toBeDefined();
    const urlhaus = summary!.sources.find((s) => s.source.startsWith("URLhaus"));
    const dbl = summary!.sources.find((s) => s.source === "Spamhaus DBL");
    expect(urlhaus?.verdict).toBe("unavailable");
    expect(dbl?.verdict).toBe("clean");
    // Only the reachable (clean) source counts toward reachableCount.
    expect(summary!.reachableCount).toBe(1);
    expect(summary!.flaggedCount).toBe(0);
  });

  it("never throws even when every source errors at the network boundary", async () => {
    delete process.env.WEB_RISK_API_KEY;
    stubFetch({ urlhaus: () => { throw new Error("net"); } });
    dnsMock.resolve4.mockRejectedValue(
      Object.assign(new Error("ESERVFAIL"), { code: "ESERVFAIL" }),
    );
    await expect(checkReputation("https://example.com")).resolves.toEqual([]);
    const summary = readThreatIntel("example.com");
    expect(summary!.reachableCount).toBe(0);
    expect(summary!.flaggedCount).toBe(0);
  });

  it("skips the domain-based sources for a raw IP target (SSRF-safe, no query)", async () => {
    delete process.env.WEB_RISK_API_KEY;
    const fetchMock = stubFetch({
      urlhaus: () => json({ query_status: "no_results" }),
    });
    const findings = await checkReputation("https://93.184.216.34/");
    expect(findings).toEqual([]);
    const urlhausCalled = fetchMock.mock.calls.some((c) =>
      String(c[0]).includes("urlhaus"),
    );
    expect(urlhausCalled).toBe(false);
    expect(dnsMock.resolve4).not.toHaveBeenCalled();
    // No domain to check and Web Risk unconfigured: no summary recorded.
    expect(readThreatIntel("93.184.216.34")).toBeUndefined();
  });
});
