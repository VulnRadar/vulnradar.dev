/**
 * Tests for the two new grabBanner/grabCapabilityBanner behaviors added
 * alongside the expanded service-probe support:
 *
 *   1. grabBanner opens implicit-TLS protocols (smtps, imaps, pop3s, ftps)
 *      via tls.connect instead of a plain net.Socket, since those ports
 *      expect a TLS ClientHello immediately.
 *   2. grabCapabilityBanner accumulates a multi-line capability response
 *      (SMTP EHLO / IMAP CAPABILITY / POP3 CAPA) using an idle-timer
 *      instead of resolving on the first newline, so STARTTLS/STLS in a
 *      later line isn't truncated away.
 *
 * Mocks at the network boundary only (node:net's Socket, node:tls's
 * connect), matching tests/lib/scanner/protocols/banner.test.ts's existing
 * convention — everything above the socket (validateBannerTarget,
 * CLIENT_HELLOS/CAPABILITY_HELLOS allowlists) runs for real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { FakeSocket, FakeTLSSocket, tlsConnectMock } = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;

  class MiniEmitter {
    private listeners: Record<string, Listener[]> = {};
    on(event: string, fn: Listener) {
      (this.listeners[event] ??= []).push(fn);
      return this;
    }
    once(event: string, fn: Listener) {
      const wrapper: Listener = (...args) => {
        this.listeners[event] = (this.listeners[event] || []).filter(
          (l) => l !== wrapper,
        );
        fn(...args);
      };
      return this.on(event, wrapper);
    }
    emit(event: string, ...args: unknown[]) {
      for (const fn of this.listeners[event] || []) fn(...args);
      return true;
    }
  }

  class FakeSocket extends MiniEmitter {
    static instances: FakeSocket[] = [];
    destroyed = false;
    written: string[] = [];
    timeoutMs: number | undefined;
    connectCall: { port: number; host: string; cb: () => void } | undefined;

    constructor() {
      super();
      FakeSocket.instances.push(this);
    }
    setTimeout(ms: number) {
      this.timeoutMs = ms;
    }
    connect(port: number, host: string, cb: () => void) {
      this.connectCall = { port, host, cb };
    }
    write(data: string) {
      this.written.push(data);
    }
    destroy() {
      this.destroyed = true;
    }
  }

  class FakeTLSSocket extends MiniEmitter {
    static instances: FakeTLSSocket[] = [];
    destroyed = false;
    written: string[] = [];
    timeoutMs: number | undefined;
    options: {
      host: string;
      port: number;
      servername?: string;
      rejectUnauthorized?: boolean;
    };

    constructor(options: {
      host: string;
      port: number;
      servername?: string;
      rejectUnauthorized?: boolean;
    }) {
      super();
      this.options = options;
      FakeTLSSocket.instances.push(this);
    }
    setTimeout(ms: number) {
      this.timeoutMs = ms;
    }
    write(data: string) {
      this.written.push(data);
    }
    destroy() {
      this.destroyed = true;
    }
  }

  const tlsConnectMock = vi.fn(
    (options: {
      host: string;
      port: number;
      servername?: string;
      rejectUnauthorized?: boolean;
    }) => new FakeTLSSocket(options),
  );

  return { FakeSocket, FakeTLSSocket, tlsConnectMock };
});

vi.mock("node:net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:net")>();
  return { ...actual, Socket: FakeSocket };
});

vi.mock("node:tls", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:tls")>();
  return { ...actual, connect: tlsConnectMock };
});

import {
  grabBanner,
  grabCapabilityBanner,
} from "@/lib/scanner/protocols/banner";

const PUBLIC_IP = "93.184.216.34";

beforeEach(() => {
  FakeSocket.instances.length = 0;
  FakeTLSSocket.instances.length = 0;
  tlsConnectMock.mockClear();
});

describe("grabBanner: implicit-TLS protocols use tls.connect", () => {
  it("connects smtps via tls.connect with the target as servername and rejectUnauthorized false", async () => {
    const resultPromise = grabBanner("smtps", PUBLIC_IP, 465, 2000);
    await Promise.resolve();

    expect(tlsConnectMock).toHaveBeenCalledWith({
      host: PUBLIC_IP,
      port: 465,
      servername: PUBLIC_IP,
      rejectUnauthorized: false,
    });
    expect(FakeSocket.instances.length).toBe(0);

    const socket = FakeTLSSocket.instances[0];
    expect(socket).toBeDefined();
    socket.emit("secureConnect");
    socket.emit("data", Buffer.from("220 mail.example.com ESMTP\r\n"));

    const result = await resultPromise;
    expect(result).toEqual({
      protocol: "smtps",
      host: PUBLIC_IP,
      port: 465,
      banner: "220 mail.example.com ESMTP\r\n",
      secure: true,
    });
  });

  it("writes the EHLO hello only after secureConnect fires, not before", async () => {
    const resultPromise = grabBanner(
      "smtps",
      PUBLIC_IP,
      465,
      2000,
      "EHLO vulnradar-scan.local\r\n",
    );
    await Promise.resolve();
    const socket = FakeTLSSocket.instances[0];

    expect(socket.written).toEqual([]);
    socket.emit("secureConnect");
    expect(socket.written).toEqual(["EHLO vulnradar-scan.local\r\n"]);

    socket.emit("data", Buffer.from("220 ok\r\n"));
    await resultPromise;
  });

  it("connects imaps via tls.connect and reports secure:true", async () => {
    const resultPromise = grabBanner("imaps", PUBLIC_IP, 993, 2000);
    await Promise.resolve();
    const socket = FakeTLSSocket.instances[0];
    socket.emit("secureConnect");
    socket.emit("data", Buffer.from("* OK IMAP4rev1 Server ready\r\n"));

    const result = await resultPromise;
    expect(result?.secure).toBe(true);
    expect(result?.protocol).toBe("imaps");
  });

  it("connects pop3s via tls.connect and reports secure:true", async () => {
    const resultPromise = grabBanner("pop3s", PUBLIC_IP, 995, 2000);
    await Promise.resolve();
    const socket = FakeTLSSocket.instances[0];
    socket.emit("secureConnect");
    socket.emit("data", Buffer.from("+OK POP3 server ready\r\n"));

    const result = await resultPromise;
    expect(result?.secure).toBe(true);
  });

  it("connects ftps via tls.connect and reports secure:true", async () => {
    const resultPromise = grabBanner("ftps", PUBLIC_IP, 990, 2000);
    await Promise.resolve();
    const socket = FakeTLSSocket.instances[0];
    socket.emit("secureConnect");
    socket.emit("data", Buffer.from("220 FTPS ready\r\n"));

    const result = await resultPromise;
    expect(result?.secure).toBe(true);
  });

  it("resolves null and destroys the TLS socket on error before secureConnect", async () => {
    const resultPromise = grabBanner("smtps", PUBLIC_IP, 465, 2000);
    await Promise.resolve();
    const socket = FakeTLSSocket.instances[0];
    socket.emit("error", new Error("ECONNRESET"));

    const result = await resultPromise;
    expect(result).toBeNull();
    expect(socket.destroyed).toBe(true);
  });

  it("resolves null on a timeout with no secureConnect", async () => {
    const resultPromise = grabBanner("imaps", PUBLIC_IP, 993, 50);
    await Promise.resolve();
    const socket = FakeTLSSocket.instances[0];
    socket.emit("timeout");

    const result = await resultPromise;
    expect(result).toBeNull();
  });

  it("still refuses private hosts before ever calling tls.connect", async () => {
    const result = await grabBanner("smtps", "127.0.0.1", 465, 200);
    expect(result).toBeNull();
    expect(tlsConnectMock).not.toHaveBeenCalled();
  });

  it("still refuses a port outside the protocol's well-known list before calling tls.connect", async () => {
    const result = await grabBanner("smtps", PUBLIC_IP, 25, 200);
    expect(result).toBeNull();
    expect(tlsConnectMock).not.toHaveBeenCalled();
  });

  it("plain (non-TLS) smtp still uses a plaintext net.Socket, not tls.connect", async () => {
    const resultPromise = grabBanner("smtp", PUBLIC_IP, 25, 2000);
    await Promise.resolve();
    expect(tlsConnectMock).not.toHaveBeenCalled();
    const socket = FakeSocket.instances[0];
    expect(socket).toBeDefined();
    socket.connectCall!.cb();
    socket.emit("data", Buffer.from("220 ok\r\n"));
    const result = await resultPromise;
    expect(result?.secure).toBe(false);
  });
});

describe("grabCapabilityBanner: multi-line capability responses", () => {
  it("returns null immediately for a protocol with no capability hello (e.g. ssh)", async () => {
    const result = await grabCapabilityBanner("ssh", PUBLIC_IP, 22, 200);
    expect(result).toBeNull();
    expect(FakeSocket.instances.length).toBe(0);
  });

  it("refuses private hosts before opening a socket", async () => {
    const result = await grabCapabilityBanner("imap", "192.168.1.1", 143, 200);
    expect(result).toBeNull();
    expect(FakeSocket.instances.length).toBe(0);
  });

  it("writes the CAPABILITY hello for imap immediately on connect", async () => {
    const resultPromise = grabCapabilityBanner(
      "imap",
      PUBLIC_IP,
      143,
      2000,
      30,
    );
    await Promise.resolve();
    const socket = FakeSocket.instances[0];
    socket.connectCall!.cb();
    expect(socket.written).toEqual(["A1 CAPABILITY\r\n"]);

    socket.emit(
      "data",
      Buffer.from(
        "* CAPABILITY IMAP4rev1 STARTTLS\r\nA1 OK CAPABILITY completed\r\n",
      ),
    );
    const result = await resultPromise;
    expect(result?.banner).toContain("STARTTLS");
  });

  it("writes CAPA (not USER) for pop3, distinct from grabBanner's plain hello", async () => {
    const resultPromise = grabCapabilityBanner(
      "pop3",
      PUBLIC_IP,
      110,
      2000,
      30,
    );
    await Promise.resolve();
    const socket = FakeSocket.instances[0];
    socket.connectCall!.cb();
    expect(socket.written).toEqual(["CAPA\r\n"]);

    socket.emit(
      "data",
      Buffer.from("+OK Capability list follows\r\nSTLS\r\n.\r\n"),
    );
    const result = await resultPromise;
    expect(result?.banner).toContain("STLS");
  });

  it("accumulates a response arriving in several chunks separated by short gaps into one banner", async () => {
    const resultPromise = grabCapabilityBanner("smtp", PUBLIC_IP, 25, 2000, 30);
    await Promise.resolve();
    const socket = FakeSocket.instances[0];
    socket.connectCall!.cb();

    socket.emit("data", Buffer.from("220 mail.example.com ESMTP\r\n"));
    await new Promise((r) => setTimeout(r, 10));
    socket.emit("data", Buffer.from("250-mail.example.com\r\n"));
    await new Promise((r) => setTimeout(r, 10));
    socket.emit("data", Buffer.from("250 STARTTLS\r\n"));

    const result = await resultPromise;
    expect(result?.banner).toBe(
      "220 mail.example.com ESMTP\r\n250-mail.example.com\r\n250 STARTTLS\r\n",
    );
  });

  it("finalizes early once the byte cap is hit, without waiting for the idle timer", async () => {
    const resultPromise = grabCapabilityBanner(
      "smtp",
      PUBLIC_IP,
      25,
      2000,
      5000,
    );
    await Promise.resolve();
    const socket = FakeSocket.instances[0];
    socket.connectCall!.cb();

    const huge = "220 ready\r\n" + "X".repeat(5000);
    socket.emit("data", Buffer.from(huge));

    const result = await resultPromise;
    expect(result?.banner.length).toBe(4096);
  });

  it("returns null on a hard timeout with no data received at all", async () => {
    const resultPromise = grabCapabilityBanner("smtp", PUBLIC_IP, 25, 50);
    await Promise.resolve();
    const socket = FakeSocket.instances[0];
    socket.connectCall!.cb();
    socket.emit("timeout");

    const result = await resultPromise;
    expect(result).toBeNull();
  });

  it("returns the partial banner on a hard timeout if some data had already arrived", async () => {
    const resultPromise = grabCapabilityBanner("smtp", PUBLIC_IP, 25, 50);
    await Promise.resolve();
    const socket = FakeSocket.instances[0];
    socket.connectCall!.cb();
    socket.emit("data", Buffer.from("220 mail.example.com ESMTP\r\n"));
    socket.emit("timeout");

    const result = await resultPromise;
    expect(result?.banner).toBe("220 mail.example.com ESMTP\r\n");
  });
});
