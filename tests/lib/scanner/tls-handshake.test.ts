import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("tls", () => ({
  default: { connect: vi.fn() },
  connect: vi.fn(),
}));

// async-checks.ts reaches the settings layer and the pool at import time.
vi.mock("@/lib/database/db", () => ({ default: { query: vi.fn() } }));
vi.mock("@/lib/config/runtime-config", async () => {
  const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");
  return {
    getSetting: vi.fn(
      async (key: keyof typeof SETTINGS_REGISTRY) =>
        SETTINGS_REGISTRY[key].default,
    ),
  };
});

const mockValidate = vi.fn();
vi.mock("@/lib/scanner/safe-fetch", () => ({
  validateScanTarget: (...args: unknown[]) => mockValidate(...args),
}));

import * as tls from "tls";
import { readTlsHandshake } from "@/lib/scanner/tls-handshake";
import {
  checkOcspStapling,
  checkTlsCertChainCompleteness,
  checkTlsHandshakeDetails,
} from "@/lib/scanner/checks/tls";
import { checkTLSCert } from "@/lib/scanner/async-checks";

const tlsMock = vi.mocked(tls);

type Handlers = Record<string, (...args: unknown[]) => void>;

/** A socket that completes its handshake on the next tick, optionally
 *  stapling an OCSP response first, the order Node fires them in. */
function answeringSocket({ staple }: { staple?: Buffer } = {}) {
  const handlers: Handlers = {};
  const socket = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      handlers[event] = cb;
    }),
    destroy: vi.fn(),
    authorized: true,
    authorizationError: null,
    getPeerCertificate: () => ({
      subject: { CN: "example.com" },
      issuer: { CN: "Example CA" },
      subjectaltname: "DNS:example.com",
      valid_to: new Date(Date.now() + 90 * 86400000).toUTCString(),
      bits: 2048,
      issuerCertificate: { valid_to: "later", subject: { CN: "Example CA" } },
      infoAccess: {},
    }),
    getProtocol: () => "TLSv1.3",
    getCipher: () => ({ name: "TLS_AES_128_GCM_SHA256", version: "TLSv1.3" }),
    getEphemeralKeyInfo: () => ({ type: "ECDH", name: "X25519", size: 253 }),
  };
  tlsMock.connect.mockImplementation(((_opts: unknown, cb?: () => void) => {
    setImmediate(() => {
      if (staple) handlers["OCSPResponse"]?.(staple);
      cb?.();
    });
    return socket;
  }) as unknown as typeof tls.connect);
  return socket;
}

beforeEach(() => {
  tlsMock.connect.mockReset();
  mockValidate.mockReset();
  mockValidate.mockResolvedValue({ safe: true, resolvedIp: "93.184.216.34" });
});

describe("readTlsHandshake", () => {
  it("gives every TLS check running together the same single handshake", async () => {
    // The four checks used to open four connections and validate the target
    // four times, and behind a CDN could each read a different certificate.
    answeringSocket();
    await Promise.all([
      checkTLSCert("example.com", "https://example.com", 443, "ssl"),
      checkTlsCertChainCompleteness("example.com", "https://example.com", 443),
      checkOcspStapling("example.com", "https://example.com", 443),
      checkTlsHandshakeDetails("example.com", "https://example.com", 443),
    ]);
    expect(tlsMock.connect).toHaveBeenCalledTimes(1);
    expect(mockValidate).toHaveBeenCalledTimes(1);
  });

  it("does not keep an answer once it has settled", async () => {
    answeringSocket();
    await readTlsHandshake("example.com", "https://example.com");
    await readTlsHandshake("example.com", "https://example.com");
    expect(tlsMock.connect).toHaveBeenCalledTimes(2);
  });

  it("pins the connection to the validated IP and keeps the hostname for SNI", async () => {
    answeringSocket();
    await readTlsHandshake("example.com", "https://example.com");
    const opts = tlsMock.connect.mock.calls[0][0] as Record<string, unknown>;
    expect(opts.host).toBe("93.184.216.34");
    expect(opts.servername).toBe("example.com");
    expect(opts.requestOCSP).toBe(true);
  });

  it("never connects to a target that did not validate as a public address", async () => {
    mockValidate.mockResolvedValue({ safe: false });
    expect(
      await readTlsHandshake("internal.example", "https://internal.example"),
    ).toBeNull();
    expect(tlsMock.connect).not.toHaveBeenCalled();
  });

  it("records a stapled OCSP response that arrives before the handshake completes", async () => {
    answeringSocket({ staple: Buffer.from([1, 2, 3]) });
    const hs = await readTlsHandshake("example.com", "https://example.com");
    expect(hs?.stapled).toBe(true);
    expect(hs?.protocol).toBe("TLSv1.3");
    expect(hs?.cipher?.name).toBe("TLS_AES_128_GCM_SHA256");
  });

  it("answers null on a connection error", async () => {
    const handlers: Handlers = {};
    tlsMock.connect.mockImplementation((() => {
      const socket = {
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          handlers[event] = cb;
        }),
        destroy: vi.fn(),
      };
      setImmediate(() => handlers["error"]?.(new Error("ECONNRESET")));
      return socket;
    }) as unknown as typeof tls.connect);
    expect(
      await readTlsHandshake("example.com", "https://example.com"),
    ).toBeNull();
  });
});
