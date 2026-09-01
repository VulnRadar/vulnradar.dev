import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Control DNS resolution so validateScanTarget's resolve-then-check path and
// safeFetch's per-hop re-validation can be exercised deterministically. The
// network boundary (fetch) is mocked per-test below.
const mockLookup = vi.fn();
vi.mock("dns/promises", () => ({
  lookup: (...args: unknown[]) => mockLookup(...args),
}));

const { isPrivateIP, validateScanTarget, safeFetch } =
  await import("@/lib/scanner/safe-fetch");

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
  ])("blocks %s", (ip) => {
    expect(isPrivateIP(ip)).toBe(true);
  });

  it.each([
    // Genuine public addresses must NOT match
    "2606:4700:4700::1111", // Cloudflare DNS
    "2001:4860:4860::8888", // Google DNS
    "::ffff:1.1.1.1", // Cloudflare IPv4-mapped public
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

  it("STILL lets a www-apex redirect leave the allowedHostnames list (known gap, fails once fixed)", async () => {
    // The allow-list is checked on the entry URL only. The redirect loop
    // separately permits a www <-> apex hop on the same registered domain, so
    // a probe pinned to `example.com` follows a 302 to `www.example.com`,
    // which is a host it was never allowed to touch. Narrow (same registered
    // domain, and every hop still passes the full SSRF guard) but it is not
    // the containment the parameter's contract describes.
    //
    // Written as an assertion of the CURRENT behaviour on purpose: closing the
    // gap makes this test fail and tells you to invert it, so the gap cannot
    // quietly persist or quietly disappear. The fix belongs in
    // lib/scanner/safe-fetch.ts's redirect loop (re-apply the allow-list to
    // nextUrlObj.hostname), which is outside the file ownership of the pass
    // that added this test. ref: AUDIT-012#ssrf-09
    resolvesTo("93.184.216.34");
    fetchMock
      .mockResolvedValueOnce(redirect(302, "https://www.example.com/final"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const res = await safeFetch("https://example.com/start", undefined, [
      "example.com",
    ]);

    expect(res.status).toBe(200);
    const hostsFetched = fetchMock.mock.calls.map(
      (c) => new URL(String(c[0])).hostname,
    );
    expect(
      hostsFetched,
      "safeFetch now re-checks allowedHostnames on redirect hops. Invert this test: it should expect a rejection and a single fetch.",
    ).toEqual(["example.com", "www.example.com"]);
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
