import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Control DNS resolution so validateScanTarget's resolve-then-check path and
// safeFetch's per-hop re-validation can be exercised deterministically. The
// network boundary (fetch) is mocked per-test below.
const mockLookup = vi.fn();
vi.mock("dns/promises", () => ({
  lookup: (...args: unknown[]) => mockLookup(...args),
}));

const { isPrivateIP, validateScanTarget, safeFetch, SafeFetchError } =
  await import("@/lib/scanner/safe-fetch");
type PinnedDispatcher = import("@/lib/scanner/safe-fetch").PinnedDispatcher;

/** dns/promises lookup(host, {all:true}) shape. */
function resolvesTo(...ips: string[]) {
  mockLookup.mockResolvedValue(
    ips.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
  );
}

describe("isPrivateIP IPv6 canonicalization", () => {
  // Regression: audit found that non-canonical IPv6 representations of
  // private ranges (long expanded form, hex-encoded embedded IPv4, RFC 6052
  // NAT64 prefix) bypassed the regex-based private-range checks because the
  // patterns only matched dotted-form ::ffff:X.X.X.X.
  it.each([
    // Native IPv6 loopback (shorthand + long expanded)
    "::1",
    "0:0:0:0:0:0:0:1",
    "0000:0000:0000:0000:0000:0000:0000:0001",
    // IPv4-mapped loopback (dotted, hex-encoded, long expanded, with extras)
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:7f00:0001",
    "0:0:0:0:0:ffff:127.0.0.1",
    "0000:0000:0000:0000:0000:ffff:7f00:0001",
    // RFC 6052 NAT64 prefix with hex-encoded embedded IPv4
    "64:ff9b::7f00:1",
    "0064:ff9b:0000:0000:0000:0000:7f00:0001",
    // IPv4-mapped private A (10.0.0.0/8)
    "::ffff:10.0.0.1",
    "::ffff:a00:1",
    // IPv4-mapped private B (172.16.0.0/12)
    "::ffff:172.16.0.1",
    "::ffff:ac10:1",
    // IPv4-mapped private C (192.168.0.0/16)
    "::ffff:192.168.1.1",
    "::ffff:c0a8:101",
    // IPv4-mapped link-local / cloud metadata (169.254.169.254)
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe",
    // Native IPv6 ULA
    "fc00::1",
    "fd00::1",
    // Link-local
    "fe80::1",
    // Unspecified
    "::",
    // IPv4-compatible (deprecated ::a.b.c.d) forms of private ranges
    "::127.0.0.1",
    "::7f00:1",
    "::a9fe:a9fe",
    "::10.0.0.1",
    "::168.63.129.16",
    // 6to4 (2002::/16) with a private IPv4 in the prefix
    "2002:7f00:1::",
    "2002:a9fe:a9fe::1",
    "2002:c0a8:101:1::1",
    "2002:a83f:8110::",
  ])("blocks %s", (ip) => {
    expect(isPrivateIP(ip)).toBe(true);
  });

  it.each([
    // Genuine public addresses must NOT match
    "2606:4700:4700::1111", // Cloudflare DNS
    "2001:4860:4860::8888", // Google DNS
    "::ffff:1.1.1.1", // Cloudflare IPv4-mapped public
    "::1.1.1.1", // IPv4-compatible public
    "2002:101:101::1", // 6to4 for a public IPv4
  ])("allows public IPv6 %s", (ip) => {
    expect(isPrivateIP(ip)).toBe(false);
  });

  it("still blocks IPv4 private ranges", () => {
    expect(isPrivateIP("127.0.0.1")).toBe(true);
    expect(isPrivateIP("10.0.0.1")).toBe(true);
    expect(isPrivateIP("192.168.1.1")).toBe(true);
    expect(isPrivateIP("169.254.169.254")).toBe(true);
  });

  // AUDIT-012#ssrf-03: 100.64.0.0/10 (RFC 6598) was missing entirely, so
  // Alibaba Cloud's metadata endpoint -- the direct analogue of the blocked
  // 169.254.169.254 -- and all EKS/GKE pod + CGNAT space were reachable,
  // including through the IPv4-mapped IPv6 path.
  it.each([
    "100.64.0.1", // first address of the /10
    "100.100.100.200", // Alibaba Cloud instance metadata
    "100.100.2.136", // Alibaba Cloud internal resolver
    "100.127.255.255", // last address of the /10
    "::ffff:100.100.100.200", // IPv4-mapped form of the same
    "198.18.0.1", // RFC 2544 benchmarking, routed internally on many networks
    "192.0.0.1", // IETF protocol assignments
    "192.0.2.1", // TEST-NET-1
    "198.51.100.1", // TEST-NET-2
    "203.0.113.1", // TEST-NET-3
  ])("blocks special-purpose range %s", (ip) => {
    expect(isPrivateIP(ip)).toBe(true);
  });

  // AUDIT-012#ssrf-05: three patterns named a /7 or /10 in their comment
  // while matching a single 16-bit group, so everything above the first
  // group of each range fell through as public.
  it.each([
    "fe80::1", // fe80::/10, first group
    "fe81::1", // fe80::/10, was unmatched
    "feaa::1", // fe80::/10, middle
    "febf::1", // fe80::/10, last group
    "fc00::1", // fc00::/7, first group
    "fc01::1", // fc00::/7, was unmatched
    "fcff::1", // fc00::/7, was unmatched
    "fd00::1", // fc00::/7 (fd00::/8 half)
    "fdff::1", // fc00::/7, last group
    "fec0::1", // fec0::/10 site-local, first group
    "fec1::1", // fec0::/10, was unmatched
    "feff::1", // fec0::/10, last group
  ])("blocks the full IPv6 range containing %s", (ip) => {
    expect(isPrivateIP(ip)).toBe(true);
  });

  it.each([
    "fe7f::1", // immediately below fe80::/10
    "fb00::1", // immediately below fc00::/7
    "ff00::1", // multicast is matched by its own pattern, not the site-local one
  ])("keeps the boundary address %s classified as before", (ip) => {
    // fe7f/fb00 are outside every private range; ff00 is inside the
    // multicast one. Asserted together so widening the three ranges above
    // cannot silently swallow their neighbours.
    expect(isPrivateIP(ip)).toBe(ip === "ff00::1");
  });

  // Azure's WireServer (and the HostGAPlugin behind it on :32526) answers on a
  // public-looking address that is reachable only from inside an Azure VM.
  // Nothing in RFC 1918 or RFC 6598 covers it, so it needs its own entry.
  it.each(["168.63.129.16", "::ffff:168.63.129.16", "::ffff:a83f:8110"])(
    "blocks Azure's WireServer address %s",
    (ip) => {
      expect(isPrivateIP(ip)).toBe(true);
    },
  );

  it.each(["168.63.129.15", "168.63.129.17", "168.63.1.16"])(
    "blocks only the WireServer address itself, not its neighbour %s",
    (ip) => {
      expect(isPrivateIP(ip)).toBe(false);
    },
  );

  it.each([
    "100.63.255.255", // just below 100.64.0.0/10
    "100.128.0.1", // just above it
    "100.1.1.1", // ordinary public 100.x
    "198.20.0.1", // just above 198.18.0.0/15
    "192.0.1.1", // between 192.0.0.0/24 and TEST-NET-1
  ])("does not over-block the neighbouring public address %s", (ip) => {
    expect(isPrivateIP(ip)).toBe(false);
  });
});

describe("validateScanTarget (DNS-resolving guard)", () => {
  beforeEach(() => mockLookup.mockReset());

  it("blocks a public-looking hostname that RESOLVES to a private IP", async () => {
    // The rebinding/misconfig case: the name looks fine but DNS points inside.
    resolvesTo("10.0.0.5");
    const r = await validateScanTarget("http://internal.example.com/");
    expect(r.safe).toBe(false);
    expect(r.reason).toMatch(/internal|private/i);
  });

  it("blocks a hostname that resolves to the cloud-metadata IP", async () => {
    resolvesTo("169.254.169.254");
    const r = await validateScanTarget("http://metadata.example.com/");
    expect(r.safe).toBe(false);
  });

  it("allows a hostname that resolves to a public IP and pins that IP", async () => {
    resolvesTo("93.184.216.34");
    const r = await validateScanTarget("https://example.com/");
    expect(r.safe).toBe(true);
    expect(r.resolvedIp).toBe("93.184.216.34");
  });

  it("fails closed when DNS returns no addresses", async () => {
    mockLookup.mockResolvedValue([]);
    const r = await validateScanTarget("https://empty.example/");
    expect(r.safe).toBe(false);
  });

  it("blocks a direct private IP literal without any DNS lookup", async () => {
    const r = await validateScanTarget(
      "http://169.254.169.254/latest/meta-data/",
    );
    expect(r.safe).toBe(false);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("blocks the Azure HostGAPlugin URL by its literal address", async () => {
    const r = await validateScanTarget("http://168.63.129.16:32526/vmSettings");
    expect(r).toMatchObject({ safe: false, code: "blocked" });
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("blocks obvious internal hostnames (localhost) syntactically", async () => {
    const r = await validateScanTarget("http://localhost:8080/");
    expect(r.safe).toBe(false);
  });

  // AUDIT-012#ssrf-07: this function is used as a standalone guard all over
  // the scanner, and it had no protocol check at all -- ftp:/gopher: passed
  // it outright and file:/data: only failed as a side effect of an empty
  // hostname. The refusal now comes from a scheme check, before any DNS.
  it.each([
    "ftp://example.com/pub",
    "gopher://example.com:70/",
    "file:///etc/passwd",
    "data:text/plain,hi",
  ])(
    "refuses the non-http(s) scheme %s before resolving anything",
    async (u) => {
      resolvesTo("93.184.216.34");
      const r = await validateScanTarget(u);
      expect(r.safe).toBe(false);
      expect(r.reason).toMatch(/http/i);
      expect(mockLookup).not.toHaveBeenCalled();
    },
  );
});

describe("safeFetch (SSRF-guarded redirect loop)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLookup.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A redirect Response the loop parses via status + Location. */
  function redirect(status: number, location: string) {
    return new Response(null, { status, headers: { location } });
  }

  it("refuses a redirect to the cloud-metadata endpoint (never fetches it)", async () => {
    resolvesTo("93.184.216.34"); // example.com is public
    // First hop: example.com answers 302 -> metadata IP (a different host).
    fetchMock.mockResolvedValueOnce(
      redirect(302, "http://169.254.169.254/latest/meta-data/"),
    );

    // A cross-host redirect (the metadata IP is not example.com) is rejected
    // outright, so the metadata endpoint is never fetched.
    await expect(safeFetch("https://example.com/")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const fetchedUrls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(fetchedUrls.some((u) => u.includes("169.254.169.254"))).toBe(false);
  });

  it("refuses a redirect to a private RFC1918 host (never fetches it)", async () => {
    resolvesTo("93.184.216.34");
    fetchMock.mockResolvedValueOnce(redirect(302, "http://10.0.0.5/admin"));

    await expect(safeFetch("https://example.com/")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls
        .map((c) => String(c[0]))
        .some((u) => u.includes("10.0.0.5")),
    ).toBe(false);
  });

  it("refuses a cross-host redirect to a different registrable domain", async () => {
    resolvesTo("93.184.216.34");
    fetchMock.mockResolvedValueOnce(
      redirect(302, "https://evil.example/steal"),
    );

    await expect(safeFetch("https://example.com/")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls
        .map((c) => String(c[0]))
        .some((u) => u.includes("evil.example")),
    ).toBe(false);
  });

  it("re-validates a same-host redirect and blocks it if the host rebinds to a private IP", async () => {
    // Entry resolves public, but the same-host redirect target re-resolves to
    // a private IP (DNS rebinding). The per-hop validateScanTarget must catch
    // it rather than trusting the first resolution.
    mockLookup
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]) // entry
      .mockResolvedValueOnce([{ address: "10.0.0.9", family: 4 }]); // redirect hop
    fetchMock.mockResolvedValueOnce(redirect(302, "https://example.com/next"));

    await expect(safeFetch("https://example.com/start")).rejects.toThrow();
    // Only the first hop was fetched; the rebound second hop never was.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws before fetching when the target resolves to a private IP", async () => {
    resolvesTo("192.168.1.10");
    await expect(safeFetch("http://internal.example.com/")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails CLOSED and never fetches when DNS resolution fails", async () => {
    // A name that can't be resolved must be refused, not handed to the OS to
    // resolve independently at connect time.
    mockLookup.mockImplementation(() => Promise.reject(new Error("ENOTFOUND")));
    await expect(
      safeFetch("https://does-not-resolve.example/"),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("follows a same-host redirect and returns the final 200", async () => {
    resolvesTo("93.184.216.34");
    fetchMock
      .mockResolvedValueOnce(redirect(302, "https://example.com/final"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await safeFetch("https://example.com/start");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses a non-http(s) scheme outright", async () => {
    await expect(safeFetch("file:///etc/passwd")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // AUDIT-012#ssrf-07: the scheme allowlist ran on the entry URL only, so a
  // same-host Location: with a different scheme cleared both the cross-host
  // test and validateScanTarget and reached fetch().
  it.each(["ftp://example.com/x", "gopher://example.com:70/"])(
    "refuses a same-host redirect that changes the scheme to %s",
    async (location) => {
      resolvesTo("93.184.216.34");
      fetchMock.mockResolvedValueOnce(redirect(302, location));

      await expect(safeFetch("https://example.com/start")).rejects.toThrow(
        /not allowed/i,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  // ── allowedHostnames ─────────────────────────────────────────────────────
  //
  // This is the stated containment for every active probe
  // (lib/scanner/active-probes/shared.ts builds one from the scan target), and
  // nothing exercised it: the parameter could have been ignored entirely and
  // the whole suite stayed green.

  it("refuses a host that is not in allowedHostnames, before resolving or fetching", async () => {
    resolvesTo("93.184.216.34");
    await expect(
      safeFetch("https://other.example/", undefined, ["example.com"]),
    ).rejects.toThrow(/not in the allowed list/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("allows a host that is in allowedHostnames, case-insensitively", async () => {
    resolvesTo("93.184.216.34");
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await safeFetch("https://EXAMPLE.com/probe", undefined, [
      "example.com",
    ]);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats an empty allowedHostnames array as no restriction, not as a deny-all", () => {
    // Documented behaviour of the parameter ("if provided and not empty"),
    // asserted because the opposite reading is the more natural one and a
    // future refactor could silently pick it.
    resolvesTo("93.184.216.34");
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    return expect(
      safeFetch("https://example.com/", undefined, []),
    ).resolves.toMatchObject({ status: 200 });
  });

  it("does not let a www-apex redirect leave the allowedHostnames list", async () => {
    // The redirect loop permits a www <-> apex hop on the same registered
    // domain, and the allow-list used to be checked on the entry URL only, so
    // a probe confined to `example.com` followed a 302 to `www.example.com`
    // and sent its payload to a host it was never allowed to touch. Every hop
    // is held to the list now. ref: AUDIT-012#ssrf-09
    resolvesTo("93.184.216.34");
    fetchMock
      .mockResolvedValueOnce(redirect(302, "https://www.example.com/final"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await expect(
      safeFetch("https://example.com/start", undefined, ["example.com"]),
    ).rejects.toMatchObject({
      code: "blocked",
      message: "Hostname www.example.com is not in the allowed list",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still follows a redirect that stays on an allowed host", async () => {
    resolvesTo("93.184.216.34");
    fetchMock
      .mockResolvedValueOnce(redirect(302, "https://example.com/final"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await safeFetch("https://example.com/start", undefined, [
      "example.com",
    ]);

    expect(res.status).toBe(200);
    expect(res.url).toBe("https://example.com/final");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("follows a www-apex redirect when both names are on the list", async () => {
    resolvesTo("93.184.216.34");
    fetchMock
      .mockResolvedValueOnce(redirect(301, "https://www.example.com/"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await safeFetch("https://example.com/", undefined, [
      "example.com",
      "www.example.com",
    ]);

    expect(res.url).toBe("https://www.example.com/");
  });

  // ── redirect: "error" ────────────────────────────────────────────────────
  //
  // RFC 8461 says an MTA-STS policy fetch must not follow redirects, and the
  // checks that fetch one say so with redirect: "error". safeFetch used to
  // overwrite that with its own loop and follow anyway, so a policy served
  // only behind a redirect read as present.

  it.each([301, 302, 303, 307, 308])(
    'refuses a %i when the caller set redirect: "error", without following it',
    async (status) => {
      resolvesTo("93.184.216.34");
      fetchMock
        .mockResolvedValueOnce(redirect(status, "https://example.com/moved"))
        .mockResolvedValueOnce(new Response("policy", { status: 200 }));

      await expect(
        safeFetch("https://example.com/policy", { redirect: "error" }),
      ).rejects.toMatchObject({
        code: "redirect",
        redirectHost: "example.com",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('returns a non-redirect answer unchanged under redirect: "error"', async () => {
    resolvesTo("93.184.216.34");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));

    const res = await safeFetch("https://example.com/policy", {
      redirect: "error",
    });

    expect(res.status).toBe(304);
  });

  it.each([300, 304])(
    'returns a %i that names a Location under redirect: "error" without following it',
    async (status) => {
      // fetch does not count these as redirects, so redirect: "error" hands
      // them back. safeFetch's own loop follows any 3xx with a Location, and
      // used to follow these for a caller that asked for no redirects.
      resolvesTo("93.184.216.34");
      fetchMock
        .mockResolvedValueOnce(redirect(status, "https://example.com/moved"))
        .mockResolvedValueOnce(new Response("policy", { status: 200 }));

      const res = await safeFetch("https://example.com/policy", {
        redirect: "error",
      });

      expect(res.status).toBe(status);
      expect(res.url).toBe("https://example.com/policy");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("follows by default, as it always has", async () => {
    resolvesTo("93.184.216.34");
    fetchMock
      .mockResolvedValueOnce(redirect(302, "https://example.com/moved"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await safeFetch("https://example.com/policy");

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // ── session credential handling ──────────────────────────────────────────
  //
  // The whole reason authenticated scanning is safe is that the session's
  // headers go on-origin and nowhere else. Nothing asserted it.

  /** Minimal ScanSessionBinding that records which URLs it was asked about. */
  function fakeSession(origin: string) {
    const asked: string[] = [];
    return {
      binding: {
        origin,
        lost: false,
        authHeadersFor(url: string) {
          asked.push(url);
          return url.startsWith(origin) ? { cookie: "sid=secret-value" } : null;
        },
        observe() {},
      },
      asked,
    };
  }

  /** Cookie header of one recorded fetch call, whatever shape init.headers
   *  happens to be (plain object, entry array, or a Headers instance). */
  function cookieHeaderOf(call: unknown[]): string | null {
    const init = call[1] as RequestInit | undefined;
    if (!init?.headers) return null;
    return new Headers(init.headers as HeadersInit).get("cookie");
  }

  it("attaches session headers on-origin", async () => {
    resolvesTo("93.184.216.34");
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const { binding } = fakeSession("https://example.com");

    await safeFetch(
      "https://example.com/dashboard",
      undefined,
      undefined,
      binding,
    );

    expect(cookieHeaderOf(fetchMock.mock.calls[0])).toBe("sid=secret-value");
  });

  it("drops the session credentials on a redirect that leaves the origin", async () => {
    // www.example.com is a different origin from example.com, and it is also
    // the one cross-host hop the redirect loop permits, so it is exactly the
    // case where credentials could leak if authHeadersFor were consulted once
    // instead of per hop.
    resolvesTo("93.184.216.34");
    fetchMock
      .mockResolvedValueOnce(redirect(302, "https://www.example.com/final"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const { binding } = fakeSession("https://example.com");

    await safeFetch("https://example.com/start", undefined, undefined, binding);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cookieHeaderOf(fetchMock.mock.calls[0])).toBe("sid=secret-value");
    expect(
      cookieHeaderOf(fetchMock.mock.calls[1]),
      "The second hop is off-origin: it must carry no session cookie.",
    ).toBeNull();
  });

  it("refuses an authenticated request to a sign-out URL rather than requesting it unauthenticated", async () => {
    // Stripping the credentials would not help. Walking the scan into /logout
    // at all is the problem, so the refusal has to happen before any fetch.
    resolvesTo("93.184.216.34");
    const { binding } = fakeSession("https://example.com");

    await expect(
      safeFetch("https://example.com/logout", undefined, undefined, binding),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── shared by the blocks below ─────────────────────────────────────────────

function redirectTo(status: number, location: string) {
  return new Response(null, { status, headers: { location } });
}

/** What undici throws for a socket-level failure: a bare "fetch failed" with
 *  the real reason, code included, on `cause`. */
function fetchFailed(code: string) {
  const cause = Object.assign(new Error(`connect ${code} 93.184.216.34:443`), {
    code,
  });
  return new TypeError("fetch failed", { cause });
}

/** A fetch that never answers on its own and rejects with the signal's reason
 *  the moment the signal aborts, which is what undici does. */
function hangsUntilAborted(
  fetchMock: ReturnType<typeof vi.fn>,
  seen: { signal?: AbortSignal } = {},
) {
  fetchMock.mockImplementation(
    (_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal;
        seen.signal = signal;
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
  );
  return seen;
}

describe("safeFetch (every hop is fetched by name on a socket pinned to its approved address)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLookup.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** The URL fetch was given and where its dispatcher will connect. The
   *  socket itself is covered by safe-fetch-pinning.test.ts. */
  const dialOf = (call: unknown[]) => {
    const dispatcher = (call[1] as { dispatcher?: PinnedDispatcher })
      .dispatcher;
    return {
      url: String(call[0]),
      hostname: dispatcher?.hostname,
      address: dispatcher?.address,
    };
  };

  // The URL used to be rewritten to the IP. undici then sent the IP as Host,
  // and the Location was resolved against the IP URL, so "/next" became
  // http://93.184.216.34/next and the cross-host test read the IP as a
  // different host.
  it("fetches a plain-HTTP target by name, pinned to the address it was approved at", async () => {
    resolvesTo("93.184.216.34");
    fetchMock
      .mockResolvedValueOnce(redirectTo(302, "/next"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await safeFetch("http://example.com/start");

    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls.map(dialOf)).toEqual([
      {
        url: "http://example.com/start",
        hostname: "example.com",
        address: "93.184.216.34",
      },
      {
        url: "http://example.com/next",
        hostname: "example.com",
        address: "93.184.216.34",
      },
    ]);
  });

  it("pins an https target the same way", async () => {
    resolvesTo("93.184.216.34");
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await safeFetch("https://example.com/");

    expect(dialOf(fetchMock.mock.calls[0])).toEqual({
      url: "https://example.com/",
      hostname: "example.com",
      address: "93.184.216.34",
    });
  });

  it("pins each hop to the address re-validated for that hop", async () => {
    mockLookup
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "93.184.216.35", family: 4 }]);
    fetchMock
      .mockResolvedValueOnce(redirectTo(301, "https://www.example.com/"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await safeFetch("https://example.com/");

    expect(fetchMock.mock.calls.map(dialOf)).toEqual([
      {
        url: "https://example.com/",
        hostname: "example.com",
        address: "93.184.216.34",
      },
      {
        url: "https://www.example.com/",
        hostname: "www.example.com",
        address: "93.184.216.35",
      },
    ]);
  });

  it.each(["/docs/", "docs/", "?page=2", "#frag"])(
    "resolves the relative Location %j against the hostname URL",
    async (location) => {
      resolvesTo("93.184.216.34");
      fetchMock
        .mockResolvedValueOnce(redirectTo(301, location))
        .mockResolvedValueOnce(new Response("ok", { status: 200 }));

      const res = await safeFetch("http://example.com/docs");

      expect(res.status).toBe(200);
      expect(new URL(res.url).hostname).toBe("example.com");
    },
  );

  it("keeps the port on a relative redirect", async () => {
    resolvesTo("93.184.216.34");
    fetchMock
      .mockResolvedValueOnce(redirectTo(302, "/next"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await safeFetch("http://example.com:8080/start");

    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      "http://example.com:8080/start",
      "http://example.com:8080/next",
    ]);
    expect(res.url).toBe("http://example.com:8080/next");
  });

  it("follows an absolute Location to the default port instead of carrying the old port over", async () => {
    // The old code copied the previous hop's port onto a Location that named
    // none, so the request went to :8080 while the URL it reported said :80.
    resolvesTo("93.184.216.34");
    fetchMock
      .mockResolvedValueOnce(redirectTo(301, "http://example.com/x"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await safeFetch("http://example.com:8080/start");

    expect(String(fetchMock.mock.calls[1][0])).toBe("http://example.com/x");
    expect(res.url).toBe("http://example.com/x");
  });

  it("still refuses a scheme-relative Location that names another host", async () => {
    // The base for resolving Location changed, so this is the case that proves
    // the cross-host guard did not loosen with it.
    resolvesTo("93.184.216.34");
    fetchMock.mockResolvedValueOnce(redirectTo(302, "//evil.example/x"));

    await expect(safeFetch("http://example.com/start")).rejects.toMatchObject({
      code: "cross_host_redirect",
      redirectHost: "evil.example",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports the hostname URL as response.url when nothing redirected", async () => {
    resolvesTo("93.184.216.34");
    // Whatever the Response says it came from, response.url is the URL asked
    // for (the IP is what undici reported when the URL was rewritten to it).
    const upstream = new Response("ok", { status: 200 });
    Object.defineProperty(upstream, "url", {
      value: "http://93.184.216.34/page?a=1",
      configurable: true,
    });
    fetchMock.mockResolvedValueOnce(upstream);

    const res = await safeFetch("http://example.com/page?a=1");

    expect(res.url).toBe("http://example.com/page?a=1");
  });

  it("reports the URL after a same-host redirect, by name", async () => {
    resolvesTo("93.184.216.34");
    fetchMock
      .mockResolvedValueOnce(redirectTo(302, "/final"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await safeFetch("http://example.com/start");

    expect(res.url).toBe("http://example.com/final");
  });

  it("reports the www host after an apex-to-www redirect", async () => {
    resolvesTo("93.184.216.34");
    fetchMock
      .mockResolvedValueOnce(redirectTo(301, "http://www.example.com/"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await safeFetch("http://example.com/");

    expect(res.url).toBe("http://www.example.com/");
    expect(dialOf(fetchMock.mock.calls[1]).hostname).toBe("www.example.com");
  });

  it("reports the hostname for https targets too", async () => {
    resolvesTo("93.184.216.34");
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await safeFetch("https://example.com/secure");

    expect(res.url).toBe("https://example.com/secure");
  });

  it("reports the hostname URL on a 3xx it hands back at the redirect cap", async () => {
    resolvesTo("93.184.216.34");
    for (let i = 0; i < 6; i++) {
      fetchMock.mockResolvedValueOnce(redirectTo(302, "/loop"));
    }

    const res = await safeFetch("http://example.com/start");

    expect(res.status).toBe(302);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(res.url).toBe("http://example.com/loop");
  });

  it("reports the hostname URL on a 3xx with no Location", async () => {
    resolvesTo("93.184.216.34");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));

    const res = await safeFetch("http://example.com/cached");

    expect(res.status).toBe(304);
    expect(res.url).toBe("http://example.com/cached");
  });

  it("is a no-op for a caller comparing response.url to the URL it asked for", async () => {
    // execute-scan treats any difference as "the page redirected elsewhere".
    resolvesTo("93.184.216.34");
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const asked = new URL("http://example.com/").href;

    const res = await safeFetch(asked);

    expect(res.url).toBe(asked);
  });
});

describe("safeFetch (the caller's deadline governs)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLookup.mockReset();
    resolvesTo("93.184.216.34");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Settle a safeFetch promise without leaving a rejection unhandled while
   *  fake time is advanced under it. */
  function track<T>(p: Promise<T>) {
    const state: { done: boolean; value?: T; error?: unknown } = {
      done: false,
    };
    p.then(
      (value) => Object.assign(state, { done: true, value }),
      (error) => Object.assign(state, { done: true, error }),
    );
    return state;
  }

  const timeoutReason = () =>
    new DOMException(
      "The operation was aborted due to timeout",
      "TimeoutError",
    );

  it("cuts a call with no signal off at the 15s default, with a TimeoutError", async () => {
    const seen = hangsUntilAborted(fetchMock);
    const outcome = track(safeFetch("https://example.com/"));

    await vi.advanceTimersByTimeAsync(14_999);
    expect(outcome.done).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(outcome.done).toBe(true);
    expect(outcome.error).toMatchObject({ code: "timeout" });
    expect(seen.signal?.reason).toMatchObject({ name: "TimeoutError" });
  });

  // The audit's repro: SCAN_FETCH_TIMEOUT_MS raised to 60s, request cut off at
  // 15s anyway because the compiled timer ran next to the caller's.
  it("lets a caller signal outlive the 15s default", async () => {
    const caller = new AbortController();
    setTimeout(() => caller.abort(timeoutReason()), 60_000);
    fetchMock.mockImplementation(
      (_url: unknown, init?: RequestInit) =>
        new Promise((resolve, reject) => {
          const signal = init?.signal as AbortSignal;
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
          setTimeout(
            () => resolve(new Response("slow", { status: 200 })),
            40_000,
          );
        }),
    );

    const outcome = track(
      safeFetch("https://example.com/", { signal: caller.signal }),
    );
    await vi.advanceTimersByTimeAsync(40_000);

    expect(outcome.done).toBe(true);
    expect(outcome.error).toBeUndefined();
    expect((outcome.value as Response).status).toBe(200);
  });

  it("aborts at the caller's own deadline and surfaces the caller's reason", async () => {
    const caller = new AbortController();
    const reason = timeoutReason();
    setTimeout(() => caller.abort(reason), 20_000);
    const seen = hangsUntilAborted(fetchMock);

    const outcome = track(
      safeFetch("https://example.com/", { signal: caller.signal }),
    );
    await vi.advanceTimersByTimeAsync(19_999);
    expect(outcome.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(outcome.error).toMatchObject({ code: "timeout" });
    expect(seen.signal?.reason).toBe(reason);
    expect((outcome.error as Error).cause).toBe(reason);
  });

  it("falls back to the registry maximum for a caller signal that never aborts", async () => {
    const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");
    const max = SETTINGS_REGISTRY.SCAN_FETCH_TIMEOUT_MS.max;
    // The number itself belongs to the registry; what safeFetch owes is that it
    // reads it from there and that it sits above the no-signal default.
    expect(max).toBeGreaterThan(15_000);
    const seen = hangsUntilAborted(fetchMock);

    const outcome = track(
      safeFetch("https://example.com/", {
        signal: new AbortController().signal,
      }),
    );
    await vi.advanceTimersByTimeAsync(max - 1);
    expect(outcome.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(outcome.error).toMatchObject({ code: "timeout" });
    expect(seen.signal?.reason).toMatchObject({ name: "TimeoutError" });
  });

  it("treats an explicit null signal as no signal", async () => {
    hangsUntilAborted(fetchMock);

    const outcome = track(safeFetch("https://example.com/", { signal: null }));
    await vi.advanceTimersByTimeAsync(15_000);

    expect(outcome.error).toMatchObject({ code: "timeout" });
  });

  it("recognises a deadline from a runtime that wraps the reason in a generic AbortError", async () => {
    // Older undici rejects with its own AbortError rather than signal.reason.
    // The signal still says why it aborted.
    fetchMock.mockImplementation(
      (_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          (init!.signal as AbortSignal).addEventListener(
            "abort",
            () =>
              reject(
                new DOMException("This operation was aborted", "AbortError"),
              ),
            { once: true },
          );
        }),
    );

    const outcome = track(safeFetch("https://example.com/"));
    await vi.advanceTimersByTimeAsync(15_000);

    expect(outcome.error).toMatchObject({
      code: "timeout",
      message: "This operation was aborted",
    });
  });
});

describe("safeFetch (abort reasons survive the signal merge)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLookup.mockReset();
    resolvesTo("93.184.216.34");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Let safeFetch get as far as awaiting fetch (it awaits a DNS lookup first). */
  const untilFetchStarted = () =>
    vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

  it("hands fetch the caller's TimeoutError, not a bare AbortError", async () => {
    const caller = new AbortController();
    const seen = hangsUntilAborted(fetchMock);

    const outcome = safeFetch("https://example.com/", {
      signal: caller.signal,
    }).catch((e) => e);
    await untilFetchStarted();
    const reason = new DOMException(
      "The operation was aborted due to timeout",
      "TimeoutError",
    );
    caller.abort(reason);

    expect(await outcome).toMatchObject({ code: "timeout" });
    expect(seen.signal?.reason).toBe(reason);
  });

  it("hands fetch an already-aborted caller signal's own reason", async () => {
    const reason = new DOMException(
      "The operation was aborted due to timeout",
      "TimeoutError",
    );
    hangsUntilAborted(fetchMock);

    await expect(
      safeFetch("https://example.com/", { signal: AbortSignal.abort(reason) }),
    ).rejects.toMatchObject({ code: "timeout", cause: reason });
  });

  it("lets a cancelled scan's AbortError through untouched and unclassified", async () => {
    // Callers tell a cancel from a failure by the AbortError, and a cancel is
    // not one of the five codes: wrapping it would turn Cancel into a failure.
    const cancel = new AbortController();
    hangsUntilAborted(fetchMock);

    const outcome = safeFetch("https://example.com/", {
      signal: cancel.signal,
    }).catch((e) => e);
    await untilFetchStarted();
    cancel.abort();

    const err = await outcome;
    expect(err).toBe(cancel.signal.reason);
    expect(err).not.toBeInstanceOf(SafeFetchError);
    expect(err.name).toBe("AbortError");
  });

  it("forwards the reason on the second hop of a redirect chain", async () => {
    const caller = new AbortController();
    const seenSignals: AbortSignal[] = [];
    fetchMock
      .mockImplementationOnce((_url: unknown, init?: RequestInit) => {
        seenSignals.push(init?.signal as AbortSignal);
        return Promise.resolve(redirectTo(302, "https://example.com/two"));
      })
      .mockImplementationOnce(
        (_url: unknown, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            const signal = init?.signal as AbortSignal;
            seenSignals.push(signal);
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          }),
      );

    const outcome = safeFetch("https://example.com/one", {
      signal: caller.signal,
    }).catch((e) => e);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const reason = new DOMException("t", "TimeoutError");
    caller.abort(reason);

    expect(await outcome).toMatchObject({ code: "timeout" });
    expect(seenSignals).toHaveLength(2);
    expect(seenSignals[1].reason).toBe(reason);
  });
});

describe("safeFetch (thrown errors carry a code)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockLookup.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("cross_host_redirect names the host it refused to follow, message unchanged", async () => {
    resolvesTo("93.184.216.34");
    fetchMock.mockResolvedValueOnce(
      redirectTo(302, "https://app.other.example/login"),
    );

    const err = await safeFetch("https://example.com/").catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("cross_host_redirect");
    expect(err.redirectHost).toBe("app.other.example");
    expect(err.message).toBe(
      "Redirect to a different host (app.other.example) is not allowed.",
    );
  });

  it("cross_host_redirect also covers a redirect straight to a private address", async () => {
    resolvesTo("93.184.216.34");
    fetchMock.mockResolvedValueOnce(
      redirectTo(302, "http://169.254.169.254/latest/meta-data/"),
    );

    await expect(safeFetch("https://example.com/")).rejects.toMatchObject({
      code: "cross_host_redirect",
      redirectHost: "169.254.169.254",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe("blocked", () => {
    it("a hostname that resolves to a private address", async () => {
      resolvesTo("192.168.1.10");
      const err = await safeFetch("http://internal.example.com/").catch(
        (e) => e,
      );
      expect(err.code).toBe("blocked");
      expect(err.message).toBe(
        "Domain resolves to internal IP address. Scanning internal networks is not allowed.",
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("a private IP literal", async () => {
      const err = await safeFetch("http://169.254.169.254/").catch((e) => e);
      expect(err.code).toBe("blocked");
      expect(err.message).toBe(
        "Scanning internal/private IP addresses is not allowed for security reasons.",
      );
    });

    it.each([
      [
        "file:///etc/passwd",
        "Invalid protocol - only http: and https: are allowed",
      ],
      ["not a url", "Invalid URL format"],
      ["http://localhost/", "Access to local hostnames is not allowed"],
      ["http://db.internal/", "Access to local hostnames is not allowed"],
      ["http://devbox/", "Access to unqualified hostnames is not allowed"],
    ])("the syntactic gate on %s", async (url, message) => {
      const err = await safeFetch(url).catch((e) => e);
      expect(err.code).toBe("blocked");
      expect(err.message).toBe(message);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("a host outside allowedHostnames", async () => {
      const err = await safeFetch("https://other.example/", undefined, [
        "example.com",
      ]).catch((e) => e);
      expect(err.code).toBe("blocked");
      expect(err.message).toBe(
        "Hostname other.example is not in the allowed list",
      );
    });

    it("a same-host redirect whose address rebinds to a private one", async () => {
      mockLookup
        .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
        .mockResolvedValueOnce([{ address: "10.0.0.9", family: 4 }]);
      fetchMock.mockResolvedValueOnce(
        redirectTo(302, "https://example.com/next"),
      );

      await expect(
        safeFetch("https://example.com/start"),
      ).rejects.toMatchObject({ code: "blocked" });
    });

    it("a same-host redirect that changes the scheme", async () => {
      resolvesTo("93.184.216.34");
      fetchMock.mockResolvedValueOnce(redirectTo(302, "ftp://example.com/x"));

      const err = await safeFetch("https://example.com/start").catch((e) => e);
      expect(err.code).toBe("blocked");
      expect(err.message).toMatch(
        /^Redirect to ftp:\/\/example\.com is not allowed:/,
      );
    });

    it("a sign-out URL on an authenticated request", async () => {
      resolvesTo("93.184.216.34");
      const binding = {
        origin: "https://example.com",
        lost: false,
        authHeadersFor: () => ({ cookie: "sid=x" }),
        observe() {},
      };

      await expect(
        safeFetch("https://example.com/logout", undefined, undefined, binding),
      ).rejects.toMatchObject({ code: "blocked" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("unreachable", () => {
    it("a name that does not resolve is the target being down, not a block", async () => {
      const dnsError = Object.assign(
        new Error("getaddrinfo ENOTFOUND nope.example"),
        { code: "ENOTFOUND" },
      );
      mockLookup.mockRejectedValue(dnsError);

      const err = await safeFetch("https://nope.example/").catch((e) => e);

      expect(err.code).toBe("unreachable");
      expect(err.message).toBe(
        "DNS resolution failed — cannot verify target is safe to scan.",
      );
      expect(err.cause).toBe(dnsError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("a name that resolves to nothing", async () => {
      mockLookup.mockResolvedValue([]);

      await expect(safeFetch("https://empty.example/")).rejects.toMatchObject({
        code: "unreachable",
        message:
          "Domain resolved to no addresses — cannot verify target is safe to scan.",
      });
    });

    it("a same-host redirect whose name stops resolving", async () => {
      mockLookup
        .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
        .mockRejectedValueOnce(new Error("ESERVFAIL"));
      fetchMock.mockResolvedValueOnce(
        redirectTo(302, "https://example.com/next"),
      );

      await expect(
        safeFetch("https://example.com/start"),
      ).rejects.toMatchObject({ code: "unreachable" });
    });

    it.each([
      "ECONNREFUSED",
      "ECONNRESET",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ECONNABORTED",
      "EPIPE",
      "UND_ERR_SOCKET",
    ])("fetch failing with cause.code %s", async (code) => {
      resolvesTo("93.184.216.34");
      const failure = fetchFailed(code);
      fetchMock.mockRejectedValueOnce(failure);

      const err = await safeFetch("https://example.com/").catch((e) => e);

      expect(err.code).toBe("unreachable");
      expect(err.message).toBe("fetch failed");
      expect(err.cause).toBe(failure);
      expect(err.cause.cause.code).toBe(code);
    });

    it("a dual-stack connect failure, where the code sits on an inner error", async () => {
      resolvesTo("93.184.216.34");
      const aggregate = new AggregateError(
        [
          Object.assign(new Error("connect ECONNREFUSED ::1:443"), {
            code: "ECONNREFUSED",
          }),
          Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), {
            code: "ECONNREFUSED",
          }),
        ],
        "",
      );
      fetchMock.mockRejectedValueOnce(
        new TypeError("fetch failed", { cause: aggregate }),
      );

      await expect(safeFetch("https://example.com/")).rejects.toMatchObject({
        code: "unreachable",
      });
    });
  });

  describe("tls", () => {
    it.each([
      "CERT_HAS_EXPIRED",
      "CERT_NOT_YET_VALID",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "ERR_TLS_CERT_ALTNAME_INVALID",
      "ERR_SSL_WRONG_VERSION_NUMBER",
      "ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE",
      "EPROTO",
    ])("fetch failing with cause.code %s", async (code) => {
      resolvesTo("93.184.216.34");
      fetchMock.mockRejectedValueOnce(fetchFailed(code));

      const err = await safeFetch("https://example.com/").catch((e) => e);

      expect(err.code).toBe("tls");
      expect(err.message).toBe("fetch failed");
      expect(err.cause.cause.code).toBe(code);
    });
  });

  describe("timeout", () => {
    it.each([
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_BODY_TIMEOUT",
      "ETIMEDOUT",
      "ESOCKETTIMEDOUT",
    ])("fetch failing with cause.code %s", async (code) => {
      resolvesTo("93.184.216.34");
      fetchMock.mockRejectedValueOnce(fetchFailed(code));

      const err = await safeFetch("https://example.com/").catch((e) => e);

      expect(err.code).toBe("timeout");
      expect(err.message).toBe("fetch failed");
    });
  });

  describe("everything else", () => {
    it("rethrows a failure it cannot classify as the very error fetch threw", async () => {
      resolvesTo("93.184.216.34");
      const failure = new TypeError("fetch failed", {
        cause: Object.assign(new Error("bad header"), {
          code: "ERR_INVALID_CHAR",
        }),
      });
      fetchMock.mockRejectedValueOnce(failure);

      const err = await safeFetch("https://example.com/").catch((e) => e);

      expect(err).toBe(failure);
      expect(err).not.toBeInstanceOf(SafeFetchError);
    });

    it("throws a SafeFetchError an Error subclass named for what it is", async () => {
      resolvesTo("93.184.216.34");
      fetchMock.mockRejectedValueOnce(fetchFailed("ECONNREFUSED"));

      const err = await safeFetch("https://example.com/").catch((e) => e);

      expect(err).toBeInstanceOf(SafeFetchError);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("SafeFetchError");
    });
  });
});
