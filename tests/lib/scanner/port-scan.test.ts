/**
 * Tests for the opt-in, ownership-gated curated port sweep
 * (lib/scanner/port-scan.ts).
 *
 * The route-level tests (tests/app/api/v3/scan/route.test.ts) cover the
 * ownership gate that authorizes the sweep at all. This file covers scanPorts'
 * own contract: it is best-effort and never throws, it refuses any internal /
 * SSRF target (a private hostname, or an owned domain that resolves to a
 * private/loopback/link-local/metadata address) as defence in depth, it
 * respects cancellation and its wall-clock bound, and it returns structured
 * open-port data plus findings for notably risky ports.
 *
 * node:net is mocked with a controllable fake Socket so no real TCP connection
 * is ever opened; node:dns/promises is mocked so no real DNS query is made.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Shared, hoisted state the mocks read. vi.hoisted so it exists before the
// hoisted vi.mock factories run.
const h = vi.hoisted(() => ({
  openPorts: new Set<number>(),
  silentAll: false,
  // Admin overrides for the PORT_SCAN_* settings the sweep resolves. Empty
  // means "use the shipped default", which is what every other test wants.
  settingOverrides: {} as Record<string, number>,
  lookup: vi.fn(
    async (
      _host: string,
      _opts?: unknown,
    ): Promise<Array<{ address: string }>> => [{ address: "93.184.216.34" }],
  ),
}));

// The sweep resolves its network bounds through the settings resolver, which
// opens a Postgres pool at import time. Only getSettings is used here, so
// resolve straight from the shipped constants instead of standing up a pool --
// that also keeps these tests asserting against the real defaults rather than
// hand-copied numbers.
vi.mock("@/lib/config/runtime-config", async () => {
  const values =
    (await import("@/lib/config/config-values")) as unknown as Record<
      string,
      unknown
    >;
  return {
    getSettings: async (keys: readonly string[]) =>
      Object.fromEntries(
        keys.map((key) => [
          key,
          h.settingOverrides[key] ?? values[`CONFIG_${key}`],
        ]),
      ),
  };
});

vi.mock("node:net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:net")>();
  const { EventEmitter } = await import("node:events");
  class FakeSocket extends EventEmitter {
    setTimeout(): void {}
    connect(port: number, _host: string, cb: () => void): this {
      // silentAll: never answer, so only cancellation/deadline can finish it.
      if (h.silentAll) return this;
      if (h.openPorts.has(port)) {
        setImmediate(() => cb()); // connection accepted => port open
      } else {
        setImmediate(() => this.emit("error", new Error("ECONNREFUSED")));
      }
      return this;
    }
    destroy(): void {}
  }
  return { ...actual, Socket: FakeSocket };
});

vi.mock("node:dns/promises", () => ({
  lookup: (host: string, opts: unknown) => h.lookup(host, opts),
}));

const { scanPorts, buildRiskyPortFindings } =
  await import("@/lib/scanner/port-scan");

function freshSignal(): AbortSignal {
  return new AbortController().signal;
}

beforeEach(() => {
  h.openPorts = new Set();
  h.silentAll = false;
  h.settingOverrides = {};
  h.lookup.mockReset();
  h.lookup.mockResolvedValue([{ address: "93.184.216.34" }]);
});

describe("scanPorts internal-range / SSRF protection", () => {
  it("refuses a private hostname without resolving DNS or opening a socket", async () => {
    const result = await scanPorts("localhost", freshSignal());
    expect(result).toBeNull();
    expect(h.lookup).not.toHaveBeenCalled();
  });

  it("refuses a target that resolves to a private (RFC1918) address", async () => {
    h.lookup.mockResolvedValue([{ address: "10.0.0.5" }]);
    const result = await scanPorts("db.example.com", freshSignal());
    expect(result).toBeNull();
  });

  it("refuses a target that resolves to the cloud-metadata / link-local address", async () => {
    h.lookup.mockResolvedValue([{ address: "169.254.169.254" }]);
    const result = await scanPorts("db.example.com", freshSignal());
    expect(result).toBeNull();
  });

  it("refuses the whole sweep when ANY resolved address is internal", async () => {
    h.lookup.mockResolvedValue([
      { address: "93.184.216.34" },
      { address: "127.0.0.1" },
    ]);
    const result = await scanPorts("db.example.com", freshSignal());
    expect(result).toBeNull();
  });

  it("returns null (never throws) when DNS resolution fails", async () => {
    h.lookup.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(
      scanPorts("db.example.com", freshSignal()),
    ).resolves.toBeNull();
  });
});

describe("scanPorts best-effort contract", () => {
  it("returns null immediately for an already-aborted signal, without resolving DNS", async () => {
    const ac = new AbortController();
    ac.abort();
    const result = await scanPorts("example.com", ac.signal);
    expect(result).toBeNull();
    expect(h.lookup).not.toHaveBeenCalled();
  });

  it("returns structured, ascending open ports with their service names", async () => {
    h.openPorts = new Set([3306, 22, 80]);
    const result = await scanPorts("example.com", freshSignal());
    expect(result).not.toBeNull();
    expect(result!.host).toBe("example.com");
    expect(result!.portsScanned).toBeGreaterThan(100);
    expect(result!.open.map((p) => p.port)).toEqual([22, 80, 3306]);
    const ssh = result!.open.find((p) => p.port === 22)!;
    expect(ssh.service).toBe("SSH");
    expect(ssh.state).toBe("open");
  });

  it("reports an empty open list (checked, nothing open) rather than null when nothing answers", async () => {
    h.openPorts = new Set();
    const result = await scanPorts("example.com", freshSignal());
    expect(result).not.toBeNull();
    expect(result!.open).toEqual([]);
  });

  it("returns the checked-but-closed ports, ascending, alongside the open ones", async () => {
    h.openPorts = new Set([22]);
    const result = await scanPorts("example.com", freshSignal());
    expect(result).not.toBeNull();
    expect(result!.open.map((p) => p.port)).toEqual([22]);
    // Every curated port except the one open port refused the connection.
    expect(result!.closed).toBeDefined();
    expect(result!.closed!.length).toBe(result!.portsScanned - 1);
    expect(result!.closed!.some((p) => p.port === 22)).toBe(false);
    const closedPorts = result!.closed!.map((p) => p.port);
    expect([...closedPorts].sort((a, b) => a - b)).toEqual(closedPorts);
    // Each closed entry carries the service usually found on that port.
    expect(result!.closed!.every((p) => typeof p.service === "string")).toBe(
      true,
    );
  });

  it("respects cancellation mid-sweep: aborting resolves promptly instead of hanging", async () => {
    h.silentAll = true; // no port ever answers, so only the abort can end it
    const ac = new AbortController();
    const promise = scanPorts("example.com", ac.signal);
    setTimeout(() => ac.abort(), 30);
    const result = await promise;
    expect(result).not.toBeNull();
    expect(result!.open).toEqual([]);
  });
});

// AUDIT-014#magic-12: these bounds were inline literals, so a self-hoster
// scanning their own estate through a firewall they do not control had no way
// to slow the sweep down short of editing the scanner.
describe("scanPorts admin-configurable bounds", () => {
  it("ends the sweep on the admin's overall deadline when nothing ever answers", async () => {
    h.silentAll = true; // only the deadline can end this sweep
    h.settingOverrides.PORT_SCAN_OVERALL_DEADLINE_MS = 40;

    const startedAt = Date.now();
    const result = await scanPorts("example.com", freshSignal());

    expect(result).not.toBeNull();
    expect(result!.open).toEqual([]);
    // Nowhere near the shipped 12s default, which is what would have bounded
    // this before the deadline became configurable.
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });

  it("still sweeps every curated port when the admin drops concurrency to one connection at a time", async () => {
    h.openPorts = new Set([22, 443]);
    h.settingOverrides.PORT_SCAN_CONCURRENCY = 1;

    const result = await scanPorts("example.com", freshSignal());

    expect(result).not.toBeNull();
    expect(result!.portsScanned).toBeGreaterThan(100);
    expect(result!.open.map((p) => p.port)).toEqual([22, 443]);
  });
});

describe("buildRiskyPortFindings", () => {
  it("emits one finding for an exposed database port but none for a bare web port", () => {
    const findings = buildRiskyPortFindings(
      "example.com",
      "https://example.com/",
      [
        { port: 80, service: "HTTP", state: "open" },
        { port: 3306, service: "MySQL", state: "open" },
      ],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toMatch(/MySQL/);
    expect(findings[0].severity).toBe("high");
    expect(findings[0].category).toBe("configuration");
  });

  it("produces a deterministic id from the port and URL, stable across calls", () => {
    const open = [{ port: 3389, service: "RDP", state: "open" as const }];
    const a = buildRiskyPortFindings(
      "example.com",
      "https://example.com/",
      open,
    );
    const b = buildRiskyPortFindings(
      "example.com",
      "https://example.com/",
      open,
    );
    expect(a[0].id).toBe(b[0].id);
    expect(a[0].id).toContain("open-port-3389");
  });

  it("returns an empty array when no open port is risky", () => {
    const findings = buildRiskyPortFindings(
      "example.com",
      "https://example.com/",
      [
        { port: 80, service: "HTTP", state: "open" },
        { port: 443, service: "HTTPS", state: "open" },
      ],
    );
    expect(findings).toEqual([]);
  });
});
