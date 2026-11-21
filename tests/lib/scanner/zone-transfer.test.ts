/**
 * The zone-transfer probe opens a raw TCP socket to port 53 on the scanned
 * domain's own name servers. The domain's owner writes those NS records, so a
 * hostile domain picks the addresses: an NS that resolves to 10.0.0.5 or
 * 169.254.169.254 would aim the scanner at the network it runs in. The only
 * thing in the way is the isPrivateIP check in checkZoneTransfer, and CodeQL's
 * request-forgery query does not treat net.createConnection as a sink, so
 * these tests are what notices if that check goes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("dns/promises", () => ({
  resolveNs: vi.fn(),
  resolve4: vi.fn(),
  resolve6: vi.fn().mockRejectedValue(new Error("mock: dns disabled")),
  resolveTxt: vi.fn().mockRejectedValue(new Error("mock: dns disabled")),
  resolveMx: vi.fn().mockRejectedValue(new Error("mock: dns disabled")),
  resolveSoa: vi.fn().mockRejectedValue(new Error("mock: dns disabled")),
  resolveCname: vi.fn().mockRejectedValue(new Error("mock: dns disabled")),
  resolveCaa: vi.fn().mockRejectedValue(new Error("mock: dns disabled")),
  lookup: vi.fn().mockRejectedValue(new Error("mock: dns disabled")),
}));

// vi.mock factories are hoisted above the imports, so the socket double and
// its reply queue are built in vi.hoisted for the factory to close over.
const net = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");
  class FakeSocket extends EventEmitter {
    write = vi.fn();
    destroy = vi.fn();
  }
  const state = { reply: null as Buffer | null };
  const createConnection = vi.fn(() => {
    const socket = new FakeSocket();
    // Answer asynchronously, the way a real socket would: connect, then
    // either the queued DNS reply or a plain close.
    setImmediate(() => {
      socket.emit("connect");
      if (state.reply) socket.emit("data", state.reply);
      socket.emit("close");
    });
    return socket;
  });
  return { state, createConnection };
});
const { createConnection } = net;

vi.mock("net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("net")>();
  return {
    ...actual,
    default: { ...actual, createConnection: net.createConnection },
    createConnection: net.createConnection,
  };
});

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
import { checkZoneTransfer } from "@/lib/scanner/async-checks";

const DOMAIN = "hostile.example";
const URL = "https://hostile.example/";

/** Each NS host name resolves to the address given for it. */
function nameServers(map: Record<string, string>) {
  vi.mocked(dns.resolveNs).mockResolvedValue(Object.keys(map));
  vi.mocked(dns.resolve4).mockImplementation((async (host: string) => {
    const ip = map[host];
    if (!ip) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    return [ip];
  }) as unknown as typeof dns.resolve4);
}

/** A TCP DNS reply: 2-byte length prefix, then a header with ANCOUNT set. */
function axfrReply(ancount: number): Buffer {
  const header = Buffer.alloc(14);
  header.writeUInt16BE(12, 0);
  header.writeUInt16BE(0x1234, 2);
  header.writeUInt16BE(ancount, 8);
  return header;
}

beforeEach(() => {
  vi.mocked(dns.resolveNs).mockReset();
  vi.mocked(dns.resolve4).mockReset();
  createConnection.mockClear();
  net.state.reply = null;
});

describe("checkZoneTransfer never dials a private name server", () => {
  it.each(["10.0.0.5", "127.0.0.1", "169.254.169.254", "192.168.1.53"])(
    "skips an NS that resolves to %s",
    async (ip) => {
      nameServers({ "ns1.hostile.example": ip });
      const findings = await checkZoneTransfer(DOMAIN, URL);
      expect(createConnection).not.toHaveBeenCalled();
      expect(findings).toEqual([]);
    },
  );

  it("skips every private NS in a set of them", async () => {
    nameServers({
      "ns1.hostile.example": "10.0.0.5",
      "ns2.hostile.example": "127.0.0.1",
      "ns3.hostile.example": "169.254.169.254",
    });
    const findings = await checkZoneTransfer(DOMAIN, URL);
    expect(createConnection).not.toHaveBeenCalled();
    expect(findings).toEqual([]);
  });

  it("dials only the public NS, once, on port 53", async () => {
    nameServers({
      "ns1.hostile.example": "10.0.0.5",
      "ns2.hostile.example": "93.184.216.34",
      "ns3.hostile.example": "169.254.169.254",
    });
    await checkZoneTransfer(DOMAIN, URL);
    expect(createConnection).toHaveBeenCalledTimes(1);
    expect(createConnection).toHaveBeenCalledWith(
      expect.objectContaining({ host: "93.184.216.34", port: 53 }),
    );
  });
});

describe("checkZoneTransfer on resolver failures", () => {
  it("returns nothing and dials nothing when the NS lookup fails", async () => {
    vi.mocked(dns.resolveNs).mockRejectedValue(
      Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }),
    );
    await expect(checkZoneTransfer(DOMAIN, URL)).resolves.toEqual([]);
    expect(createConnection).not.toHaveBeenCalled();
  });

  it("skips an NS whose address lookup fails and moves on", async () => {
    vi.mocked(dns.resolveNs).mockResolvedValue([
      "ns1.hostile.example",
      "ns2.hostile.example",
    ]);
    vi.mocked(dns.resolve4).mockImplementation((async (host: string) => {
      if (host === "ns1.hostile.example") {
        throw Object.assign(new Error("ETIMEOUT"), { code: "ETIMEOUT" });
      }
      return ["93.184.216.34"];
    }) as unknown as typeof dns.resolve4);
    await expect(checkZoneTransfer(DOMAIN, URL)).resolves.toEqual([]);
    expect(createConnection).toHaveBeenCalledTimes(1);
  });
});

describe("checkZoneTransfer on a public name server", () => {
  it("reports an open transfer from the reply's record count", async () => {
    nameServers({ "ns1.hostile.example": "93.184.216.34" });
    net.state.reply = axfrReply(52);
    const findings = await checkZoneTransfer(DOMAIN, URL);
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence).toContain("52");
  });

  it("reports nothing when the server refuses", async () => {
    nameServers({ "ns1.hostile.example": "93.184.216.34" });
    net.state.reply = axfrReply(0);
    await expect(checkZoneTransfer(DOMAIN, URL)).resolves.toEqual([]);
  });
});
