/**
 * Tests for lib/scanner/checks/dns.ts.
 *
 * This module is mostly a registry-coverage placeholder (see its own file
 * header): the exported `detectors` map is all `() => null` stubs because
 * the registry's synchronous `EvidenceFn` signature can't perform a real
 * `dns/promises` lookup, and the "dns" category is dispatched from
 * lib/scanner/async-checks.ts instead (see registry.test.ts's
 * ASYNC_ONLY_CATEGORIES).
 *
 * The three `check*` functions added alongside the placeholder map ARE
 * real, live DNS probes (nameserver-provider concentration, wildcard DNS,
 * RFC 7505 null-MX recommendation), so those get real fixture coverage
 * here: one case that fires and one realistic case that legitimately does
 * not, per function.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("dns/promises", () => ({
  resolveNs: vi.fn(),
  resolve4: vi.fn(),
  resolve6: vi.fn(),
  resolveMx: vi.fn(),
  resolveTxt: vi.fn(),
}));

import * as dns from "dns/promises";
import {
  detectors,
  checkNsProviderConcentration,
  checkWildcardDns,
  checkNullMxRecommended,
} from "@/lib/scanner/checks/dns";

const dnsMock = vi.mocked(dns);

function dnsError(code: string) {
  return Object.assign(new Error(code), { code });
}

beforeEach(() => {
  dnsMock.resolveNs.mockReset();
  dnsMock.resolve4.mockReset();
  dnsMock.resolve6.mockReset();
  dnsMock.resolveMx.mockReset();
  dnsMock.resolveTxt.mockReset();
});

describe("detectors placeholder map", () => {
  // Every id is asserted, not just the three newest. These stubs exist so the
  // registry's coverage test can map each dns.json id to a known name, and a
  // stub that quietly started returning a string would emit a finding from a
  // detector that never actually queried DNS. Walking the whole map is also
  // what takes this module's function coverage off the floor: previously only
  // 3 of the 29 stubs were ever called.
  const ids = Object.keys(detectors);

  it("exposes a stub for every dns check id", () => {
    expect(ids.length).toBeGreaterThan(20);
  });

  it.each(ids)("%s returns null (async-only, never fires inline)", (id) => {
    expect(typeof detectors[id]).toBe("function");
    expect(detectors[id]("https://example.com", new Headers(), "")).toBe(null);
  });

  it.each(ids)("%s does not throw on a populated page", (id) => {
    expect(() =>
      detectors[id](
        "https://example.com/admin?next=/dashboard",
        new Headers({ "content-type": "text/html" }),
        "<html><body><h1>Test</h1></body></html>",
      ),
    ).not.toThrow();
  });
});

describe("checkNsProviderConcentration", () => {
  it("fires when every NS hostname shares the same registrable domain", async () => {
    dnsMock.resolveNs.mockResolvedValue([
      "ns1.example-dns.com",
      "ns2.example-dns.com",
    ]);
    const findings = await checkNsProviderConcentration(
      "example.com",
      "https://example.com",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("info");
    expect(findings[0].category).toBe("dns");
    expect(findings[0].title).toMatch(/Single Provider/i);
  });

  it("does not fire for a realistic diversified AWS Route 53 delegation", async () => {
    // AWS Route 53 deliberately spreads NS hostnames across four different
    // eTLD+1s so no single TLD outage takes every nameserver down. This is
    // the legitimate case the eTLD+1 heuristic must not flag.
    dnsMock.resolveNs.mockResolvedValue([
      "ns-100.awsdns-12.com",
      "ns-200.awsdns-25.net",
      "ns-300.awsdns-37.org",
      "ns-400.awsdns-50.co.uk",
    ]);
    const findings = await checkNsProviderConcentration(
      "example.com",
      "https://example.com",
    );
    expect(findings).toEqual([]);
  });

  it("does not fire when only a single NS record exists (a different check's job)", async () => {
    dnsMock.resolveNs.mockResolvedValue(["ns1.example.com"]);
    const findings = await checkNsProviderConcentration(
      "example.com",
      "https://example.com",
    );
    expect(findings).toEqual([]);
  });

  it("does not fire on a DNS resolution failure", async () => {
    dnsMock.resolveNs.mockRejectedValue(dnsError("ENOTFOUND"));
    const findings = await checkNsProviderConcentration(
      "example.com",
      "https://example.com",
    );
    expect(findings).toEqual([]);
  });

  it("gives up quietly when the NS lookup hangs past the 4s timeout", async () => {
    // withTimeout()'s reject arm: a resolver that never answers must resolve
    // to "no finding" rather than hanging the whole async-check pass. Uses
    // fake timers so the 4s race is exercised without a 4s test.
    vi.useFakeTimers();
    try {
      dnsMock.resolveNs.mockReturnValue(new Promise<string[]>(() => {}));
      const pending = checkNsProviderConcentration(
        "example.com",
        "https://example.com",
      );
      await vi.advanceTimersByTimeAsync(5000);
      await expect(pending).resolves.toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("checkWildcardDns", () => {
  it("fires when the random probe subdomain resolves", async () => {
    dnsMock.resolve4.mockResolvedValue(["203.0.113.5"]);
    const findings = await checkWildcardDns(
      "example.com",
      "https://example.com",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("low");
    expect(findings[0].title).toMatch(/Wildcard/i);
  });

  it("does not fire for a normal domain with no wildcard record", async () => {
    dnsMock.resolve4.mockRejectedValue(dnsError("ENOTFOUND"));
    dnsMock.resolve6.mockRejectedValue(dnsError("ENOTFOUND"));
    const findings = await checkWildcardDns(
      "example.com",
      "https://example.com",
    );
    expect(findings).toEqual([]);
  });

  it("does not fire on a transient DNS error", async () => {
    dnsMock.resolve4.mockRejectedValue(new Error("timeout"));
    dnsMock.resolve6.mockRejectedValue(new Error("timeout"));
    const findings = await checkWildcardDns(
      "example.com",
      "https://example.com",
    );
    expect(findings).toEqual([]);
  });

  it("fires on an IPv6-only wildcard, where A is absent but AAAA answers", async () => {
    dnsMock.resolve4.mockRejectedValue(dnsError("ENODATA"));
    dnsMock.resolve6.mockResolvedValue(["2001:db8::1"]);
    const findings = await checkWildcardDns(
      "example.com",
      "https://example.com",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].description).toContain("AAAA");
  });

  it("does not fire when the AAAA fallback hits a transient error after a clean A NXDOMAIN", async () => {
    // The A lookup genuinely said "no such name", but the AAAA lookup failed
    // for a network reason: the probe did not really run, so it must not
    // report "no wildcard" as though it had.
    dnsMock.resolve4.mockRejectedValue(dnsError("ENOTFOUND"));
    dnsMock.resolve6.mockRejectedValue(new Error("timeout"));
    const findings = await checkWildcardDns(
      "example.com",
      "https://example.com",
    );
    expect(findings).toEqual([]);
  });

  it("does not fire when both lookups succeed but return no addresses", async () => {
    dnsMock.resolve4.mockResolvedValue([]);
    dnsMock.resolve6.mockResolvedValue([]);
    const findings = await checkWildcardDns(
      "example.com",
      "https://example.com",
    );
    expect(findings).toEqual([]);
  });
});

describe("checkNullMxRecommended", () => {
  it("fires when the domain has no MX and no SPF record", async () => {
    dnsMock.resolveMx.mockRejectedValue(dnsError("ENOTFOUND"));
    dnsMock.resolveTxt.mockRejectedValue(dnsError("ENOTFOUND"));
    const findings = await checkNullMxRecommended(
      "example.com",
      "https://example.com",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("info");
    expect(findings[0].title).toMatch(/Null MX/i);
  });

  it("does not fire when the domain already publishes a null MX", async () => {
    // isNullMx() check runs first: a single MX record with exchange "."
    dnsMock.resolveMx.mockResolvedValue([{ exchange: ".", priority: 0 }]);
    const findings = await checkNullMxRecommended(
      "example.com",
      "https://example.com",
    );
    expect(findings).toEqual([]);
  });

  it("does not fire when the domain has real MX records (it sends/receives mail)", async () => {
    dnsMock.resolveMx.mockResolvedValue([
      { exchange: "mail.example.com", priority: 10 },
    ]);
    const findings = await checkNullMxRecommended(
      "example.com",
      "https://example.com",
    );
    expect(findings).toEqual([]);
  });

  it("does not fire when MX is absent but SPF exists (checkMX's job instead)", async () => {
    dnsMock.resolveMx.mockRejectedValue(dnsError("ENOTFOUND"));
    dnsMock.resolveTxt.mockResolvedValue([["v=spf1 -all"]]);
    const findings = await checkNullMxRecommended(
      "example.com",
      "https://example.com",
    );
    expect(findings).toEqual([]);
  });

  it("does not fire when the MX lookup fails for a transient reason", async () => {
    // An error with no ENODATA/ENOTFOUND/ENOENT code means the query did not
    // complete, not that the domain has no MX. Recommending a null MX off a
    // failed lookup would be a finding invented from a network blip.
    dnsMock.resolveMx.mockRejectedValue(new Error("timeout"));
    const findings = await checkNullMxRecommended(
      "example.com",
      "https://example.com",
    );
    expect(findings).toEqual([]);
    expect(dnsMock.resolveTxt).not.toHaveBeenCalled();
  });

  it("still fires when the domain has no MX and no TXT records at all", async () => {
    dnsMock.resolveMx.mockRejectedValue(dnsError("ENODATA"));
    dnsMock.resolveTxt.mockResolvedValue([["v=verification=abc"]]);
    const findings = await checkNullMxRecommended(
      "example.com",
      "https://example.com",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toMatch(/Null MX/i);
  });
});
