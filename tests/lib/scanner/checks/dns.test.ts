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
  it("returns null for every id, including the three new checks", () => {
    for (const id of [
      "dns-ns-single-provider-concentration",
      "dns-wildcard-record-present",
      "dns-null-mx-recommended",
    ]) {
      expect(detectors[id]).toBeDefined();
      expect(detectors[id]("https://example.com", new Headers(), "")).toBe(
        null,
      );
    }
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
    expect(findings[0].severity).toBe("low");
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
});
