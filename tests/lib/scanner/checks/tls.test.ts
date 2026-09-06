/**
 * Tests for the live-connection probes in lib/scanner/checks/tls.ts:
 *
 *   - checkHttpUpgradeToHttps: raw HTTP request against a real local
 *     server (no `tls` mocking needed here -- only `validateScanTarget`
 *     is mocked, since 127.0.0.1 is otherwise correctly rejected as a
 *     private target by the real SSRF guard).
 *   - checkTlsCertChainCompleteness / checkOcspStapling: mock Node's
 *     `tls` module the same way tests/lib/scanner/async-checks.test.ts
 *     mocks it for checkTLSCert, since these need to control
 *     `socket.authorized` / the peer certificate / the 'OCSPResponse'
 *     event precisely.
 *
 * The `detectors` placeholder export (always-null, async-only category)
 * is also smoke-tested so a future accidental real implementation
 * pasted into that map doesn't silently stop being a placeholder.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as http from "http";
import type { AddressInfo } from "net";

vi.mock("tls", () => ({
  default: { connect: vi.fn() },
  connect: vi.fn(),
}));

vi.mock("@/lib/scanner/safe-fetch", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/scanner/safe-fetch")>();
  return {
    ...actual,
    validateScanTarget: vi.fn(),
  };
});

import * as tls from "tls";
import { validateScanTarget } from "@/lib/scanner/safe-fetch";
import {
  checkHttpUpgradeToHttps,
  checkTlsCertChainCompleteness,
  checkOcspStapling,
  checkTlsHandshakeDetails,
  checkLegacyTlsProtocolAccepted,
  detectors,
} from "@/lib/scanner/checks/tls";

const tlsMock = vi.mocked(tls);
const validateScanTargetMock = vi.mocked(validateScanTarget);

beforeEach(() => {
  tlsMock.connect.mockReset();
  validateScanTargetMock.mockReset();
  validateScanTargetMock.mockResolvedValue({
    safe: true,
    resolvedIp: "127.0.0.1",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── checkHttpUpgradeToHttps ─────────────────────────────────────────────

function listen(handler: http.RequestListener): Promise<{
  port: number;
  server: http.Server;
}> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ port, server });
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("checkHttpUpgradeToHttps", () => {
  it("skips non-http:// URLs entirely", async () => {
    const findings = await checkHttpUpgradeToHttps("https://example.com/");
    expect(findings).toEqual([]);
  });

  it("skips when validateScanTarget rejects the target (SSRF guard)", async () => {
    validateScanTargetMock.mockResolvedValue({
      safe: false,
      reason: "blocked",
    });
    const { server, port } = await listen((_req, res) => {
      res.writeHead(200);
      res.end("hello");
    });
    try {
      const findings = await checkHttpUpgradeToHttps(
        `http://example.com:${port}/`,
      );
      expect(findings).toEqual([]);
    } finally {
      await close(server);
    }
  });

  it("fires when the server serves content directly on :80 with no redirect", async () => {
    const { server, port } = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html>hello</html>");
    });
    try {
      const findings = await checkHttpUpgradeToHttps(
        `http://example.com:${port}/`,
      );
      expect(findings.length).toBe(1);
      expect(findings[0].title).toMatch(/without upgrading/i);
      expect(findings[0].evidence).toMatch(/200/);
      expect(findings[0].category).toBe("tls");
    } finally {
      await close(server);
    }
  });

  it("does not fire when the first hop redirects straight to https://", async () => {
    const { server, port } = await listen((_req, res) => {
      res.writeHead(301, { Location: "https://example.com/" });
      res.end();
    });
    try {
      const findings = await checkHttpUpgradeToHttps(
        `http://example.com:${port}/`,
      );
      expect(findings).toEqual([]);
    } finally {
      await close(server);
    }
  });

  it("fires when the first hop redirects to another plain-http:// URL", async () => {
    const { server, port } = await listen((_req, res) => {
      res.writeHead(302, { Location: `http://example.com:${port}/other` });
      res.end();
    });
    try {
      const findings = await checkHttpUpgradeToHttps(
        `http://example.com:${port}/`,
      );
      expect(findings.length).toBe(1);
      expect(findings[0].title).toMatch(/does not redirect to https/i);
    } finally {
      await close(server);
    }
  });

  it("does not fire when there is no listener at all on the port (connection refused)", async () => {
    // Nothing is listening on this port -- ECONNREFUSED. No cleartext
    // service exists at all, which is not a downgrade risk.
    const findings = await checkHttpUpgradeToHttps("http://example.com:1/");
    expect(findings).toEqual([]);
  });
});

// ── checkTlsCertChainCompleteness ───────────────────────────────────────

function mockChainSocket(overrides: {
  authorized?: boolean;
  cert?: Record<string, unknown>;
}) {
  const cert = {
    subject: { CN: "example.com" },
    issuer: { CN: "Some Intermediate CA" },
    ...overrides.cert,
  };
  const sock: Record<string, unknown> = {
    on: vi.fn(),
    destroy: vi.fn(),
    authorized: overrides.authorized ?? true,
    getPeerCertificate: () => cert,
  };
  return sock;
}

function setupChainConnect(sock: Record<string, unknown>) {
  tlsMock.connect.mockImplementationOnce(((_opts: unknown, cb?: () => void) => {
    if (typeof cb === "function") setImmediate(cb);
    return sock;
  }) as unknown as typeof tls.connect);
}

describe("checkTlsCertChainCompleteness", () => {
  it("fires when verification succeeded but no intermediate was sent", async () => {
    // Node's getPeerCertificate(true) terminates a leaf-only peer chain
    // with a truthy but EMPTY object (no valid_to), not undefined -- the
    // exact shape the check must treat as an incomplete chain.
    setupChainConnect(
      mockChainSocket({ authorized: true, cert: { issuerCertificate: {} } }),
    );
    const findings = await checkTlsCertChainCompleteness(
      "example.com",
      "https://example.com",
      443,
    );
    expect(findings.length).toBe(1);
    expect(findings[0].title).toMatch(/missing intermediate/i);
    expect(findings[0].severity).toBe("medium");
  });

  it("does not fire when the server sent a real intermediate certificate", async () => {
    setupChainConnect(
      mockChainSocket({
        authorized: true,
        cert: {
          // A real chained cert carries real fields (valid_to); that is
          // how it is distinguished from the empty end-of-chain marker.
          issuerCertificate: {
            subject: { CN: "Some Intermediate CA" },
            issuer: { CN: "Some Root CA" },
            valid_to: "Dec 31 23:59:59 2035 GMT",
          },
        },
      }),
    );
    const findings = await checkTlsCertChainCompleteness(
      "example.com",
      "https://example.com",
      443,
    );
    expect(findings).toEqual([]);
  });

  it("does not fire when the connection was not authorized (already covered elsewhere)", async () => {
    setupChainConnect(mockChainSocket({ authorized: false }));
    const findings = await checkTlsCertChainCompleteness(
      "example.com",
      "https://example.com",
      443,
    );
    expect(findings).toEqual([]);
  });
});

// ── checkOcspStapling ────────────────────────────────────────────────────

/**
 * `ocspUri` decides whether the check can produce a finding at all.
 *
 * A server can only staple a response it can fetch, and it fetches it from the
 * OCSP URI in the certificate Authority Information Access extension. A
 * certificate that names no responder cannot be stapled by any configuration,
 * so there is nothing to report: telling that operator to turn on
 * ssl_stapling is advice that cannot work, and saying no action is available
 * is not a finding.
 */
function mockOcspSocket(
  authorized = true,
  ocspUri: string | null = "http://ocsp.example.com",
) {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const sock: Record<string, unknown> = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      handlers[event] = cb;
    }),
    destroy: vi.fn(),
    authorized,
    getPeerCertificate: vi.fn(() => ({
      infoAccess: ocspUri ? { "OCSP - URI": [ocspUri] } : {},
    })),
  };
  return { sock, handlers };
}

describe("checkOcspStapling", () => {
  it("reports nothing when the certificate names no OCSP responder", async () => {
    // Verified against vulnradar.dev, whose certificate reports infoAccess
    // with no "OCSP - URI" entry. Stapling is impossible for that
    // certificate at any server configuration, so there is nothing
    // misconfigured to report. Let's Encrypt removed the OCSP URL from its
    // certificates in May 2025 and shut its responders off that August, so
    // this is now most of the web, and revocation travels by CRL instead.
    // The check used to emit an info finding here whose own fix steps said
    // no action was available.
    const { sock } = mockOcspSocket(true, null);
    tlsMock.connect.mockImplementationOnce(((
      _opts: unknown,
      cb: () => void,
    ) => {
      setImmediate(cb);
      return sock as unknown as import("node:tls").TLSSocket;
    }) as unknown as typeof tlsMock.connect);

    const out = await checkOcspStapling("example.com", "https://example.com");

    expect(out).toEqual([]);
  });

  it("fires when the cert is valid but no OCSP response was stapled", async () => {
    const { sock } = mockOcspSocket(true);
    tlsMock.connect.mockImplementationOnce(((
      _opts: unknown,
      cb?: () => void,
    ) => {
      setImmediate(() => cb?.());
      return sock;
    }) as unknown as typeof tls.connect);

    const findings = await checkOcspStapling(
      "example.com",
      "https://example.com",
      443,
    );
    expect(findings.length).toBe(1);
    expect(findings[0].title).toMatch(/ocsp stapling not enabled/i);
    expect(findings[0].severity).toBe("info");
  });

  it("does not fire when a stapled OCSP response was received during the handshake", async () => {
    const { sock, handlers } = mockOcspSocket(true);
    tlsMock.connect.mockImplementationOnce(((
      _opts: unknown,
      cb?: () => void,
    ) => {
      setImmediate(() => {
        // Simulate the server stapling a response before the handshake
        // completes -- the real 'OCSPResponse' event fires before
        // 'secureConnect' does.
        handlers["OCSPResponse"]?.(Buffer.from("fake-der-ocsp-response"));
        cb?.();
      });
      return sock;
    }) as unknown as typeof tls.connect);

    const findings = await checkOcspStapling(
      "example.com",
      "https://example.com",
      443,
    );
    expect(findings).toEqual([]);
  });

  it("does not fire when the certificate itself did not verify", async () => {
    const { sock } = mockOcspSocket(false);
    tlsMock.connect.mockImplementationOnce(((
      _opts: unknown,
      cb?: () => void,
    ) => {
      setImmediate(() => cb?.());
      return sock;
    }) as unknown as typeof tls.connect);

    const findings = await checkOcspStapling(
      "example.com",
      "https://example.com",
      443,
    );
    expect(findings).toEqual([]);
  });
});

// ── detectors placeholder map ────────────────────────────────────────────

describe("detectors (async-only placeholders)", () => {
  it("every entry returns null -- real detection happens in the live probes above, not here", () => {
    for (const fn of Object.values(detectors)) {
      expect(fn("https://example.com/", new Headers(), "")).toBeNull();
    }
  });

  it("includes an entry for each new async check id", () => {
    expect(detectors["tls-http-no-https-upgrade"]).toBeTypeOf("function");
    expect(detectors["tls-cert-chain-incomplete"]).toBeTypeOf("function");
    expect(detectors["tls-ocsp-stapling-disabled"]).toBeTypeOf("function");
  });
});

// ── checkTlsHandshakeDetails ────────────────────────────────────────────
//
// One handshake produces ten separate checks, so these tests drive the same
// fake socket with different certificate / cipher / ephemeral-key facts and
// assert on the finding ids that come out. Every case pairs a "fires" with a
// "does not fire on a well-configured host", which is what keeps these off
// ordinary sites.

/** A DER blob containing `oidHex` at a known offset, so certContains hits. */
function certWith(...oidHex: string[]): Buffer {
  return Buffer.concat([
    Buffer.from("30820100", "hex"),
    ...oidHex.map((h) => Buffer.from(h, "hex")),
    Buffer.from("0000", "hex"),
  ]);
}

const SHA1_RSA_OID = "06092a864886f70d010105";
const SHA256_RSA_OID = "06092a864886f70d01010b";
const SCT_LIST_OID = "060a2b06010401d679020402";
const MUST_STAPLE_DER = "06082b0601050507011804053003020105";

/** Certificate facts for a well-configured host: nothing should fire on it. */
function healthyCert(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    subject: { CN: "example.com" },
    issuer: { CN: "Example CA R3" },
    subjectaltname: "DNS:example.com, DNS:www.example.com",
    serialNumber: "03A1B2C3D4E5F60718293A4B5C6D7E8F",
    valid_from: new Date(now - 10 * 86400_000).toUTCString(),
    valid_to: new Date(now + 80 * 86400_000).toUTCString(),
    raw: certWith(SHA256_RSA_OID, SCT_LIST_OID),
    issuerCertificate: {
      subject: { CN: "Example CA R3" },
      issuer: { CN: "Example Root" },
      valid_to: new Date(now + 3650 * 86400_000).toUTCString(),
      raw: certWith(SHA256_RSA_OID),
    },
    ...overrides,
  };
}

interface HandshakeMock {
  authorized?: boolean;
  cert?: Record<string, unknown>;
  cipher?: { name?: string; standardName?: string; version?: string } | null;
  ephemeral?: { type?: string; name?: string; size?: number } | null;
  protocol?: string | null;
  stapleResponse?: Buffer | null;
}

function setupHandshake(mock: HandshakeMock) {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const sock: Record<string, unknown> = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      handlers[event] = cb;
    }),
    destroy: vi.fn(),
    authorized: mock.authorized ?? true,
    getPeerCertificate: () => mock.cert ?? healthyCert(),
    getCipher: () =>
      mock.cipher === undefined
        ? {
            name: "TLS_AES_128_GCM_SHA256",
            standardName: "TLS_AES_128_GCM_SHA256",
            version: "TLSv1.3",
          }
        : mock.cipher,
    getEphemeralKeyInfo: () =>
      mock.ephemeral === undefined
        ? { type: "ECDH", name: "X25519", size: 253 }
        : mock.ephemeral,
    getProtocol: () =>
      mock.protocol === undefined ? "TLSv1.3" : mock.protocol,
  };
  tlsMock.connect.mockImplementationOnce(((_opts: unknown, cb?: () => void) => {
    setImmediate(() => {
      if (mock.stapleResponse) handlers["OCSPResponse"]?.(mock.stapleResponse);
      cb?.();
    });
    return sock;
  }) as unknown as typeof tls.connect);
}

async function handshakeIds(mock: HandshakeMock): Promise<string[]> {
  setupHandshake(mock);
  const findings = await checkTlsHandshakeDetails(
    "example.com",
    "https://example.com",
    443,
  );
  return findings.map((f) => f.id.split("--")[0]);
}

describe("checkTlsHandshakeDetails", () => {
  it("reports nothing at all against a well-configured host", async () => {
    expect(await handshakeIds({})).toEqual([]);
  });

  it("reports nothing when the certificate did not verify (checkTLSCert's job)", async () => {
    const ids = await handshakeIds({
      authorized: false,
      cert: healthyCert({ raw: certWith(SHA1_RSA_OID) }),
    });
    expect(ids).toEqual([]);
  });

  it("flags a SHA-1 signature anywhere in the served chain", async () => {
    const ids = await handshakeIds({
      cert: healthyCert({ raw: certWith(SHA1_RSA_OID, SCT_LIST_OID) }),
    });
    expect(ids).toContain("tls-cert-signature-algorithm-weak");
  });

  it("does not treat a self-signed root's own SHA-1 signature as a finding", async () => {
    // Node marks the end of the chain with a self-referential node; a root
    // is trusted by identity, so its signature algorithm is not evaluated.
    const root: Record<string, unknown> = {
      subject: { CN: "Example Root" },
      issuer: { CN: "Example Root" },
      valid_to: new Date(Date.now() + 3650 * 86400_000).toUTCString(),
      raw: certWith(SHA1_RSA_OID),
    };
    root.issuerCertificate = root;
    const ids = await handshakeIds({
      cert: healthyCert({ issuerCertificate: root }),
    });
    expect(ids).not.toContain("tls-cert-signature-algorithm-weak");
  });

  it("flags a validity window longer than 398 days", async () => {
    const now = Date.now();
    const ids = await handshakeIds({
      cert: healthyCert({
        valid_from: new Date(now - 10 * 86400_000).toUTCString(),
        valid_to: new Date(now + 700 * 86400_000).toUTCString(),
      }),
    });
    expect(ids).toContain("tls-cert-validity-period-excessive");
  });

  it("does not flag a 90-day certificate", async () => {
    expect(await handshakeIds({})).not.toContain(
      "tls-cert-validity-period-excessive",
    );
  });

  it("flags a certificate whose notBefore is in the future", async () => {
    const now = Date.now();
    const ids = await handshakeIds({
      cert: healthyCert({
        valid_from: new Date(now + 5 * 86400_000).toUTCString(),
        valid_to: new Date(now + 90 * 86400_000).toUTCString(),
      }),
    });
    expect(ids).toContain("tls-cert-not-yet-valid");
  });

  it("flags a certificate covering more than fifty names", async () => {
    const many = Array.from({ length: 60 }, (_, i) => `DNS:h${i}.example.com`);
    const ids = await handshakeIds({
      cert: healthyCert({ subjectaltname: many.join(", ") }),
    });
    expect(ids).toContain("tls-cert-san-count-excessive");
  });

  it("does not flag an ordinary two-name certificate", async () => {
    expect(await handshakeIds({})).not.toContain(
      "tls-cert-san-count-excessive",
    );
  });

  it("flags a serial number below 64 bits", async () => {
    const ids = await handshakeIds({
      cert: healthyCert({ serialNumber: "0A1B2C3D" }),
    });
    expect(ids).toContain("tls-cert-serial-low-entropy");
  });

  it("does not flag a 128-bit serial number", async () => {
    expect(await handshakeIds({})).not.toContain("tls-cert-serial-low-entropy");
  });

  it("flags a certificate with no embedded SCT extension", async () => {
    const ids = await handshakeIds({
      cert: healthyCert({ raw: certWith(SHA256_RSA_OID) }),
    });
    expect(ids).toContain("tls-cert-no-embedded-sct");
  });

  it("does not flag a certificate that carries embedded SCTs", async () => {
    expect(await handshakeIds({})).not.toContain("tls-cert-no-embedded-sct");
  });

  it("flags must-staple declared with nothing stapled", async () => {
    const ids = await handshakeIds({
      cert: healthyCert({
        raw: certWith(SHA256_RSA_OID, SCT_LIST_OID, MUST_STAPLE_DER),
      }),
    });
    expect(ids).toContain("tls-must-staple-not-stapled");
  });

  it("does not flag must-staple when a response really was stapled", async () => {
    const ids = await handshakeIds({
      cert: healthyCert({
        raw: certWith(SHA256_RSA_OID, SCT_LIST_OID, MUST_STAPLE_DER),
      }),
      stapleResponse: Buffer.from("der-ocsp"),
    });
    expect(ids).not.toContain("tls-must-staple-not-stapled");
  });

  it("flags a static-RSA suite with no forward secrecy", async () => {
    const ids = await handshakeIds({
      protocol: "TLSv1.2",
      cipher: {
        name: "AES128-SHA256",
        standardName: "TLS_RSA_WITH_AES_128_CBC_SHA256",
        version: "TLSv1.2",
      },
    });
    expect(ids).toContain("tls-cipher-no-forward-secrecy");
    // The static-RSA branch wins outright: a suite is reported once, not
    // twice under two different cipher findings.
    expect(ids).not.toContain("tls-cipher-cbc-mode");
  });

  it("flags an ECDHE CBC suite as CBC, not as missing forward secrecy", async () => {
    const ids = await handshakeIds({
      protocol: "TLSv1.2",
      cipher: {
        name: "ECDHE-RSA-AES128-SHA256",
        standardName: "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256",
        version: "TLSv1.2",
      },
    });
    expect(ids).toContain("tls-cipher-cbc-mode");
    expect(ids).not.toContain("tls-cipher-no-forward-secrecy");
  });

  it("reports no cipher finding on a TLS 1.3 AEAD handshake", async () => {
    const ids = await handshakeIds({});
    expect(ids).not.toContain("tls-cipher-cbc-mode");
    expect(ids).not.toContain("tls-cipher-no-forward-secrecy");
  });

  it("reports no cipher finding on a TLS 1.2 ECDHE GCM handshake", async () => {
    const ids = await handshakeIds({
      protocol: "TLSv1.2",
      cipher: {
        name: "ECDHE-RSA-AES128-GCM-SHA256",
        standardName: "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
        version: "TLSv1.2",
      },
    });
    expect(ids).toEqual([]);
  });

  it("flags a 1024-bit finite-field DH group", async () => {
    const ids = await handshakeIds({
      protocol: "TLSv1.2",
      cipher: {
        name: "DHE-RSA-AES128-GCM-SHA256",
        standardName: "TLS_DHE_RSA_WITH_AES_128_GCM_SHA256",
        version: "TLSv1.2",
      },
      ephemeral: { type: "DH", size: 1024 },
    });
    expect(ids).toContain("tls-ephemeral-key-weak");
  });

  it("does not flag X25519", async () => {
    expect(await handshakeIds({})).not.toContain("tls-ephemeral-key-weak");
  });
});

// ── checkLegacyTlsProtocolAccepted ──────────────────────────────────────

describe("checkLegacyTlsProtocolAccepted", () => {
  it("fires when a handshake restricted to TLS 1.0/1.1 completes", async () => {
    const sock: Record<string, unknown> = {
      on: vi.fn(),
      destroy: vi.fn(),
      getProtocol: () => "TLSv1.1",
    };
    tlsMock.connect.mockImplementationOnce(((
      opts: Record<string, unknown>,
      cb?: () => void,
    ) => {
      // The whole point of the probe is the version ceiling it offers.
      expect(opts.minVersion).toBe("TLSv1");
      expect(opts.maxVersion).toBe("TLSv1.1");
      setImmediate(() => cb?.());
      return sock;
    }) as unknown as typeof tls.connect);

    const findings = await checkLegacyTlsProtocolAccepted(
      "example.com",
      "https://example.com",
      443,
    );
    expect(findings.length).toBe(1);
    expect(findings[0].id.split("--")[0]).toBe("tls-legacy-protocol-accepted");
    expect(findings[0].severity).toBe("medium");
    expect(findings[0].evidence).toContain("TLSv1.1");
  });

  it("reports nothing when the legacy handshake is refused", async () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const sock: Record<string, unknown> = {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        handlers[event] = cb;
      }),
      destroy: vi.fn(),
    };
    tlsMock.connect.mockImplementationOnce(((_opts: unknown) => {
      setImmediate(() =>
        handlers["error"]?.(new Error("wrong version number")),
      );
      return sock;
    }) as unknown as typeof tls.connect);

    const findings = await checkLegacyTlsProtocolAccepted(
      "example.com",
      "https://example.com",
      443,
    );
    // Deliberately asymmetric: a refused handshake is NOT reported as
    // "legacy protocols are disabled", because this client's own TLS stack
    // may be what refused it.
    expect(findings).toEqual([]);
  });

  it("reports nothing when the SSRF guard rejects the target", async () => {
    validateScanTargetMock.mockResolvedValueOnce({ safe: false } as Awaited<
      ReturnType<typeof validateScanTarget>
    >);
    const findings = await checkLegacyTlsProtocolAccepted(
      "example.com",
      "https://example.com",
      443,
    );
    expect(findings).toEqual([]);
    expect(tlsMock.connect).not.toHaveBeenCalled();
  });
});
