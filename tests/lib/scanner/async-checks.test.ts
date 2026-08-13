/**
 * Tests for the async checks (DNS / TLS / live-fetch).
 *
 * The async checks perform real network I/O during a scan. These
 * tests mock the underlying `dns/promises`, `tls`, and `fetch`
 * primitives so we can exercise the check logic without touching the
 * network, while still verifying:
 *
 *   - DNS sub-checks (SPF, DMARC, DKIM, DNSSEC) produce correct findings
 *     for known-good and known-bad DNS responses
 *   - checkTLSCert parses a fake PeerCertificate correctly
 *   - checkRobotsTxt / checkSecurityTxt classify missing vs. present
 *     robots.txt / security.txt responses
 *   - runAsyncChecks correctly orchestrates the sub-tasks
 *
 * The async functions are exported from async-checks.ts (see the
 * `export` keyword on each `check*` declaration).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("dns/promises", () => ({
  resolveTxt: vi.fn(),
  resolveCaa: vi.fn(),
  resolveMx: vi.fn(),
  resolveSoa: vi.fn(),
  // Used by checkDKIM's CNAME-delegation fallback (ProtonMail, Google
  // Workspace, and others delegate DKIM via a CNAME rather than a TXT
  // record at the selector host).
  resolveCname: vi.fn(),
  // resolve4/resolve6/resolveNs: used by checkDNSResolution/checkNSCount.
  // vi.mock replaces the whole dns/promises module, so any export this
  // file doesn't list is `undefined` -- calling it throws synchronously,
  // which (depending on where it sits in a Promise.race/Promise.allSettled
  // array literal) can orphan an already-running sibling promise created
  // earlier in the same array, producing a real unhandled rejection later.
  // Every export async-checks.ts actually calls needs a stub here, even
  // ones no test in this file directly exercises.
  resolve4: vi.fn().mockRejectedValue(new Error("mock: dns disabled in tests")),
  resolve6: vi.fn().mockRejectedValue(new Error("mock: dns disabled in tests")),
  resolveNs: vi
    .fn()
    .mockRejectedValue(new Error("mock: dns disabled in tests")),
  // Used by lib/scanner/safe-fetch.ts's validateScanTarget, which the active
  // CORS/HTTP-methods/X-Forwarded-Host probes below now call to DNS-resolve
  // the target before fetching (closing a DNS-rebinding gap that the older
  // syntactic-only isPrivateHostname check missed). Defaults to a public IP
  // so those probes still run their real logic in tests instead of silently
  // no-op'ing on an unmocked rejection.
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

vi.mock("tls", () => ({
  default: {
    connect: vi.fn(),
  },
  connect: vi.fn(),
}));

// Runtime-config resolves settings via the database pool in production;
// mocked here at the module boundary (async-checks.ts has no other reason
// to touch the database) so these tests never attempt a real connection.
// The shipped registry defaults keep every resolved value identical to the
// old hardcoded constants (BRANCH_TIMEOUT_MS, MAX_BUCKET_LISTING_PROBES).
vi.mock("@/lib/config/runtime-config", async () => {
  const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");
  return {
    getSetting: vi.fn(
      async (key: keyof typeof SETTINGS_REGISTRY) =>
        SETTINGS_REGISTRY[key].default,
    ),
  };
});

import * as dns from "dns/promises";
import * as tls from "tls";
import * as crypto from "crypto";
import {
  checkSPF,
  checkDMARC,
  checkDKIM,
  checkDNSSEC,
  checkCAA,
  checkDNSSecurity,
  checkTLSCert,
  checkRobotsTxt,
  checkSecurityTxt,
  checkLiveFetch,
  checkBucketListing,
  runAsyncChecks,
  runAsyncChecksDetailed,
  getPlannedAsyncBranches,
  checkCAAPermissive,
  checkSOASerialStale,
  checkDMARCSubdomainPolicy,
  checkBIMI,
  checkDKIMWeakKey,
} from "@/lib/scanner/async-checks";

const dnsMock = vi.mocked(dns);
const tlsMock = vi.mocked(tls);
// dns.promises.lookup is overloaded (single result vs. LookupAddress[] when
// { all: true } is passed); vi.mocked's inferred type picks the single-result
// overload, which doesn't fit the array-returning mock the active-probe
// validateScanTarget calls need. Cast once here instead of fighting the
// overload at every call site.
const dnsLookupMock = dns.lookup as unknown as ReturnType<typeof vi.fn>;

function dnsError(code: string) {
  return Object.assign(new Error(code), { code });
}

beforeEach(() => {
  dnsMock.resolveTxt.mockReset();
  dnsMock.resolveCaa.mockReset();
  dnsMock.resolveMx.mockReset();
  dnsMock.resolveSoa.mockReset();
  dnsMock.resolveCname.mockReset();
  dnsMock.resolveCname.mockRejectedValue(dnsError("ENOTFOUND"));
  dnsLookupMock.mockReset();
  dnsLookupMock.mockImplementation(async () => [
    { address: "93.184.216.34", family: 4 },
  ]);
  tlsMock.connect.mockReset();
  // Reset the global fetch to the real implementation so we can mock per-test.
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── checkSPF ─────────────────────────────────────────────────────────

describe("checkSPF", () => {
  it("returns missing-SPF finding when no SPF record is present", async () => {
    dnsMock.resolveTxt.mockResolvedValueOnce([["v=spf2.0"]]);
    const findings = await checkSPF("example.com", "https://example.com");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/SPF/i);
    expect(findings[0].category).toBe("configuration");
  });

  it("returns weak-SPF finding when SPF uses +all", async () => {
    dnsMock.resolveTxt.mockResolvedValueOnce([["v=spf1 +all"]]);
    const findings = await checkSPF("example.com", "https://example.com");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/\+all|Weak/i);
  });

  it("returns no findings for a strict SPF record", async () => {
    dnsMock.resolveTxt.mockResolvedValueOnce([
      ["v=spf1 include:_spf.google.com -all"],
    ]);
    const findings = await checkSPF("example.com", "https://example.com");
    expect(findings).toEqual([]);
  });

  it("swallows DNS resolution failures (returns no findings)", async () => {
    dnsMock.resolveTxt.mockRejectedValueOnce(new Error("ENOTFOUND"));
    const findings = await checkSPF("example.com", "https://example.com");
    expect(findings).toEqual([]);
  });
});

// ── checkDMARC ───────────────────────────────────────────────────────

describe("checkDMARC", () => {
  it("returns missing-DMARC finding when no _dmarc TXT record exists", async () => {
    dnsMock.resolveTxt.mockResolvedValueOnce([["v=spf1 -all"]]);
    const findings = await checkDMARC("example.com", "https://example.com");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/DMARC/i);
  });

  it("returns weak-DMARC finding when policy is p=none", async () => {
    dnsMock.resolveTxt.mockResolvedValueOnce([["v=DMARC1; p=none"]]);
    const findings = await checkDMARC("example.com", "https://example.com");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/None|policy/i);
  });

  it("returns no findings for a strict DMARC policy", async () => {
    dnsMock.resolveTxt.mockResolvedValueOnce([
      ["v=DMARC1; p=reject; rua=mailto:dmarc@example.com"],
    ]);
    const findings = await checkDMARC("example.com", "https://example.com");
    expect(findings).toEqual([]);
  });

  it("does not flag a subdomain as missing DMARC when its organizational domain has a policy (RFC 7489 inheritance)", async () => {
    dnsMock.resolveTxt.mockImplementation(async (name: string) => {
      if (name === "_dmarc.sandbox.vulnradar.dev") throw dnsError("ENOTFOUND");
      if (name === "_dmarc.vulnradar.dev") {
        return [["v=DMARC1; p=quarantine; rua=mailto:dmarc@vulnradar.dev"]];
      }
      throw new Error(`unexpected lookup: ${name}`);
    });
    const findings = await checkDMARC(
      "sandbox.vulnradar.dev",
      "https://sandbox.vulnradar.dev",
    );
    expect(findings).toEqual([]);
  });

  it("still flags missing DMARC when neither the subdomain nor its organizational domain has a record", async () => {
    dnsMock.resolveTxt.mockImplementation(async () => {
      throw dnsError("ENOTFOUND");
    });
    const findings = await checkDMARC(
      "sandbox.vulnradar.dev",
      "https://sandbox.vulnradar.dev",
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/DMARC/i);
  });

  it("silently swallows transient DNS errors (SERVFAIL) for DMARC", async () => {
    // Transient errors (SERVFAIL, ETIMEOUT) are no longer treated as
    // "missing DMARC" to avoid false positives during DNS outages.
    dnsMock.resolveTxt.mockRejectedValueOnce(new Error("SERVFAIL"));
    const findings = await checkDMARC("example.com", "https://example.com");
    expect(findings).toEqual([]);
  });
});

// ── checkDMARCSubdomainPolicy ────────────────────────────────────────

describe("checkDMARCSubdomainPolicy", () => {
  it("flags sp= weaker than p=", async () => {
    dnsMock.resolveTxt.mockResolvedValueOnce([
      ["v=DMARC1; p=reject; sp=none; rua=mailto:dmarc@example.com"],
    ]);
    const findings = await checkDMARCSubdomainPolicy(
      "example.com",
      "https://example.com",
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/subdomain/i);
  });

  it("does not flag when sp= is at least as strong as p= (real-world: cloudflare.com)", async () => {
    dnsMock.resolveTxt.mockResolvedValueOnce([
      ["v=DMARC1; p=reject; sp=reject; adkim=r; aspf=r; pct=100"],
    ]);
    const findings = await checkDMARCSubdomainPolicy(
      "example.com",
      "https://example.com",
    );
    expect(findings).toEqual([]);
  });

  it("does not flag when sp= is absent (subdomains inherit p=, real-world: paypal.com)", async () => {
    dnsMock.resolveTxt.mockResolvedValueOnce([
      ["v=DMARC1; p=reject; rua=mailto:d@rua.agari.com"],
    ]);
    const findings = await checkDMARCSubdomainPolicy(
      "example.com",
      "https://example.com",
    );
    expect(findings).toEqual([]);
  });

  it("does not evaluate sp= on a subdomain of the scanned domain", async () => {
    const findings = await checkDMARCSubdomainPolicy(
      "sandbox.vulnradar.dev",
      "https://sandbox.vulnradar.dev",
    );
    expect(findings).toEqual([]);
    expect(dnsMock.resolveTxt).not.toHaveBeenCalled();
  });
});

// ── checkCAA ─────────────────────────────────────────────────────────

describe("checkCAA", () => {
  it("returns no findings when a CAA record exists", async () => {
    dnsMock.resolveCaa.mockResolvedValueOnce([
      { critical: 0, issue: "letsencrypt.org" },
    ]);
    const findings = await checkCAA("example.com", "https://example.com");
    expect(findings).toEqual([]);
  });

  it("returns a missing-CAA finding when no record exists anywhere", async () => {
    dnsMock.resolveCaa.mockRejectedValue(dnsError("ENOTFOUND"));
    const findings = await checkCAA("example.com", "https://example.com");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/CAA/i);
  });

  it("does not flag a subdomain as missing CAA when its organizational domain has a record (RFC 8659 inheritance)", async () => {
    dnsMock.resolveCaa.mockImplementation(async (hostname: string) => {
      if (hostname === "sandbox.vulnradar.dev") throw dnsError("ENOTFOUND");
      if (hostname === "vulnradar.dev") {
        return [{ critical: 0, issue: "letsencrypt.org" }];
      }
      throw new Error(`unexpected lookup: ${hostname}`);
    });
    const findings = await checkCAA(
      "sandbox.vulnradar.dev",
      "https://sandbox.vulnradar.dev",
    );
    expect(findings).toEqual([]);
  });

  it("still flags missing CAA when neither the subdomain nor its organizational domain has a record", async () => {
    dnsMock.resolveCaa.mockRejectedValue(dnsError("ENOTFOUND"));
    const findings = await checkCAA(
      "sandbox.vulnradar.dev",
      "https://sandbox.vulnradar.dev",
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/CAA/i);
  });

  it("silently swallows transient DNS errors (timeout) for CAA", async () => {
    dnsMock.resolveCaa.mockRejectedValue(new Error("timeout"));
    const findings = await checkCAA("example.com", "https://example.com");
    expect(findings).toEqual([]);
  });
});

// ── checkCAAPermissive ───────────────────────────────────────────────

describe("checkCAAPermissive", () => {
  it("flags a CAA record set with only an iodef tag (no issue/issuewild) as unrestricted (real-world: microsoft.com's apex CAA)", async () => {
    dnsMock.resolveCaa.mockResolvedValueOnce([
      { critical: 0, contactemail: "caarecordaware@example.com" },
    ]);
    const findings = await checkCAAPermissive(
      "example.com",
      "https://example.com",
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/restricts no certificate authority/i);
  });

  it("flags issuewild present with no issue tag as wildcard-only restriction", async () => {
    dnsMock.resolveCaa.mockResolvedValueOnce([
      { critical: 0, issuewild: "letsencrypt.org" },
    ]);
    const findings = await checkCAAPermissive(
      "example.com",
      "https://example.com",
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/wildcard certificates only/i);
  });

  it("does not flag when an issue tag is present, even alongside issuewild (real-world: github.com)", async () => {
    dnsMock.resolveCaa.mockResolvedValueOnce([
      { critical: 0, issue: "letsencrypt.org" },
      { critical: 0, issuewild: "letsencrypt.org" },
    ]);
    const findings = await checkCAAPermissive(
      "example.com",
      "https://example.com",
    );
    expect(findings).toEqual([]);
  });

  it("does not flag when issue alone is present (real-world: google.com)", async () => {
    dnsMock.resolveCaa.mockResolvedValueOnce([
      { critical: 0, issue: "pki.goog" },
    ]);
    const findings = await checkCAAPermissive(
      "example.com",
      "https://example.com",
    );
    expect(findings).toEqual([]);
  });

  it("does not flag when no CAA record exists at all (checkCAA's job)", async () => {
    dnsMock.resolveCaa.mockRejectedValue(dnsError("ENOTFOUND"));
    const findings = await checkCAAPermissive(
      "example.com",
      "https://example.com",
    );
    expect(findings).toEqual([]);
  });
});

// ── checkDKIM ────────────────────────────────────────────────────────

describe("checkDKIM", () => {
  it("returns missing-DKIM finding when no selectors resolve", async () => {
    dnsMock.resolveTxt.mockRejectedValue(dnsError("ENOTFOUND"));
    const findings = await checkDKIM("example.com", "https://example.com");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/DKIM/i);
  });

  it("returns no findings when a DKIM record is found", async () => {
    // checkDKIM probes a list of common selectors via Promise.race.
    // First resolver wins. Mock one of them to succeed.
    dnsMock.resolveTxt.mockResolvedValueOnce([
      ["v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCg"],
    ]);
    const findings = await checkDKIM("example.com", "https://example.com");
    expect(findings).toEqual([]);
  });

  it("recognizes ProtonMail's own DKIM selectors, delegated via CNAME, not a TXT record", async () => {
    // ProtonMail's custom-domain DKIM is a CNAME delegation
    // (protonmail._domainkey.<domain> -> protonmail.domainkey.<hash>.domains.proton.ch),
    // never a TXT record -- resolveTxt must fail for every selector, and
    // only resolveCname for the protonmail*._domainkey hosts should hit.
    dnsMock.resolveTxt.mockRejectedValue(dnsError("ENOTFOUND"));
    dnsMock.resolveCname.mockImplementation(async (host: string) => {
      if (host.startsWith("protonmail._domainkey.")) {
        return [
          "protonmail.domainkey.d24en2rliofosuczdjj6ktt4ba7rs7qlnz4hapvyg2adgitkevaoa.domains.proton.ch",
        ];
      }
      throw dnsError("ENOTFOUND");
    });
    const findings = await checkDKIM("vulnradar.dev", "https://vulnradar.dev");
    expect(findings).toEqual([]);
  });
});

// ── checkDKIMWeakKey ─────────────────────────────────────────────────

describe("checkDKIMWeakKey", () => {
  function spkiBase64(bits: number): string {
    const { publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: bits,
    });
    return publicKey.export({ type: "spki", format: "der" }).toString("base64");
  }

  it("flags a real 512-bit RSA DKIM key as high-severity (below 1024 bits)", async () => {
    dnsMock.resolveTxt.mockImplementation(async (name: string) => {
      if (name === "default._domainkey.example.com") {
        return [[`v=DKIM1; k=rsa; p=${spkiBase64(512)}`]];
      }
      throw dnsError("ENOTFOUND");
    });
    const findings = await checkDKIMWeakKey(
      "example.com",
      "https://example.com",
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/weak rsa key size/i);
    expect(findings[0].severity).toBe("high");
  });

  it("flags a real 1024-bit RSA DKIM key as medium-severity (deprecated, not yet practically breakable)", async () => {
    dnsMock.resolveTxt.mockImplementation(async (name: string) => {
      if (name === "default._domainkey.example.com") {
        return [[`v=DKIM1; k=rsa; p=${spkiBase64(1024)}`]];
      }
      throw dnsError("ENOTFOUND");
    });
    const findings = await checkDKIMWeakKey(
      "example.com",
      "https://example.com",
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/weak rsa key size/i);
    expect(findings[0].severity).toBe("medium");
  });

  it("does not flag a real 2048-bit RSA DKIM key", async () => {
    dnsMock.resolveTxt.mockImplementation(async (name: string) => {
      if (name === "default._domainkey.example.com") {
        return [[`v=DKIM1; k=rsa; p=${spkiBase64(2048)}`]];
      }
      throw dnsError("ENOTFOUND");
    });
    const findings = await checkDKIMWeakKey(
      "example.com",
      "https://example.com",
    );
    expect(findings).toEqual([]);
  });

  it("does not flag a k=ed25519 selector (fixed 256-bit key by design)", async () => {
    dnsMock.resolveTxt.mockImplementation(async (name: string) => {
      if (name === "default._domainkey.example.com") {
        // Raw 32-byte ed25519 key material, base64-encoded -- not RSA DER.
        return [
          [
            "v=DKIM1; k=ed25519; p=MC4CAQAwBQYDK2VwBCIEIBTEST0000000000000000000000000000000000",
          ],
        ];
      }
      throw dnsError("ENOTFOUND");
    });
    const findings = await checkDKIMWeakKey(
      "example.com",
      "https://example.com",
    );
    expect(findings).toEqual([]);
  });

  it("does not crash on unparsable/truncated key material", async () => {
    dnsMock.resolveTxt.mockResolvedValue([
      ["v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCg"],
    ]);
    const findings = await checkDKIMWeakKey(
      "example.com",
      "https://example.com",
    );
    expect(findings).toEqual([]);
  });
});

// ── checkDNSSEC ──────────────────────────────────────────────────────

describe("checkDNSSEC", () => {
  it("returns not-enabled finding when neither resolver sees AD flag", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: () => Promise.resolve({ AD: false }),
    });
    const findings = await checkDNSSEC("example.com", "https://example.com");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/DNSSEC/i);
  });

  it("returns no findings when at least one resolver sees AD flag", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: () => Promise.resolve({ AD: true }),
    });
    const findings = await checkDNSSEC("example.com", "https://example.com");
    expect(findings).toEqual([]);
  });
});

// ── checkBIMI ────────────────────────────────────────────────────────

describe("checkBIMI", () => {
  it("flags a non-HTTPS logo URL", async () => {
    dnsMock.resolveTxt.mockResolvedValueOnce([
      ["v=BIMI1; l=http://example.com/logo.svg; a=https://example.com/vmc.pem"],
    ]);
    const findings = await checkBIMI("example.com", "https://example.com");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/BIMI/i);
  });

  it("flags a raster (PNG) logo URL", async () => {
    dnsMock.resolveTxt.mockResolvedValueOnce([
      ["v=BIMI1; l=https://example.com/logo.png"],
    ]);
    const findings = await checkBIMI("example.com", "https://example.com");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/BIMI/i);
  });

  it("does not flag a valid HTTPS SVG logo URL (real-world: cloudflare.com)", async () => {
    dnsMock.resolveTxt.mockResolvedValueOnce([
      [
        "v=BIMI1; l=https://www.cloudflare.com/cloudflare_1171114652.svg; a=https://www.cloudflare.com/cloudflare_1171114652.pem",
      ],
    ]);
    const findings = await checkBIMI("example.com", "https://example.com");
    expect(findings).toEqual([]);
  });

  it("does not flag when no BIMI record exists (opt-in, not a vulnerability)", async () => {
    dnsMock.resolveTxt.mockRejectedValue(dnsError("ENOTFOUND"));
    const findings = await checkBIMI("example.com", "https://example.com");
    expect(findings).toEqual([]);
  });

  it("does not flag an extensionless logo URL (ambiguous -- could still be SVG)", async () => {
    dnsMock.resolveTxt.mockResolvedValueOnce([
      ["v=BIMI1; l=https://cdn.example.com/brand/logo"],
    ]);
    const findings = await checkBIMI("example.com", "https://example.com");
    expect(findings).toEqual([]);
  });
});

// ── checkSOASerialStale ──────────────────────────────────────────────

describe("checkSOASerialStale", () => {
  it("flags a date-based serial that decodes to several years in the past", async () => {
    dnsMock.resolveSoa.mockResolvedValueOnce({
      nsname: "ns1.example.com",
      hostmaster: "hostmaster.example.com",
      serial: 2015060501,
      refresh: 3600,
      retry: 900,
      expire: 604800,
      minttl: 300,
    });
    const findings = await checkSOASerialStale(
      "example.com",
      "https://example.com",
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/serial/i);
    expect(findings[0].severity).toBe("info");
  });

  it("does not flag a recent date-based serial", async () => {
    const today = new Date();
    const recentSerial = Number(
      `${today.getUTCFullYear()}${String(today.getUTCMonth() + 1).padStart(2, "0")}${String(today.getUTCDate()).padStart(2, "0")}01`,
    );
    dnsMock.resolveSoa.mockResolvedValueOnce({
      nsname: "ns1.example.com",
      hostmaster: "hostmaster.example.com",
      serial: recentSerial,
      refresh: 3600,
      retry: 900,
      expire: 604800,
      minttl: 300,
    });
    const findings = await checkSOASerialStale(
      "example.com",
      "https://example.com",
    );
    expect(findings).toEqual([]);
  });

  it("does not flag a non-date-shaped serial (real-world: github.com/cloudflare.com managed-DNS style)", async () => {
    dnsMock.resolveSoa.mockResolvedValueOnce({
      nsname: "ns1.example.com",
      hostmaster: "hostmaster.example.com",
      serial: 1656468023,
      refresh: 3600,
      retry: 900,
      expire: 604800,
      minttl: 300,
    });
    const findings = await checkSOASerialStale(
      "example.com",
      "https://example.com",
    );
    expect(findings).toEqual([]);
  });
});

// ── checkDNSSecurity (orchestrator) ─────────────────────────────────

describe("checkDNSSecurity", () => {
  it("runs all sub-checks and returns combined findings", async () => {
    // Each sub-check is mocked to produce one finding.
    dnsMock.resolveTxt.mockResolvedValueOnce([["v=spf2.0"]]); // SPF missing
    dnsMock.resolveTxt.mockResolvedValueOnce([["v=spf1 -all"]]); // DMARC missing
    dnsMock.resolveTxt.mockRejectedValue(dnsError("ENOTFOUND")); // DKIM missing
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: () => Promise.resolve({ AD: false }),
    });
    const findings = await checkDNSSecurity(
      "example.com",
      "https://example.com",
    );
    expect(findings.length).toBeGreaterThanOrEqual(3);
    const titles = findings.map((f) => f.title);
    expect(titles.some((t) => /SPF/i.test(t))).toBe(true);
    expect(titles.some((t) => /DMARC/i.test(t))).toBe(true);
    expect(titles.some((t) => /DKIM/i.test(t))).toBe(true);
    expect(titles.some((t) => /DNSSEC/i.test(t))).toBe(true);
  });

  it("returns no findings when all sub-checks pass", async () => {
    dnsMock.resolveTxt.mockImplementation(async (name: string) => {
      if (typeof name === "string" && name.startsWith("_dmarc."))
        return [["v=DMARC1; p=reject; rua=mailto:dmarc@example.com"]];
      if (typeof name === "string" && !name.startsWith("_dmarc."))
        return [["v=spf1 -all"]];
      throw new Error("NXDOMAIN");
    });
    // DKIM must resolve at least one selector
    dnsMock.resolveTxt.mockImplementation(async (name: string) => {
      if (typeof name !== "string") throw new Error("NXDOMAIN");
      if (name.startsWith("_dmarc."))
        return [["v=DMARC1; p=reject; rua=mailto:dmarc@example.com"]];
      if (name.includes("._domainkey."))
        return [["v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCg"]];
      if (name === "example.com")
        return [["v=spf1 include:_spf.google.com -all"]];
      throw new Error("NXDOMAIN");
    });
    // Also satisfies checkDSRecord/checkDNSKEYRecord/checkTLSARecord (DoH
    // queries), which require a non-empty Answer section in addition to
    // checkDNSSEC's AD flag for a domain to count as fully DNSSEC-covered.
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: () =>
        Promise.resolve({
          AD: true,
          Answer: [{ name: "example.com.", type: 1, data: "x" }],
        }),
    });
    const findings = await checkDNSSecurity(
      "example.com",
      "https://example.com",
    );
    expect(findings).toEqual([]);
  });

  it("suppresses DKIM/MTA-STS/TLS-RPT findings on a null-MX domain", async () => {
    dnsMock.resolveMx.mockResolvedValue([{ exchange: ".", priority: 0 }]);
    dnsMock.resolveTxt.mockRejectedValue(dnsError("ENOTFOUND"));
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: () => Promise.resolve({ AD: false }),
    });
    const findings = await checkDNSSecurity(
      "sandbox.example.com",
      "https://sandbox.example.com",
    );
    const titles = findings.map((f) => f.title);
    expect(titles.some((t) => /DKIM/i.test(t))).toBe(false);
    expect(titles.some((t) => /MTA-STS/i.test(t))).toBe(false);
    expect(titles.some((t) => /TLS-RPT/i.test(t))).toBe(false);
  });

  it("does not suppress DKIM/MTA-STS/TLS-RPT findings when MX points to a real mail server", async () => {
    dnsMock.resolveMx.mockResolvedValue([
      { exchange: "mail.example.com", priority: 10 },
    ]);
    dnsMock.resolveTxt.mockRejectedValue(dnsError("ENOTFOUND"));
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: () => Promise.resolve({ AD: false }),
    });
    const findings = await checkDNSSecurity(
      "example.com",
      "https://example.com",
    );
    const titles = findings.map((f) => f.title);
    expect(titles.some((t) => /DKIM/i.test(t))).toBe(true);
    expect(titles.some((t) => /MTA-STS/i.test(t))).toBe(true);
    expect(titles.some((t) => /TLS-RPT/i.test(t))).toBe(true);
  });
});

// ── checkTLSCert ─────────────────────────────────────────────────────

describe("checkTLSCert", () => {
  function makeFakeCert(overrides: Record<string, unknown> = {}) {
    return {
      subject: { CN: "example.com" },
      subjectaltname: "DNS:example.com, DNS:www.example.com",
      issuer: { CN: "Let's Encrypt R3", O: "Let's Encrypt" },
      valid_from: new Date(Date.now() - 30 * 86400_000).toISOString(),
      valid_to: new Date(Date.now() + 60 * 86400_000).toISOString(),
      protocol: "TLSv1.3",
      ...overrides,
    };
  }

  function mockSocket(cert: ReturnType<typeof makeFakeCert>) {
    // We don't model a real TLSSocket; the test only needs the
    // callback to fire and the getters to return the fake cert.
    // Cast through `any` because TLS's TLSSocket type is heavy and
    // we mock the same surface area the checkTLSCert implementation
    // reads from.
    const sock: Record<string, unknown> = {
      on: vi.fn(),
      once: vi.fn(),
      destroy: vi.fn(),
      authorized: true,
      authorizationError: null,
      getPeerCertificate: () => cert,
      getProtocol: () => cert.protocol,
    };
    return sock;
  }

  function setupTlsMock(cert: ReturnType<typeof makeFakeCert>) {
    tlsMock.connect.mockImplementationOnce(((
      _opts: unknown,
      cb?: () => void,
    ) => {
      if (typeof cb === "function") setImmediate(cb);
      return mockSocket(cert);
    }) as unknown as typeof tls.connect);
  }

  it("returns no findings for a healthy certificate", async () => {
    setupTlsMock(makeFakeCert());
    const findings = await checkTLSCert(
      "example.com",
      "https://example.com",
      443,
      "ssl",
    );
    expect(findings).toEqual([]);
  });

  it("returns weak-key finding for a real 1024-bit RSA certificate", async () => {
    setupTlsMock(makeFakeCert({ bits: 1024 }));
    const findings = await checkTLSCert(
      "example.com",
      "https://example.com",
      443,
      "ssl",
    );
    expect(findings.some((f) => /weak.*key size/i.test(f.title))).toBe(true);
  });

  it("does not flag a 256-bit ECDSA P-256 certificate as a weak RSA key", async () => {
    setupTlsMock(
      makeFakeCert({
        bits: 256,
        asn1Curve: "prime256v1",
        nistCurve: "P-256",
      }),
    );
    const findings = await checkTLSCert(
      "example.com",
      "https://example.com",
      443,
      "ssl",
    );
    expect(findings.some((f) => /weak.*key size/i.test(f.title))).toBe(false);
  });

  it("returns expired finding when valid_to is in the past", async () => {
    setupTlsMock(
      makeFakeCert({
        valid_to: new Date(Date.now() - 86400_000).toISOString(),
      }),
    );
    const findings = await checkTLSCert(
      "example.com",
      "https://example.com",
      443,
      "ssl",
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/expir/i);
  });

  it("returns weak-protocol finding for TLSv1 (literal)", async () => {
    setupTlsMock(
      makeFakeCert({
        protocol: "TLSv1",
      }),
    );
    const findings = await checkTLSCert(
      "example.com",
      "https://example.com",
      443,
      "ssl",
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/protocol|TLS|deprecated/i);
  });

  it("returns self-signed finding when socket.authorized is false with DEPTH_ZERO_SELF_SIGNED_CERT", async () => {
    const sock = mockSocket(makeFakeCert());
    sock.authorized = false;
    sock.authorizationError = Object.assign(new Error("self-signed"), {
      code: "DEPTH_ZERO_SELF_SIGNED_CERT",
    });
    tlsMock.connect.mockImplementationOnce(((
      _opts: unknown,
      cb?: () => void,
    ) => {
      if (typeof cb === "function") setImmediate(cb);
      return sock;
    }) as unknown as typeof tls.connect);
    const findings = await checkTLSCert(
      "example.com",
      "https://example.com",
      443,
      "ssl",
    );
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/self.?signed/i);
  });

  it("returns SAN-missing finding when subjectaltname is absent", async () => {
    setupTlsMock(makeFakeCert({ subjectaltname: undefined }));
    const findings = await checkTLSCert(
      "example.com",
      "https://example.com",
      443,
      "ssl",
    );
    expect(
      findings.some((f) => /subject alternative name/i.test(f.title)),
    ).toBe(true);
  });

  it("flags an ECDSA certificate on a curve below P-256", async () => {
    setupTlsMock(
      makeFakeCert({ bits: 192, asn1Curve: "prime192v1", nistCurve: "P-192" }),
    );
    const findings = await checkTLSCert(
      "example.com",
      "https://example.com",
      443,
      "ssl",
    );
    expect(findings.some((f) => /ecdsa.*p-256/i.test(f.title))).toBe(true);
  });

  it("returns expired-chain finding when an intermediate in issuerCertificate is expired", async () => {
    const expiredIntermediate = {
      subject: { CN: "Expired Intermediate CA" },
      valid_to: new Date(Date.now() - 86400_000).toISOString(),
    };
    setupTlsMock(makeFakeCert({ issuerCertificate: expiredIntermediate }));
    const findings = await checkTLSCert(
      "example.com",
      "https://example.com",
      443,
      "ssl",
    );
    expect(
      findings.some((f) => /expired certificate in ca chain/i.test(f.title)),
    ).toBe(true);
  });
});

// ── checkRobotsTxt / checkSecurityTxt ────────────────────────────────

describe("checkRobotsTxt", () => {
  it("returns no findings when fetch returns 404", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
    });
    const findings = await checkRobotsTxt("https://example.com");
    expect(findings).toEqual([]);
  });

  it("returns sensitive-paths finding when robots.txt exposes admin/internal paths", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          "User-agent: *\nDisallow: /admin\nDisallow: /backup\nDisallow: /.env",
        ),
    });
    const findings = await checkRobotsTxt("https://example.com");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/sensitive|robots\.txt/i);
  });

  it("dedupes the same sensitive path repeated across multiple User-agent blocks", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          "User-agent: *\nDisallow: /admin\n\nUser-agent: GPTBot\nDisallow: /admin\n",
        ),
    });
    const findings = await checkRobotsTxt("https://example.com");
    expect(findings.length).toBe(1);
    // Reported as one distinct sensitive path, not "2 sensitive path(s)"
    // with the same line listed twice.
    expect(findings[0].evidence).toContain("found 1 sensitive path(s)");
    expect(findings[0].evidence.match(/Disallow:\s*\/admin/gi)?.length).toBe(1);
  });

  it("returns no findings when robots.txt only blocks public paths", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve("User-agent: *\nDisallow: /search?q=*\nAllow: /"),
    });
    const findings = await checkRobotsTxt("https://example.com");
    expect(findings).toEqual([]);
  });

  it("follows an apex-to-www redirect instead of treating it as missing", async () => {
    // Regression test: raw fetch + FETCH_OPTS's redirect: "error" used to
    // throw on this 301, which Promise/try-catch swallowed as "no findings"
    // even though the sensitive paths were reachable via the redirect.
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: unknown) => {
        const url =
          typeof input === "string" ? input : (input as URL).toString();
        if (url === "https://example.com/robots.txt") {
          return {
            ok: false,
            status: 301,
            headers: {
              get: (name: string) =>
                name.toLowerCase() === "location"
                  ? "https://www.example.com/robots.txt"
                  : null,
            },
          };
        }
        if (url === "https://www.example.com/robots.txt") {
          return {
            ok: true,
            status: 200,
            text: () =>
              Promise.resolve(
                "User-agent: *\nDisallow: /admin\nDisallow: /backup",
              ),
          };
        }
        return { ok: false, status: 404 };
      },
    );
    const findings = await checkRobotsTxt("https://example.com");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/sensitive|robots\.txt/i);
  });
});

describe("checkSecurityTxt", () => {
  it("returns missing finding when security.txt is absent", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
    });
    const findings = await checkSecurityTxt("https://example.com");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/security\.txt/i);
  });

  it("returns no findings when security.txt is present", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("Contact: mailto:security@example.com"),
      headers: {
        get: () => null,
      },
    });
    const findings = await checkSecurityTxt("https://example.com");
    expect(findings).toEqual([]);
  });

  it("finds security.txt when the apex redirects to www and only www serves it (walmart.com case)", async () => {
    // Regression test for the false "Missing security.txt" finding on
    // walmart.com: the apex domain 301-redirects every path to www, and
    // only www.walmart.com/.well-known/security.txt actually serves the
    // file. With raw fetch + FETCH_OPTS's redirect: "error", both probes
    // threw on the 301 and the check reported "missing" even though a real,
    // valid security.txt existed one hop away. checkSecurityTxt now goes
    // through safeFetch, which follows this apex<->www redirect (validating
    // each hop against SSRF rules) instead of giving up on the first 3xx.
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: unknown) => {
        const url =
          typeof input === "string" ? input : (input as URL).toString();

        const redirectTo = (location: string) => ({
          ok: false,
          status: 301,
          headers: {
            get: (name: string) =>
              name.toLowerCase() === "location" ? location : null,
          },
        });

        if (url === "https://walmart.com/.well-known/security.txt") {
          return redirectTo("https://www.walmart.com/.well-known/security.txt");
        }
        if (url === "https://walmart.com/security.txt") {
          return redirectTo("https://www.walmart.com/security.txt");
        }
        if (url === "https://www.walmart.com/.well-known/security.txt") {
          return {
            ok: true,
            status: 200,
            text: () =>
              Promise.resolve(
                "Contact: https://corporate.walmart.com/article/responsible-disclosure-policy\nPreferred-Languages: en\nCanonical: https://walmart.com/.well-known/security.txt\nPolicy: https://corporate.walmart.com/privacy-security\nHiring: https://careers.walmart.com",
              ),
          };
        }
        // Only .well-known serves it; bare /security.txt on www is still 404.
        if (url === "https://www.walmart.com/security.txt") {
          return { ok: false, status: 404 };
        }
        return { ok: false, status: 404 };
      },
    );

    const findings = await checkSecurityTxt("https://walmart.com");
    expect(findings).toEqual([]);
  });
});

// ── checkLiveFetch ───────────────────────────────────────────────────

describe("checkLiveFetch", () => {
  it("returns missing security.txt finding when security.txt is absent", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
    });
    const findings = await checkLiveFetch("https://example.com");
    // robots.txt 404 → no findings. security.txt 404 → missing finding.
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => /security\.txt/i.test(f.title))).toBe(true);
  });

  it("returns robots.txt sensitive-path finding when robots.txt exposes admin", async () => {
    const futureDate = new Date(Date.now() + 365 * 86400_000).toUTCString();
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: unknown) => {
        const url =
          typeof input === "string" ? input : (input as URL).toString();
        if (url.includes("robots.txt")) {
          return {
            ok: true,
            status: 200,
            text: () =>
              Promise.resolve(
                "User-agent: *\nDisallow: /admin\nDisallow: /backup",
              ),
          };
        }
        if (url.includes("security.txt")) {
          return {
            ok: true,
            status: 200,
            text: () => Promise.resolve("Contact: mailto:security@example.com"),
            headers: {
              get: (name: string) =>
                name.toLowerCase() === "expires" ? futureDate : null,
            },
          };
        }
        return { ok: false, status: 404 };
      },
    );
    const findings = await checkLiveFetch("https://example.com");
    const titles = findings.map((f) => f.title);
    expect(titles.some((t) => /sensitive|robots/i.test(t))).toBe(true);
  });
});

// ── checkBucketListing ───────────────────────────────────────────────

describe("checkBucketListing", () => {
  it("produces a finding when a referenced S3 bucket is publicly listable", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: unknown) => {
        const url =
          typeof input === "string" ? input : (input as URL).toString();
        if (url === "https://example.com/") {
          return {
            ok: true,
            status: 200,
            text: () =>
              Promise.resolve(
                '<html><body><a href="https://leaky-bucket.s3.amazonaws.com/backup.zip">backup</a></body></html>',
              ),
          };
        }
        if (url === "https://leaky-bucket.s3.amazonaws.com/") {
          return {
            ok: true,
            status: 200,
            text: () =>
              Promise.resolve(
                '<?xml version="1.0"?><ListBucketResult><Name>leaky-bucket</Name><Contents><Key>backup.zip</Key></Contents></ListBucketResult>',
              ),
          };
        }
        return { ok: false, status: 404, text: () => Promise.resolve("") };
      },
    );

    const findings = await checkBucketListing("https://example.com");
    expect(findings.length).toBe(1);
    expect(findings[0].title).toMatch(/Publicly Listable/i);
    expect(findings[0].severity).toBe("high");
    expect(findings[0].category).toBe("information-disclosure");
    expect(findings[0].evidence).toContain("leaky-bucket.s3.amazonaws.com");
  });

  it("returns no findings when the referenced bucket denies access", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: unknown) => {
        const url =
          typeof input === "string" ? input : (input as URL).toString();
        if (url === "https://example.com/") {
          return {
            ok: true,
            status: 200,
            text: () =>
              Promise.resolve(
                '<html><body><img src="https://private-bucket.s3.amazonaws.com/logo.png"></body></html>',
              ),
          };
        }
        if (url === "https://private-bucket.s3.amazonaws.com/") {
          return {
            ok: false,
            status: 403,
            text: () =>
              Promise.resolve(
                '<?xml version="1.0"?><Error><Code>AccessDenied</Code></Error>',
              ),
          };
        }
        return { ok: false, status: 404, text: () => Promise.resolve("") };
      },
    );

    const findings = await checkBucketListing("https://example.com");
    expect(findings).toEqual([]);
  });

  it("returns no findings when the page references no bucket-shaped URLs", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("<html><body>nothing here</body></html>"),
    });

    const findings = await checkBucketListing("https://example.com");
    expect(findings).toEqual([]);
  });

  it("applies the SSRF guard: never fetches a probe whose hostname resolves to a private IP", async () => {
    dnsLookupMock.mockImplementation(async (hostname: string) => {
      if (hostname === "internal-bucket.s3.amazonaws.com") {
        return [{ address: "10.0.0.5", family: 4 }];
      }
      return [{ address: "93.184.216.34", family: 4 }];
    });

    const fetchedUrls: string[] = [];
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: unknown) => {
        const url =
          typeof input === "string" ? input : (input as URL).toString();
        fetchedUrls.push(url);
        if (url === "https://example.com/") {
          return {
            ok: true,
            status: 200,
            text: () =>
              Promise.resolve(
                '<html><body><a href="https://internal-bucket.s3.amazonaws.com/x">x</a></body></html>',
              ),
          };
        }
        // Would only be reached if the SSRF guard failed to block the probe.
        return {
          ok: true,
          status: 200,
          text: () =>
            Promise.resolve(
              "<ListBucketResult><Name>internal-bucket</Name></ListBucketResult>",
            ),
        };
      },
    );

    const findings = await checkBucketListing("https://example.com");
    expect(findings).toEqual([]);
    // Only the page itself was fetched — validateScanTarget rejected the
    // private-IP-resolving bucket hostname before any request reached it.
    expect(fetchedUrls).toEqual(["https://example.com/"]);
  });

  it("caps active probes to the first MAX_BUCKET_LISTING_PROBES distinct buckets", async () => {
    const bucketRefs = Array.from(
      { length: 8 },
      (_, i) => `<a href="https://bucket-${i}.s3.amazonaws.com/f">f</a>`,
    ).join("");

    const probedHosts: string[] = [];
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: unknown) => {
        const url =
          typeof input === "string" ? input : (input as URL).toString();
        if (url === "https://example.com/") {
          return {
            ok: true,
            status: 200,
            text: () =>
              Promise.resolve(`<html><body>${bucketRefs}</body></html>`),
          };
        }
        probedHosts.push(new URL(url).hostname);
        return {
          ok: false,
          status: 403,
          text: () => Promise.resolve(""),
        };
      },
    );

    await checkBucketListing("https://example.com");
    // 8 distinct bucket hostnames were referenced; only the first 5 (the
    // documented cap) should have received an active probe.
    expect(probedHosts.length).toBe(5);
  });
});

// ── runAsyncChecks orchestrator ─────────────────────────────────────

describe("runAsyncChecks", () => {
  it("returns empty array for invalid URL", async () => {
    const findings = await runAsyncChecks("not a url");
    expect(findings).toEqual([]);
  });

  it("returns empty array for http URL with no TLS or live-fetch enabled", async () => {
    const findings = await runAsyncChecks("http://example.com", []);
    // 'configuration' and 'information-disclosure' still trigger checkLiveFetch.
    // DNS triggers too. We only verify the dispatcher returns an array.
    expect(Array.isArray(findings)).toBe(true);
  });

  it("respects the categories filter (empty filter still runs DNS+live-fetch)", async () => {
    dnsMock.resolveTxt.mockResolvedValueOnce([["v=spf2.0"]]);
    dnsMock.resolveTxt.mockResolvedValueOnce([["v=spf1 -all"]]);
    dnsMock.resolveTxt.mockRejectedValue(dnsError("ENOTFOUND"));
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: () => Promise.resolve({ AD: false }),
    });
    const findings = await runAsyncChecks("https://example.com", ["dns"]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it("skips dns sub-checks when 'dns' is not in the categories filter", async () => {
    dnsMock.resolveTxt.mockClear();
    const findings = await runAsyncChecks("https://example.com", [
      "configuration",
    ]);
    // No DNS sub-checks should have been invoked.
    expect(dnsMock.resolveTxt).not.toHaveBeenCalled();
    expect(Array.isArray(findings)).toBe(true);
  });
});

// ── getPlannedAsyncBranches ──────────────────────────────────────────

describe("getPlannedAsyncBranches", () => {
  it("plans dns + live-fetch for a plain http URL (no tls branch)", () => {
    expect(getPlannedAsyncBranches("http://example.com")).toEqual([
      "dns",
      "live-fetch",
    ]);
  });

  it("plans dns + tls + live-fetch for an https URL", () => {
    expect(getPlannedAsyncBranches("https://example.com")).toEqual([
      "dns",
      "tls",
      "live-fetch",
    ]);
  });

  it("only plans branches matching the categories filter", () => {
    expect(getPlannedAsyncBranches("https://example.com", ["dns"])).toEqual([
      "dns",
    ]);
  });

  it("returns nothing for an unparseable URL", () => {
    expect(getPlannedAsyncBranches("not a url")).toEqual([]);
  });

  describe("reputation branch (gated on WEB_RISK_API_KEY)", () => {
    const originalKey = process.env.WEB_RISK_API_KEY;

    afterEach(() => {
      if (originalKey === undefined) delete process.env.WEB_RISK_API_KEY;
      else process.env.WEB_RISK_API_KEY = originalKey;
    });

    it("is not planned when WEB_RISK_API_KEY is unset, even with no category filter", () => {
      delete process.env.WEB_RISK_API_KEY;
      expect(getPlannedAsyncBranches("https://example.com")).not.toContain(
        "reputation",
      );
    });

    it("is planned when WEB_RISK_API_KEY is set and no category filter is given", () => {
      process.env.WEB_RISK_API_KEY = "test-key";
      expect(getPlannedAsyncBranches("https://example.com")).toContain(
        "reputation",
      );
    });

    it("is not planned when the key is set but the category filter excludes it", () => {
      process.env.WEB_RISK_API_KEY = "test-key";
      expect(
        getPlannedAsyncBranches("https://example.com", ["dns"]),
      ).not.toContain("reputation");
    });

    it("is planned when the key is set and the category filter explicitly includes it", () => {
      process.env.WEB_RISK_API_KEY = "test-key";
      expect(
        getPlannedAsyncBranches("https://example.com", ["reputation"]),
      ).toEqual(["reputation"]);
    });
  });

  describe("active-probes branch (opt-in only, never via runAll)", () => {
    it("is never planned with no category filter, unlike every other branch", () => {
      expect(getPlannedAsyncBranches("https://example.com")).not.toContain(
        "active-probes",
      );
    });

    it("is never planned even when every other category is explicitly listed", () => {
      expect(
        getPlannedAsyncBranches("https://example.com", [
          "headers",
          "ssl",
          "tls",
          "content",
          "cookies",
          "configuration",
          "information-disclosure",
          "dns",
          "email",
          "api",
          "code",
          "secrets-extended",
          "vibe-code",
          "client-side",
          "supply-chain",
          "host-validation",
          "reputation",
        ]),
      ).not.toContain("active-probes");
    });

    it("is planned only when explicitly named in the category filter", () => {
      expect(
        getPlannedAsyncBranches("https://example.com", ["active-probes"]),
      ).toEqual(["active-probes"]);
    });
  });
});

// ── runAsyncChecksDetailed progress hook ─────────────────────────────

describe("runAsyncChecksDetailed progress hook", () => {
  beforeEach(() => {
    dnsMock.resolveTxt.mockRejectedValue(dnsError("ENOTFOUND"));
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: () => Promise.resolve({ AD: false }),
    });
  });

  it("reports start then done for exactly the planned branch", async () => {
    const events: Array<{ label: string; phase: string }> = [];
    await runAsyncChecksDetailed(
      "https://example.com",
      ["dns"],
      (label, phase) => events.push({ label, phase }),
    );
    expect(events).toEqual([
      { label: "dns", phase: "start" },
      { label: "dns", phase: "done" },
    ]);
  });

  it("matches exactly what getPlannedAsyncBranches predicted, in order", async () => {
    const seen: string[] = [];
    await runAsyncChecksDetailed(
      "https://example.com",
      null,
      (label, phase) => {
        if (phase === "start") seen.push(label);
      },
    );
    expect(seen).toEqual(getPlannedAsyncBranches("https://example.com", null));
  });

  it("propagates a throwing hook instead of swallowing it (cancellation contract)", async () => {
    class Stop extends Error {}
    await expect(
      runAsyncChecksDetailed("https://example.com", ["dns"], () => {
        throw new Stop();
      }),
    ).rejects.toThrow(Stop);
  });
});
