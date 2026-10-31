/**
 * The subdomain discovery pipeline: passive sources, a DNS brute force, a DNS
 * filter and an HTTP reachability probe. Only the network edges are faked (the
 * global fetch the passive sources use, dns/promises, safeFetch and the
 * database), so the pipeline's own decisions run for real.
 *
 * What is pinned here is what the outside world sees. The passive sources are
 * third parties and get the discovery User-Agent; the reachability probe goes
 * to the scanned domain's own subdomains and names the scanner like every
 * other request to a scan target.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("dns/promises", () => {
  const resolve4 = vi.fn();
  const resolve6 = vi.fn();
  const resolveCname = vi.fn();
  return {
    default: { resolve4, resolve6, resolveCname },
    resolve4,
    resolve6,
    resolveCname,
  };
});

vi.mock("@/lib/database/db", () => ({
  default: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
}));

vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: vi.fn(async (key: string) =>
    key === "SUBDOMAIN_DISCOVERY_HTTP_CONCURRENCY" ? 5 : 24,
  ),
}));

vi.mock("@/lib/scanner/safe-fetch", () => ({
  safeFetch: vi.fn(),
  validateScanTarget: vi.fn(async () => ({ safe: true })),
}));

import dns from "dns/promises";
import { safeFetch } from "@/lib/scanner/safe-fetch";
import { discoverSubdomainsForRoot } from "@/lib/scanner/subdomain-discovery-engine";
import {
  SCANNER_UA,
  SCANNER_UA_DISCOVERY,
  SCANNER_UA_PRODUCT,
} from "@/lib/scanner/user-agent";
import { userAgentOf } from "./_user-agent-of";

const dnsMock = vi.mocked(dns);
const safeFetchMock = vi.mocked(safeFetch);
const fetchMock = vi.fn();

const RESOLVABLE = new Set(["api.example.com", "www.example.com"]);

function noRecord() {
  return Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
}

beforeEach(() => {
  fetchMock.mockReset();
  safeFetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);

  // crt.sh knows api.example.com; every other passive source has nothing.
  fetchMock.mockImplementation(async (url: string) =>
    String(url).startsWith("https://crt.sh/")
      ? new Response(
          JSON.stringify([
            { common_name: "api.example.com", name_value: "api.example.com" },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      : new Response("", { status: 404 }),
  );

  dnsMock.resolve4.mockReset();
  dnsMock.resolve4.mockImplementation((async (name: string) => {
    if (RESOLVABLE.has(name)) return ["93.184.216.34"];
    throw noRecord();
  }) as never);
  dnsMock.resolve6.mockReset();
  dnsMock.resolve6.mockRejectedValue(noRecord());
  dnsMock.resolveCname.mockReset();
  dnsMock.resolveCname.mockRejectedValue(noRecord());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("discoverSubdomainsForRoot", () => {
  it("probes each subdomain that has DNS over https, falling back to http", async () => {
    safeFetchMock.mockImplementation((async (url: string) => {
      // api answers on https; www only on plain http.
      if (url === "https://api.example.com")
        return new Response(null, { status: 200 });
      if (url === "http://www.example.com")
        return new Response(null, { status: 301 });
      throw new Error("connection refused");
    }) as never);

    const result = await discoverSubdomainsForRoot("example.com");

    const probed = safeFetchMock.mock.calls.map(([url]) => String(url));
    expect(probed).toEqual(
      expect.arrayContaining([
        "https://api.example.com",
        "https://www.example.com",
        "http://www.example.com",
      ]),
    );
    expect(probed).not.toContain("http://api.example.com");

    const byName = Object.fromEntries(
      result.subdomains.map((s) => [s.subdomain, s]),
    );
    expect(byName["api.example.com"]).toMatchObject({
      reachable: true,
      statusCode: 200,
    });
    expect(byName["www.example.com"]).toMatchObject({
      reachable: true,
      statusCode: 301,
    });
    expect(result.sources?.["crt.sh"]).toBe(1);
  });

  it("names the scanner in the User-Agent of every reachability request", async () => {
    safeFetchMock.mockImplementation((async (url: string) => {
      if (url.startsWith("https://")) throw new Error("tls handshake failed");
      return new Response(null, { status: 200 });
    }) as never);

    await discoverSubdomainsForRoot("example.com");

    // Both the https attempt and the http fallback, for both subdomains.
    expect(safeFetchMock).toHaveBeenCalledTimes(4);
    for (const [, init] of safeFetchMock.mock.calls) {
      expect(init?.method).toBe("HEAD");
      expect(userAgentOf(init)).toBe(SCANNER_UA);
    }
    expect(SCANNER_UA).toContain(SCANNER_UA_PRODUCT);
  });

  it("asks the passive sources as the discovery client, not as the scan", async () => {
    safeFetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await discoverSubdomainsForRoot("example.com");

    expect(fetchMock).toHaveBeenCalled();
    for (const [, init] of fetchMock.mock.calls) {
      expect(userAgentOf(init)).toBe(SCANNER_UA_DISCOVERY);
    }
    expect(SCANNER_UA_DISCOVERY).toContain(SCANNER_UA_PRODUCT);
  });

  it("does not probe a name that has no DNS record", async () => {
    safeFetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    await discoverSubdomainsForRoot("example.com");

    const probedHosts = safeFetchMock.mock.calls.map(
      ([url]) => new URL(String(url)).hostname,
    );
    for (const host of probedHosts) expect(RESOLVABLE.has(host)).toBe(true);
  });
});
