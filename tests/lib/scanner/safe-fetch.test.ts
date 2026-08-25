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
});
