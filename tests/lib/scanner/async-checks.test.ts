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

import * as dns from "dns/promises";
import * as tls from "tls";
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
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: () => Promise.resolve({ AD: true }),
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
      altNames: ["example.com", "www.example.com"],
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
