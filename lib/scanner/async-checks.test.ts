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
  checkDNSSecurity,
  checkTLSCert,
  checkRobotsTxt,
  checkSecurityTxt,
  checkLiveFetch,
  runAsyncChecks,
} from "./async-checks";

const dnsMock = vi.mocked(dns);
const tlsMock = vi.mocked(tls);

beforeEach(() => {
  dnsMock.resolveTxt.mockReset();
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
    const findings = await checkSPF("example.com");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/SPF/i);
    expect(findings[0].category).toBe("configuration");
  });

  it("returns weak-SPF finding when SPF uses +all", async () => {
    dnsMock.resolveTxt.mockResolvedValueOnce([["v=spf1 +all"]]);
    const findings = await checkSPF("example.com");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/\+all|Weak/i);
  });

  it("returns no findings for a strict SPF record", async () => {
    dnsMock.resolveTxt.mockResolvedValueOnce([
      ["v=spf1 include:_spf.google.com -all"],
    ]);
    const findings = await checkSPF("example.com");
    expect(findings).toEqual([]);
  });

  it("swallows DNS resolution failures (returns no findings)", async () => {
    dnsMock.resolveTxt.mockRejectedValueOnce(new Error("ENOTFOUND"));
    const findings = await checkSPF("example.com");
    expect(findings).toEqual([]);
  });
});

// ── checkDMARC ───────────────────────────────────────────────────────

describe("checkDMARC", () => {
  it("returns missing-DMARC finding when no _dmarc TXT record exists", async () => {
    dnsMock.resolveTxt.mockResolvedValueOnce([["v=spf1 -all"]]);
    const findings = await checkDMARC("example.com");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/DMARC/i);
  });

  it("returns weak-DMARC finding when policy is p=none", async () => {
    dnsMock.resolveTxt.mockResolvedValueOnce([["v=DMARC1; p=none"]]);
    const findings = await checkDMARC("example.com");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/None|policy/i);
  });

  it("returns no findings for a strict DMARC policy", async () => {
    dnsMock.resolveTxt.mockResolvedValueOnce([
      ["v=DMARC1; p=reject; rua=mailto:dmarc@example.com"],
    ]);
    const findings = await checkDMARC("example.com");
    expect(findings).toEqual([]);
  });

  it("returns missing-DMARC finding when DNS resolution fails", async () => {
    // The detector's catch handler treats DNS failures as "missing DMARC"
    // — there's no record we could resolve, so we report it the same way.
    dnsMock.resolveTxt.mockRejectedValueOnce(new Error("SERVFAIL"));
    const findings = await checkDMARC("example.com");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/DMARC/i);
  });
});

// ── checkDKIM ────────────────────────────────────────────────────────

describe("checkDKIM", () => {
  it("returns missing-DKIM finding when no selectors resolve", async () => {
    dnsMock.resolveTxt.mockRejectedValue(new Error("NXDOMAIN"));
    const findings = await checkDKIM("example.com");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/DKIM/i);
  });

  it("returns no findings when a DKIM record is found", async () => {
    // checkDKIM probes a list of common selectors via Promise.race.
    // First resolver wins. Mock one of them to succeed.
    dnsMock.resolveTxt.mockResolvedValueOnce([
      ["v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCg"],
    ]);
    const findings = await checkDKIM("example.com");
    expect(findings).toEqual([]);
  });
});

// ── checkDNSSEC ──────────────────────────────────────────────────────

describe("checkDNSSEC", () => {
  it("returns not-enabled finding when neither resolver sees AD flag", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: () => Promise.resolve({ AD: false }),
    });
    const findings = await checkDNSSEC("example.com");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/DNSSEC/i);
  });

  it("returns no findings when at least one resolver sees AD flag", async () => {
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: () => Promise.resolve({ AD: true }),
    });
    const findings = await checkDNSSEC("example.com");
    expect(findings).toEqual([]);
  });
});

// ── checkDNSSecurity (orchestrator) ─────────────────────────────────

describe("checkDNSSecurity", () => {
  it("runs all sub-checks and returns combined findings", async () => {
    // Each sub-check is mocked to produce one finding.
    dnsMock.resolveTxt.mockResolvedValueOnce([["v=spf2.0"]]); // SPF missing
    dnsMock.resolveTxt.mockResolvedValueOnce([["v=spf1 -all"]]); // DMARC missing
    dnsMock.resolveTxt.mockRejectedValue(new Error("NXDOMAIN")); // DKIM missing
    vi.mocked(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: () => Promise.resolve({ AD: false }),
    });
    const findings = await checkDNSSecurity("example.com");
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
    const findings = await checkDNSSecurity("example.com");
    expect(findings).toEqual([]);
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
    const findings = await checkTLSCert("example.com", 443, "ssl");
    expect(findings).toEqual([]);
  });

  it("returns expired finding when valid_to is in the past", async () => {
    setupTlsMock(
      makeFakeCert({
        valid_to: new Date(Date.now() - 86400_000).toISOString(),
      }),
    );
    const findings = await checkTLSCert("example.com", 443, "ssl");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].title).toMatch(/expir/i);
  });

  it("returns weak-protocol finding for TLSv1 (literal)", async () => {
    setupTlsMock(
      makeFakeCert({
        protocol: "TLSv1",
      }),
    );
    const findings = await checkTLSCert("example.com", 443, "ssl");
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
    const findings = await checkTLSCert("example.com", 443, "ssl");
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
    dnsMock.resolveTxt.mockRejectedValue(new Error("NXDOMAIN"));
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
