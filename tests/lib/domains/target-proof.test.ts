/**
 * proveTargetControl (lib/domains/target-proof.ts): owning the zone is not
 * owning the server a name in it points at, so the server has to answer for
 * itself before a port sweep, active probe or form login is aimed at it.
 *
 * Mocked at the boundaries only: DNS, the verified-domain lookup, the token
 * row and outbound fetch. pinToResolvedIp is wrapped (not replaced) so each
 * proof request records which address it was pinned to.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const TOKEN = "b".repeat(64);
const PUBLIC_IP = "93.184.216.34";

const h = vi.hoisted(() => ({
  lookup: vi.fn(),
  resolveCname: vi.fn(),
  findVerifiedDomainForHost: vi.fn(),
  query: vi.fn(),
  pins: [] as Array<{ url: string; ip: string | undefined; init: unknown }>,
}));

vi.mock("node:dns/promises", () => ({
  lookup: (...a: unknown[]) => h.lookup(...a),
  resolveCname: (...a: unknown[]) => h.resolveCname(...a),
  resolveTxt: vi.fn(),
}));

vi.mock("@/lib/domains/scope", () => ({
  findVerifiedDomainForHost: (...a: unknown[]) =>
    h.findVerifiedDomainForHost(...a),
}));

vi.mock("@/lib/database/db", () => ({
  default: { query: (...a: unknown[]) => h.query(...a) },
}));

vi.mock("@/lib/scanner/safe-fetch", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/scanner/safe-fetch")>();
  return {
    ...actual,
    pinToResolvedIp: (url: string, ip: string | undefined, init?: object) => {
      h.pins.push({ url, ip, init });
      return { url, init };
    },
  };
});

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { proveTargetControl, isProvenTarget, targetProofPath } =
  await import("@/lib/domains/target-proof");

function noData(): Error {
  return Object.assign(new Error("queryCname ENODATA"), { code: "ENODATA" });
}

const proofText = `vulnradar-verify=${TOKEN}`;

beforeEach(() => {
  h.pins.length = 0;
  h.lookup.mockReset().mockResolvedValue([{ address: PUBLIC_IP, family: 4 }]);
  h.resolveCname.mockReset().mockRejectedValue(noData());
  h.findVerifiedDomainForHost.mockReset().mockResolvedValue({
    id: 3,
    domain: "example.com",
    userId: 1,
    teamId: null,
  });
  h.query
    .mockReset()
    .mockResolvedValue({ rows: [{ verification_token: TOKEN }] });
  fetchMock
    .mockReset()
    .mockImplementation(async () => new Response(proofText, { status: 200 }));
});

describe("proveTargetControl: a server that answers", () => {
  it("proves the host and pins the address that answered", async () => {
    const result = await proveTargetControl("App.Example.com", 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.target).toEqual({
      host: "app.example.com",
      ip: PUBLIC_IP,
      domainId: 3,
      domain: "example.com",
    });
    expect(h.pins[0].url).toBe(
      `https://app.example.com/.well-known/vulnradar-verify/${TOKEN}`,
    );
    expect(h.pins.every((p) => p.ip === PUBLIC_IP)).toBe(true);
  });

  it("never follows a redirect to find the proof", async () => {
    await proveTargetControl("app.example.com", 1);

    expect(h.pins[0].init).toEqual(
      expect.objectContaining({ redirect: "manual", method: "GET" }),
    );
  });

  it("falls back to plain http when https does not answer", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith("https:")) throw new Error("ECONNREFUSED");
      return new Response(`${proofText}\n`, { status: 200 });
    });

    const result = await proveTargetControl("app.example.com", 1);

    expect(result.ok).toBe(true);
    expect(h.pins.map((p) => p.url.split(":")[0])).toEqual(["https", "http"]);
  });

  it("accepts the value on its own line among others", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(`other-proof=1\r\n  ${proofText}  \r\n`, { status: 200 }),
    );

    expect((await proveTargetControl("app.example.com", 1)).ok).toBe(true);
  });

  it("follows aliases that stay inside the verified zone", async () => {
    h.resolveCname.mockImplementation(async (name: string) => {
      if (name === "app.example.com") return ["lb.example.com."];
      throw noData();
    });

    expect((await proveTargetControl("app.example.com", 1)).ok).toBe(true);
  });

  it("issues a proof only it can vouch for", async () => {
    const result = await proveTargetControl("app.example.com", 1);
    if (!result.ok) throw new Error("expected a proof");

    expect(isProvenTarget(result.target)).toBe(true);
    expect(Object.isFrozen(result.target)).toBe(true);
    expect(isProvenTarget({ ...result.target })).toBe(false);
    expect(isProvenTarget(null)).toBe(false);
  });

  it("serves the path from the token", () => {
    expect(targetProofPath("abc")).toBe("/.well-known/vulnradar-verify/abc");
  });
});

describe("proveTargetControl: refusals", () => {
  async function expectRefused(host = "app.example.com") {
    const result = await proveTargetControl(host, 1);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("DOMAIN_NOT_VERIFIED");
    return result.reason;
  }

  it("refuses a server that does not serve the token, and says how to fix it", async () => {
    fetchMock.mockImplementation(
      async () => new Response("Not Found", { status: 404 }),
    );

    const reason = await expectRefused();

    expect(reason).toContain(PUBLIC_IP);
    expect(reason).toContain(proofText);
    expect(reason).toContain(targetProofPath(TOKEN));
  });

  it("refuses a 200 that is a page, not the proof (an SPA answering every path)", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response("<!doctype html><title>App</title>", { status: 200 }),
    );

    await expectRefused();
  });

  it("refuses a redirect instead of chasing it", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(null, {
          status: 301,
          headers: { location: "https://elsewhere.test/" },
        }),
    );

    await expectRefused();
  });

  it("refuses a host no verified domain covers, without DNS or fetch", async () => {
    h.findVerifiedDomainForHost.mockResolvedValue(null);

    const reason = await expectRefused();

    expect(reason).toMatch(/No verified domain covers/);
    expect(h.resolveCname).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when the verified-domain lookup errors", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    h.findVerifiedDomainForHost.mockRejectedValue(new Error("db down"));

    await expectRefused();

    expect(fetchMock).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it("refuses when the verified row has no token any more", async () => {
    h.query.mockResolvedValue({ rows: [] });

    await expectRefused();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a raw IP target, which has no domain to verify", async () => {
    await expectRefused(PUBLIC_IP);
    await expectRefused("[2001:db8::1]");
    expect(h.findVerifiedDomainForHost).not.toHaveBeenCalled();
  });

  it("refuses an alias that leaves the verified zone, naming the hop", async () => {
    h.resolveCname.mockImplementation(async (name: string) => {
      if (name === "app.example.com") return ["lb.example.com"];
      if (name === "lb.example.com") return ["tenant.cdn.example.net"];
      throw noData();
    });

    const reason = await expectRefused();

    expect(reason).toContain("tenant.cdn.example.net");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses when the alias chain cannot be read (a resolver failure is not a clean chain)", async () => {
    h.resolveCname.mockRejectedValue(
      Object.assign(new Error("queryCname ESERVFAIL"), { code: "ESERVFAIL" }),
    );

    await expectRefused();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an alias loop", async () => {
    h.resolveCname.mockImplementation(async (name: string) =>
      name === "app.example.com" ? ["b.example.com"] : ["app.example.com"],
    );

    await expectRefused();
  });

  it("refuses a host that resolves to any internal address, without fetching", async () => {
    h.lookup.mockResolvedValue([
      { address: PUBLIC_IP, family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);

    await expectRefused();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a host that does not resolve", async () => {
    h.lookup.mockRejectedValue(new Error("ENOTFOUND"));

    await expectRefused();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
