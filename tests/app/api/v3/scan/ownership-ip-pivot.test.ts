/**
 * The ownership IP pivot (gap-domain-verification-active-gating-1).
 *
 * Verifying a domain proves control of its DNS, never of the servers its
 * names point at. User 1 verifies attacker.example, then publishes
 * `v1.attacker.example A 93.184.216.34`, an address they have nothing to do
 * with. Before the fix, the zone-control rule said v1.attacker.example is
 * covered, so a port sweep went out from this server to that address.
 *
 * Everything between the request and the socket is real here: the ports
 * refresh route, the verified-domain lookup, the target proof and the sweep.
 * Only the edges are faked: DNS, the database, outbound fetch and node:net, so
 * no packet leaves the test and every connect attempt is recorded.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const TOKEN = "a".repeat(64);
// Not 203.0.113.7 as the finding has it: that is TEST-NET-3, which the SSRF
// guard already refuses as non-public, so the sweep would stop for an
// unrelated reason. A routable address is what makes this a real pivot.
const VICTIM_IP = "93.184.216.34";

const h = vi.hoisted(() => ({
  connects: [] as Array<{ port: number; ip: string }>,
  aRecords: new Map<string, string[]>(),
  cnames: new Map<string, string>(),
  pins: [] as Array<{ url: string; ip: string | undefined }>,
}));

vi.mock("node:dns/promises", () => ({
  lookup: async (host: string) => {
    const addrs = h.aRecords.get(host);
    if (!addrs) {
      throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), {
        code: "ENOTFOUND",
      });
    }
    return addrs.map((address) => ({ address, family: 4 }));
  },
  resolveCname: async (host: string) => {
    const target = h.cnames.get(host);
    if (!target) {
      throw Object.assign(new Error(`queryCname ENODATA ${host}`), {
        code: "ENODATA",
      });
    }
    return [target];
  },
}));

vi.mock("node:net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:net")>();
  const { EventEmitter } = await import("node:events");
  class RecordingSocket extends EventEmitter {
    setTimeout(): void {}
    connect(port: number, ip: string): this {
      h.connects.push({ port, ip });
      setImmediate(() => this.emit("error", new Error("ECONNREFUSED")));
      return this;
    }
    destroy(): void {}
  }
  return { ...actual, Socket: RecordingSocket };
});

vi.mock("@/lib/scanner/safe-fetch", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/scanner/safe-fetch")>();
  return {
    ...actual,
    pinToResolvedIp: (url: string, ip: string | undefined, init?: object) => {
      h.pins.push({ url, ip });
      return { url, init };
    },
  };
});

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...a: unknown[]) => mockQuery(...a) },
}));

vi.mock("@/lib/config/runtime-config", async () => {
  const values =
    (await import("@/lib/config/config-values")) as unknown as Record<
      string,
      unknown
    >;
  return {
    getSetting: async (key: string) =>
      key === "BILLING_ENABLED" ? false : values[`CONFIG_${key}`],
    getSettings: async (keys: readonly string[]) =>
      Object.fromEntries(keys.map((k) => [k, values[`CONFIG_${k}`]])),
  };
});

vi.mock("@/lib/admin/service-state", () => ({
  scanningPausedResponse: async () => null,
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({ getSession: () => mockGetSession() }));

const mockResolveScanRow = vi.fn();
vi.mock("@/lib/history/resolve-scan", () => ({
  resolveScanRow: (...a: unknown[]) => mockResolveScanRow(...a),
}));

vi.mock("@/lib/rate-limiting/daily-limits", () => ({
  getUserPlan: async () => "free",
}));

vi.mock("@/lib/rate-limiting/rate-limit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/rate-limiting/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: async () => ({
      allowed: true,
      remaining: 9,
      retryAfterSeconds: 0,
    }),
  };
});

// The rule table is not what this file is about; an empty blocklist.
vi.mock("@/lib/scanner/access-rules", () => ({
  checkAccessRules: async () => ({ allowed: true }),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { POST } = await import("@/app/api/v3/history/[id]/ports/route");
const { scanPorts } = await import("@/lib/scanner/port-scan");

/** The database as user 1 sees it: attacker.example, verified, theirs. */
function answerQuery(sql: string, params: unknown[] = []) {
  if (sql.includes("FROM team_members")) return { rows: [] };
  if (sql.includes("verification_token")) {
    return params[0] === 7
      ? { rows: [{ verification_token: TOKEN }] }
      : {
          rows: [],
        };
  }
  if (sql.includes("FROM domains")) {
    const candidates = params[0] as string[];
    return params[1] === 1 && candidates.includes("attacker.example")
      ? {
          rows: [
            { id: 7, domain: "attacker.example", user_id: 1, team_id: null },
          ],
        }
      : { rows: [] };
  }
  return { rows: [], rowCount: 1 };
}

function proofBody(): string {
  return `vulnradar-verify=${TOKEN}\n`;
}

beforeEach(() => {
  h.connects.length = 0;
  h.pins.length = 0;
  h.aRecords.clear();
  h.cnames.clear();
  h.aRecords.set("v1.attacker.example", [VICTIM_IP]);
  mockQuery
    .mockReset()
    .mockImplementation(async (sql, params) =>
      answerQuery(String(sql), params as unknown[]),
    );
  mockGetSession.mockReset().mockResolvedValue({ userId: 1 });
  mockResolveScanRow.mockReset().mockResolvedValue({
    id: 10,
    user_id: 1,
    url: "https://v1.attacker.example/",
  });
  // The address belongs to someone else: it has never heard of the token.
  fetchMock
    .mockReset()
    .mockImplementation(async () => new Response("Not Found", { status: 404 }));
});

function refresh() {
  return POST(
    new NextRequest("http://localhost/api/v3/history/10/ports", {
      method: "POST",
    }),
    { params: Promise.resolve({ id: "10" }) },
  );
}

describe("a verified zone pointed at someone else's server", () => {
  it("refuses the ports refresh with 403 DOMAIN_NOT_VERIFIED and opens no socket", async () => {
    const res = await refresh();

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.statusCode).toBe("DOMAIN_NOT_VERIFIED");
    expect(h.connects).toEqual([]);
  });

  it("scanPorts for user 1 opens no socket to the pivoted address", async () => {
    const result = await scanPorts(
      "v1.attacker.example",
      new AbortController().signal,
      { userId: 1 },
    );

    expect(result).toBeNull();
    expect(h.connects).toEqual([]);
  });

  it("scanPorts with no authorization at all opens no socket", async () => {
    const result = await scanPorts(
      "v1.attacker.example",
      new AbortController().signal,
    );

    expect(result).toBeNull();
    expect(h.connects).toEqual([]);
  });

  it("refuses a name that is an alias for a host outside the verified zone, before any fetch", async () => {
    h.cnames.set("v2.attacker.example", "shop.victim.example.net");
    h.aRecords.set("v2.attacker.example", [VICTIM_IP]);

    const { proveTargetControl } = await import("@/lib/domains/target-proof");
    const proof = await proveTargetControl("v2.attacker.example", 1);

    expect(proof.ok).toBe(false);
    if (!proof.ok) {
      expect(proof.code).toBe("DOMAIN_NOT_VERIFIED");
      expect(proof.reason).toContain("shop.victim.example.net");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("a server that answers the proof", () => {
  it("sweeps exactly the address that served the token, and nothing else", async () => {
    fetchMock.mockImplementation(
      async () => new Response(proofBody(), { status: 200 }),
    );

    const res = await refresh();

    expect(res.status).toBe(200);
    expect(h.pins.length).toBeGreaterThan(0);
    expect(h.pins.every((p) => p.ip === VICTIM_IP)).toBe(true);
    expect(h.pins[0].url).toBe(
      `https://v1.attacker.example/.well-known/vulnradar-verify/${TOKEN}`,
    );
    expect(h.connects.length).toBeGreaterThan(0);
    expect(new Set(h.connects.map((c) => c.ip))).toEqual(new Set([VICTIM_IP]));
  });
});
