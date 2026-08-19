/**
 * Tests for the full structured DNS record fetch (lib/scanner/dns-records.ts).
 *
 * resolveDnsRecords performs real network I/O during a scan. These tests mock
 * the underlying `dns/promises` resolvers so the parsing/shape logic can be
 * exercised without touching the network, while verifying:
 *
 *   - the returned object is well-typed and correctly parsed (MX priority,
 *     TXT chunk joining, CAA formatting, SOA fields)
 *   - Promise.allSettled tolerance: one failing record type never loses the
 *     rest, it just yields an empty array
 *   - per-query timeout: a hanging resolver is bounded, not awaited forever
 *   - the per-host side channel round-trips case-insensitively and peeks
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as dns from "dns/promises";
import {
  resolveDnsRecords,
  hasAnyDnsRecords,
  recordDnsRecords,
  readDnsRecords,
  type DnsRecords,
} from "@/lib/scanner/dns-records";

vi.mock("dns/promises", () => ({
  resolve4: vi.fn(),
  resolve6: vi.fn(),
  resolveCname: vi.fn(),
  resolveMx: vi.fn(),
  resolveNs: vi.fn(),
  resolveTxt: vi.fn(),
  resolveCaa: vi.fn(),
  resolveSoa: vi.fn(),
}));

const SOA = {
  nsname: "ns1.example.com",
  hostmaster: "hostmaster.example.com",
  serial: 2024010101,
  refresh: 7200,
  retry: 3600,
  expire: 1209600,
  minttl: 300,
};

/** A domain that resolves every record type cleanly. */
function primeAllGood() {
  vi.mocked(dns.resolve4).mockResolvedValue(["93.184.216.34"]);
  vi.mocked(dns.resolve6).mockResolvedValue([
    "2606:2800:220:1:248:1893:25c8:1946",
  ]);
  // No CNAME at the apex: resolvers return ENODATA, which allSettled tolerates.
  vi.mocked(dns.resolveCname).mockRejectedValue(
    Object.assign(new Error("ENODATA"), { code: "ENODATA" }),
  );
  vi.mocked(dns.resolveMx).mockResolvedValue([
    { priority: 20, exchange: "alt.mail.example.com" },
    { priority: 10, exchange: "mail.example.com" },
  ]);
  vi.mocked(dns.resolveNs).mockResolvedValue([
    "ns2.example.com",
    "ns1.example.com",
  ]);
  vi.mocked(dns.resolveTxt).mockResolvedValue([
    ["v=spf1 ", "include:_spf.example.com ~all"],
    ["google-site-verification=abc"],
  ]);
  vi.mocked(dns.resolveCaa).mockResolvedValue([
    { critical: 0, issue: "letsencrypt.org" },
    { critical: 0, iodef: "mailto:security@example.com" },
  ]);
  vi.mocked(dns.resolveSoa).mockResolvedValue(SOA);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveDnsRecords", () => {
  it("returns a well-typed, correctly parsed structured record set", async () => {
    primeAllGood();
    const r = await resolveDnsRecords("example.com");

    expect(r.hostname).toBe("example.com");
    expect(typeof r.resolvedAt).toBe("string");
    expect(Number.isNaN(Date.parse(r.resolvedAt))).toBe(false);

    expect(r.a).toEqual(["93.184.216.34"]);
    expect(r.aaaa).toEqual(["2606:2800:220:1:248:1893:25c8:1946"]);
    expect(r.cname).toEqual([]);

    // MX carries priority and is sorted ascending by it.
    expect(r.mx).toEqual([
      { priority: 10, exchange: "mail.example.com" },
      { priority: 20, exchange: "alt.mail.example.com" },
    ]);

    expect(r.ns).toEqual(["ns2.example.com", "ns1.example.com"]);

    // Each TXT record's wire-level chunks are joined back into one string.
    expect(r.txt).toEqual([
      "v=spf1 include:_spf.example.com ~all",
      "google-site-verification=abc",
    ]);

    expect(r.caa).toEqual([
      '0 issue "letsencrypt.org"',
      '0 iodef "mailto:security@example.com"',
    ]);

    expect(r.soa).toEqual(SOA);
  });

  it("lowercases the hostname it resolves", async () => {
    primeAllGood();
    const r = await resolveDnsRecords("Example.COM");
    expect(r.hostname).toBe("example.com");
  });

  it("tolerates a single failing record type without losing the rest", async () => {
    primeAllGood();
    vi.mocked(dns.resolveMx).mockRejectedValue(new Error("SERVFAIL"));

    const r = await resolveDnsRecords("example.com");

    expect(r.mx).toEqual([]); // the failing type is simply empty
    expect(r.a).toEqual(["93.184.216.34"]); // everything else intact
    expect(r.soa).toEqual(SOA);
    expect(hasAnyDnsRecords(r)).toBe(true);
  });

  it("times out a hanging resolver instead of hanging the whole fetch", async () => {
    vi.useFakeTimers();
    try {
      primeAllGood();
      // A resolver that never settles must not stall resolveDnsRecords.
      vi.mocked(dns.resolveTxt).mockImplementation(
        () => new Promise(() => {}),
      );

      const promise = resolveDnsRecords("example.com");
      await vi.advanceTimersByTimeAsync(4100);
      const r = await promise;

      expect(r.txt).toEqual([]); // the timed-out type ends empty
      expect(r.a).toEqual(["93.184.216.34"]); // the rest still resolved
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns an all-empty set when the query is already aborted", async () => {
    primeAllGood();
    const r = await resolveDnsRecords("example.com", AbortSignal.abort());

    expect(hasAnyDnsRecords(r)).toBe(false);
    expect(r.a).toEqual([]);
    expect(r.mx).toEqual([]);
    expect(r.soa).toBeNull();
  });
});

describe("hasAnyDnsRecords", () => {
  it("is true when any record type is present, false when all are empty", async () => {
    primeAllGood();
    const full = await resolveDnsRecords("example.com");
    expect(hasAnyDnsRecords(full)).toBe(true);

    const empty: DnsRecords = {
      hostname: "x",
      resolvedAt: "",
      a: [],
      aaaa: [],
      cname: [],
      mx: [],
      ns: [],
      txt: [],
      caa: [],
      soa: null,
    };
    expect(hasAnyDnsRecords(empty)).toBe(false);
  });
});

describe("dns-records side channel", () => {
  const rec: DnsRecords = {
    hostname: "example.com",
    resolvedAt: new Date().toISOString(),
    a: ["1.2.3.4"],
    aaaa: [],
    cname: [],
    mx: [],
    ns: [],
    txt: [],
    caa: [],
    soa: null,
  };

  it("round-trips by hostname case-insensitively and peeks without deleting", () => {
    recordDnsRecords("Example.com", rec);
    expect(readDnsRecords("example.com")).toEqual(rec);
    // A read peeks: the entry is still there for a second, concurrent reader.
    expect(readDnsRecords("EXAMPLE.COM")).toEqual(rec);
  });

  it("returns undefined for a host that was never recorded", () => {
    expect(readDnsRecords("never-recorded.invalid")).toBeUndefined();
  });
});
