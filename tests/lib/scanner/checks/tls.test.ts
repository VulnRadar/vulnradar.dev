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
    setupChainConnect(mockChainSocket({ authorized: true }));
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
          issuerCertificate: {
            subject: { CN: "Some Intermediate CA" },
            issuer: { CN: "Some Root CA" },
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

function mockOcspSocket(authorized = true) {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const sock: Record<string, unknown> = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      handlers[event] = cb;
    }),
    destroy: vi.fn(),
    authorized,
  };
  return { sock, handlers };
}

describe("checkOcspStapling", () => {
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
