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
  resolveCname: vi.fn(),
  resolveCaa: vi.fn(),
}));

import * as dns from "dns/promises";
import {
  detectors,
  checkNsProviderConcentration,
  checkWildcardDns,
  checkNullMxRecommended,
  checkDnssecAlgorithmStrength,
  checkDsDigestAlgorithm,
  checkNsecParameters,
  checkCnameChain,
  checkCaaIodef,
  checkVerificationTokenSprawl,
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
  dnsMock.resolveCname.mockReset();
  dnsMock.resolveCaa.mockReset();
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

// ── DNS-over-HTTPS probes (DNSSEC parameters, NSEC/NSEC3) ───────────────
//
// dohAnswers queries dns.google and cloudflare-dns.com in parallel and takes
// whichever answers first with a usable body. These tests stub global fetch
// per query TYPE so one helper can drive every case, and the "both resolvers
// failed" case is asserted explicitly: a network failure must never be read
// as "the record is absent".

type DohFixture = Record<string, { Answer?: { data: string }[] } | "fail">;

function stubDoh(fixture: DohFixture) {
  const originalFetch = globalThis.fetch;
  const spy = vi.fn(async (input: unknown) => {
    const href = String(input);
    const type = /[?&]type=([A-Z0-9]+)/i.exec(href)?.[1] ?? "";
    const entry = fixture[type];
    if (entry === undefined || entry === "fail") {
      throw new Error("network");
    }
    return { json: async () => entry } as unknown as Response;
  });
  globalThis.fetch = spy as unknown as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

/**
 * RFC 3110 DNSKEY public key: a one-byte exponent length, the exponent, then
 * a modulus of `bits` bits. Only the byte lengths matter to rsaModulusBits.
 */
function rsaDnskey(bits: number): string {
  const exponent = Buffer.from([0x01, 0x00, 0x01]);
  const modulus = Buffer.alloc(bits / 8, 0xab);
  return Buffer.concat([
    Buffer.from([exponent.length]),
    exponent,
    modulus,
  ]).toString("base64");
}

describe("checkDnssecAlgorithmStrength", () => {
  it("flags a zone signed with RSA/SHA-1 (algorithm 5)", async () => {
    const restore = stubDoh({
      DNSKEY: { Answer: [{ data: `257 3 5 ${rsaDnskey(2048)}` }] },
    });
    try {
      const findings = await checkDnssecAlgorithmStrength(
        "example.com",
        "https://example.com",
      );
      const ids = findings.map((f) => f.id.split("--")[0]);
      expect(ids).toContain("dns-dnssec-algorithm-weak");
      expect(findings[0].evidence).toContain("RSA/SHA-1");
    } finally {
      restore();
    }
  });

  it("flags a 1024-bit RSA key-signing key", async () => {
    const restore = stubDoh({
      DNSKEY: { Answer: [{ data: `257 3 8 ${rsaDnskey(1024)}` }] },
    });
    try {
      const findings = await checkDnssecAlgorithmStrength(
        "example.com",
        "https://example.com",
      );
      const ids = findings.map((f) => f.id.split("--")[0]);
      expect(ids).toEqual(["dns-dnssec-key-size-weak"]);
      expect(findings[0].evidence).toContain("1024-bit");
    } finally {
      restore();
    }
  });

  it("reports nothing for a zone signed with ECDSAP256SHA256", async () => {
    const restore = stubDoh({
      DNSKEY: {
        Answer: [
          {
            data: "257 3 13 mdsswUyr3DPW132mOi8V9xESWE8jTo0dxCjjnopKl+GqJxpVXckHAeF+KkxLbxILfDLUT0rAK9iUzy1L53eKGQ==",
          },
        ],
      },
    });
    try {
      const findings = await checkDnssecAlgorithmStrength(
        "example.com",
        "https://example.com",
      );
      expect(findings).toEqual([]);
    } finally {
      restore();
    }
  });

  it("reports nothing when the zone is not signed at all", async () => {
    const restore = stubDoh({ DNSKEY: { Answer: [] } });
    try {
      expect(
        await checkDnssecAlgorithmStrength(
          "example.com",
          "https://example.com",
        ),
      ).toEqual([]);
    } finally {
      restore();
    }
  });

  it("reports nothing when both resolvers fail", async () => {
    const restore = stubDoh({ DNSKEY: "fail" });
    try {
      expect(
        await checkDnssecAlgorithmStrength(
          "example.com",
          "https://example.com",
        ),
      ).toEqual([]);
    } finally {
      restore();
    }
  });
});

describe("checkDsDigestAlgorithm", () => {
  it("flags a DS set that carries only a SHA-1 digest", async () => {
    const restore = stubDoh({ DS: { Answer: [{ data: "12345 8 1 abcdef" }] } });
    try {
      const findings = await checkDsDigestAlgorithm(
        "example.com",
        "https://example.com",
      );
      expect(findings.map((f) => f.id.split("--")[0])).toEqual([
        "dns-ds-digest-algorithm-weak",
      ]);
    } finally {
      restore();
    }
  });

  it("reports nothing when SHA-256 is published alongside SHA-1 (mid-rollover)", async () => {
    const restore = stubDoh({
      DS: {
        Answer: [
          { data: "12345 8 1 abcdef" },
          { data: "12345 8 2 0123456789" },
        ],
      },
    });
    try {
      expect(
        await checkDsDigestAlgorithm("example.com", "https://example.com"),
      ).toEqual([]);
    } finally {
      restore();
    }
  });

  it("reports nothing when only SHA-256 is published", async () => {
    const restore = stubDoh({ DS: { Answer: [{ data: "12345 13 2 abc" }] } });
    try {
      expect(
        await checkDsDigestAlgorithm("example.com", "https://example.com"),
      ).toEqual([]);
    } finally {
      restore();
    }
  });
});

describe("checkNsecParameters", () => {
  it("flags a signed zone with no NSEC3PARAM record", async () => {
    const restore = stubDoh({
      DNSKEY: { Answer: [{ data: "257 3 13 abc" }] },
      NSEC3PARAM: { Answer: [] },
    });
    try {
      const findings = await checkNsecParameters(
        "example.com",
        "https://example.com",
      );
      expect(findings.map((f) => f.id.split("--")[0])).toEqual([
        "dns-nsec-zone-walking",
      ]);
    } finally {
      restore();
    }
  });

  it("flags NSEC3 with a non-zero iteration count", async () => {
    const restore = stubDoh({
      DNSKEY: { Answer: [{ data: "257 3 13 abc" }] },
      NSEC3PARAM: { Answer: [{ data: "1 0 10 AB12CD34" }] },
    });
    try {
      const findings = await checkNsecParameters(
        "example.com",
        "https://example.com",
      );
      expect(findings.map((f) => f.id.split("--")[0])).toEqual([
        "dns-nsec3-iterations-nonzero",
      ]);
      expect(findings[0].severity).toBe("info");
    } finally {
      restore();
    }
  });

  it("reports nothing for RFC 9276 parameters (zero iterations)", async () => {
    const restore = stubDoh({
      DNSKEY: { Answer: [{ data: "257 3 13 abc" }] },
      NSEC3PARAM: { Answer: [{ data: "1 0 0 -" }] },
    });
    try {
      expect(
        await checkNsecParameters("example.com", "https://example.com"),
      ).toEqual([]);
    } finally {
      restore();
    }
  });

  it("reports nothing for an unsigned zone", async () => {
    const restore = stubDoh({
      DNSKEY: { Answer: [] },
      NSEC3PARAM: { Answer: [] },
    });
    try {
      expect(
        await checkNsecParameters("example.com", "https://example.com"),
      ).toEqual([]);
    } finally {
      restore();
    }
  });
});

// ── CNAME chain / apex ──────────────────────────────────────────────────

describe("checkCnameChain", () => {
  it("flags a CNAME published at the zone apex", async () => {
    dnsMock.resolveCname.mockImplementation(async (name: string) => {
      if (name === "example.com") return ["target.provider.net"];
      throw dnsError("ENODATA");
    });
    const findings = await checkCnameChain(
      "example.com",
      "https://example.com",
    );
    expect(findings.map((f) => f.id.split("--")[0])).toContain(
      "dns-cname-at-apex",
    );
  });

  it("does not fire on a CNAME under www, only at the apex", async () => {
    dnsMock.resolveCname.mockImplementation(async (name: string) => {
      if (name === "www.example.com") return ["target.provider.net"];
      throw dnsError("ENODATA");
    });
    const findings = await checkCnameChain(
      "www.example.com",
      "https://www.example.com",
    );
    expect(findings).toEqual([]);
  });

  it("flags a chain deeper than three hops", async () => {
    const chain: Record<string, string> = {
      "www.example.com": "a.example.net",
      "a.example.net": "b.vendor.io",
      "b.vendor.io": "c.cdn.example",
      "c.cdn.example": "d.edge.example",
    };
    dnsMock.resolveCname.mockImplementation(async (name: string) => {
      const next = chain[name];
      if (!next) throw dnsError("ENODATA");
      return [next];
    });
    const findings = await checkCnameChain(
      "www.example.com",
      "https://www.example.com",
    );
    expect(findings.map((f) => f.id.split("--")[0])).toEqual([
      "dns-cname-chain-too-long",
    ]);
    expect(findings[0].evidence).toContain("d.edge.example");
  });

  it("does not fire on the ordinary one-hop CNAME to a CDN", async () => {
    dnsMock.resolveCname.mockImplementation(async (name: string) => {
      if (name === "www.example.com") return ["example.cdn.net"];
      throw dnsError("ENODATA");
    });
    expect(
      await checkCnameChain("www.example.com", "https://www.example.com"),
    ).toEqual([]);
  });

  it("stops on a CNAME loop rather than spinning", async () => {
    dnsMock.resolveCname.mockImplementation(async (name: string) =>
      name === "a.example.com" ? ["b.example.com"] : ["a.example.com"],
    );
    const findings = await checkCnameChain(
      "a.example.com",
      "https://a.example.com",
    );
    expect(findings).toEqual([]);
  });
});

// ── CAA iodef ───────────────────────────────────────────────────────────

describe("checkCaaIodef", () => {
  it("flags a CAA set with an issue restriction and no iodef", async () => {
    dnsMock.resolveCaa.mockResolvedValue([
      { critical: 0, issue: "letsencrypt.org" },
    ]);
    const findings = await checkCaaIodef("example.com", "https://example.com");
    expect(findings.map((f) => f.id.split("--")[0])).toEqual([
      "dns-caa-iodef-missing",
    ]);
    expect(findings[0].severity).toBe("info");
  });

  it("does not fire when an iodef property is present", async () => {
    dnsMock.resolveCaa.mockResolvedValue([
      { critical: 0, issue: "letsencrypt.org" },
      { critical: 0, iodef: "mailto:security@example.com" },
    ]);
    expect(await checkCaaIodef("example.com", "https://example.com")).toEqual(
      [],
    );
  });

  it("does not fire when there is no CAA record at all (a different check's job)", async () => {
    dnsMock.resolveCaa.mockRejectedValue(dnsError("ENODATA"));
    expect(await checkCaaIodef("example.com", "https://example.com")).toEqual(
      [],
    );
  });
});

// ── Verification-token sprawl ───────────────────────────────────────────

describe("checkVerificationTokenSprawl", () => {
  it("flags five or more distinct vendor verification records", async () => {
    dnsMock.resolveTxt.mockResolvedValue([
      ["v=spf1 include:_spf.google.com ~all"],
      ["google-site-verification=abc123"],
      ["MS=ms12345678"],
      ["atlassian-domain-verification=xyz"],
      ["facebook-domain-verification=fb0001"],
      ["stripe-verification=st0001"],
      ["docusign-domain-verification=ds0001"],
    ]);
    const findings = await checkVerificationTokenSprawl(
      "example.com",
      "https://example.com",
    );
    expect(findings.map((f) => f.id.split("--")[0])).toEqual([
      "dns-txt-verification-tokens-stale",
    ]);
    expect(findings[0].evidence).toContain("5");
  });

  it("does not fire on a domain with a couple of verification records", async () => {
    dnsMock.resolveTxt.mockResolvedValue([
      ["v=spf1 include:_spf.google.com ~all"],
      ["google-site-verification=abc123"],
      ["atlassian-domain-verification=xyz"],
    ]);
    expect(
      await checkVerificationTokenSprawl("example.com", "https://example.com"),
    ).toEqual([]);
  });

  it("does not fire when the TXT lookup fails", async () => {
    dnsMock.resolveTxt.mockRejectedValue(new Error("timeout"));
    expect(
      await checkVerificationTokenSprawl("example.com", "https://example.com"),
    ).toEqual([]);
  });
});
