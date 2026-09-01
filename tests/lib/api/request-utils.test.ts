import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

/**
 * ip-binding: tests for ipsInSameSubnet (the new subnet-comparison
 * primitive) and a regression suite for getClientIp's existing
 * TRUSTED_PROXY_CIDR handling, which the ip-binding feature reads from
 * but must not change in any way.
 */

const mockHeaders = new Map<string, string>();

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (name: string) => mockHeaders.get(name.toLowerCase()) ?? null,
  })),
}));

const {
  getClientIp,
  normalizeIp,
  ipsInSameSubnet,
  rateLimitIpKey,
  getUserAgent,
  getReferer,
  getBearerToken,
  isBot,
  isPreflight,
  isMethod,
} = await import("@/lib/api/request-utils");
const {
  CONFIG_SESSION_IP_BINDING_IPV4_PREFIX,
  CONFIG_SESSION_IP_BINDING_IPV6_PREFIX,
  CONFIG_API_KEY_IP_BINDING_IPV4_PREFIX,
  CONFIG_API_KEY_IP_BINDING_IPV6_PREFIX,
} = await import("@/lib/config/config-values");

const originalTrustedProxyCidr = process.env.TRUSTED_PROXY_CIDR;

beforeEach(() => {
  mockHeaders.clear();
  delete process.env.TRUSTED_PROXY_CIDR;
});

afterAll(() => {
  // Restore whatever the environment had before this suite ran, so other
  // suites in the same worker aren't affected.
  if (originalTrustedProxyCidr === undefined) {
    delete process.env.TRUSTED_PROXY_CIDR;
  } else {
    process.env.TRUSTED_PROXY_CIDR = originalTrustedProxyCidr;
  }
});

describe("ipsInSameSubnet", () => {
  it("matches IPv4 addresses within the same /24", () => {
    expect(ipsInSameSubnet("203.0.113.5", "203.0.113.250", 24, 48)).toBe(true);
  });

  it("rejects IPv4 addresses in different /24s", () => {
    expect(ipsInSameSubnet("203.0.113.5", "203.0.114.5", 24, 48)).toBe(false);
  });

  it("requires an exact match at a /32 prefix", () => {
    expect(ipsInSameSubnet("203.0.113.5", "203.0.113.6", 32, 128)).toBe(false);
    expect(ipsInSameSubnet("203.0.113.5", "203.0.113.5", 32, 128)).toBe(true);
  });

  it("treats a /0 prefix as always matching", () => {
    expect(ipsInSameSubnet("1.2.3.4", "5.6.7.8", 0, 0)).toBe(true);
  });

  it("matches IPv6 addresses within the same /48", () => {
    expect(
      ipsInSameSubnet("2001:db8:abcd:1::1", "2001:db8:abcd:ffff::2", 24, 48),
    ).toBe(true);
  });

  it("rejects IPv6 addresses in different /48s", () => {
    expect(
      ipsInSameSubnet("2001:db8:abcd::1", "2001:db9:abcd::1", 24, 48),
    ).toBe(false);
  });

  it("returns false when the two addresses are different IP versions", () => {
    expect(ipsInSameSubnet("203.0.113.5", "2001:db8::1", 24, 48)).toBe(false);
  });

  it('returns false for "unknown" or otherwise unparsable input', () => {
    expect(ipsInSameSubnet("unknown", "203.0.113.5", 24, 48)).toBe(false);
    expect(ipsInSameSubnet("unknown", "unknown", 24, 48)).toBe(false);
    expect(ipsInSameSubnet("not-an-ip", "203.0.113.5", 24, 48)).toBe(false);
  });

  it("clamps out-of-range prefix bits instead of throwing", () => {
    expect(() =>
      ipsInSameSubnet("203.0.113.5", "203.0.113.5", 999, -5),
    ).not.toThrow();
  });

  // Documents the actual policy difference between the two features: the
  // session default (/24, /48) tolerates a carrier reassigning the last
  // IPv4 octet mid-session, while the API key default (/32, /128) does
  // not, on the theory that a deployment turning key binding on at all
  // has a genuinely fixed server IP. See lib/config/config-values.ts.
  it("session defaults tolerate a same-/24 IP change that the API key defaults reject", () => {
    const previous = "203.0.113.5";
    const current = "203.0.113.250"; // same /24, different last octet

    expect(
      ipsInSameSubnet(
        current,
        previous,
        CONFIG_SESSION_IP_BINDING_IPV4_PREFIX,
        CONFIG_SESSION_IP_BINDING_IPV6_PREFIX,
      ),
    ).toBe(true);

    expect(
      ipsInSameSubnet(
        current,
        previous,
        CONFIG_API_KEY_IP_BINDING_IPV4_PREFIX,
        CONFIG_API_KEY_IP_BINDING_IPV6_PREFIX,
      ),
    ).toBe(false);
  });
});

describe("normalizeIp", () => {
  it("returns a plain valid IPv4 unchanged", () => {
    expect(normalizeIp("203.0.113.9")).toBe("203.0.113.9");
  });

  it("returns a valid (compressed) IPv6 unchanged", () => {
    // The exact address a user flagged: it IS a valid IPv6, so it must
    // survive normalization untouched rather than be mangled or dropped.
    expect(normalizeIp("2a09:bac3:9f9a:1046::19f:f7")).toBe(
      "2a09:bac3:9f9a:1046::19f:f7",
    );
  });

  it("strips a trailing port from an IPv4 address", () => {
    expect(normalizeIp("203.0.113.9:54321")).toBe("203.0.113.9");
  });

  it("strips brackets and port from a bracketed IPv6 address", () => {
    expect(normalizeIp("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(normalizeIp("[2001:db8::1]")).toBe("2001:db8::1");
  });

  it("unwraps an IPv4-mapped IPv6 address to its IPv4 form", () => {
    expect(normalizeIp("::ffff:203.0.113.9")).toBe("203.0.113.9");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeIp("  203.0.113.9  ")).toBe("203.0.113.9");
  });

  it("returns null for values that are not an IP", () => {
    expect(normalizeIp("not-an-ip")).toBeNull();
    expect(normalizeIp("")).toBeNull();
    expect(normalizeIp("unknown")).toBeNull();
    // A junk suffix that is not a numeric port must not be silently stripped.
    expect(normalizeIp("1.2.3.4:notaport")).toBeNull();
  });
});

describe("getClientIp (normalization — always yields a real IP or 'unknown')", () => {
  it("strips a port off the chosen x-forwarded-for hop", async () => {
    mockHeaders.set("x-forwarded-for", "203.0.113.9:54321");
    expect(await getClientIp()).toBe("203.0.113.9");
  });

  it("unwraps an IPv4-mapped IPv6 hop", async () => {
    mockHeaders.set("x-forwarded-for", "::ffff:198.51.100.7");
    expect(await getClientIp()).toBe("198.51.100.7");
  });

  it("skips a garbage rightmost hop and returns the next valid one", async () => {
    mockHeaders.set("x-forwarded-for", "203.0.113.9, junk-not-an-ip");
    expect(await getClientIp()).toBe("203.0.113.9");
  });

  it("normalizes the x-real-ip fallback too", async () => {
    mockHeaders.set("x-real-ip", "198.51.100.7:8080");
    expect(await getClientIp()).toBe("198.51.100.7");
  });

  it("returns 'unknown' when no header carries a valid IP", async () => {
    mockHeaders.set("x-forwarded-for", "not-an-ip, still-not-an-ip");
    expect(await getClientIp()).toBe("unknown");
  });

  it("skips a junk hop while walking past trusted proxies", async () => {
    process.env.TRUSTED_PROXY_CIDR = "10.0.0.0/8";
    mockHeaders.set("x-forwarded-for", "203.0.113.9, junk, 10.0.0.5");
    expect(await getClientIp()).toBe("203.0.113.9");
  });
});

describe("getClientIp (regression — must be unaffected by ip-binding)", () => {
  it("returns the rightmost hop when no trusted proxy is configured", async () => {
    mockHeaders.set("x-forwarded-for", "1.1.1.1, 2.2.2.2, 3.3.3.3");
    expect(await getClientIp()).toBe("3.3.3.3");
  });

  it("walks x-forwarded-for right-to-left past trusted proxy hops", async () => {
    process.env.TRUSTED_PROXY_CIDR = "10.0.0.0/8";
    mockHeaders.set("x-forwarded-for", "203.0.113.9, 10.0.0.5, 10.0.0.6");
    expect(await getClientIp()).toBe("203.0.113.9");
  });

  it("treats every hop as trusted-adjacent and returns the leftmost real client across multiple ranges", async () => {
    process.env.TRUSTED_PROXY_CIDR = "10.0.0.0/8,172.16.0.0/12";
    mockHeaders.set("x-forwarded-for", "198.51.100.4, 172.16.5.1, 10.1.2.3");
    expect(await getClientIp()).toBe("198.51.100.4");
  });

  it("falls back to x-real-ip when there is no x-forwarded-for", async () => {
    mockHeaders.set("x-real-ip", "198.51.100.7");
    expect(await getClientIp()).toBe("198.51.100.7");
  });

  it('falls back to "unknown" when no IP header is present', async () => {
    expect(await getClientIp()).toBe("unknown");
  });
});

describe("getUserAgent", () => {
  it("returns the User-Agent header", async () => {
    mockHeaders.set("user-agent", "Mozilla/5.0 test-agent");
    expect(await getUserAgent()).toBe("Mozilla/5.0 test-agent");
  });

  it('falls back to "unknown" when the header is absent', async () => {
    expect(await getUserAgent()).toBe("unknown");
  });
});

describe("getReferer", () => {
  it("returns the Referer header", async () => {
    mockHeaders.set("referer", "https://example.com/page");
    expect(await getReferer()).toBe("https://example.com/page");
  });

  it("returns null when the header is absent", async () => {
    expect(await getReferer()).toBeNull();
  });
});

describe("getBearerToken", () => {
  it("extracts the token from a Bearer authorization header", async () => {
    mockHeaders.set("authorization", "Bearer abc123");
    expect(await getBearerToken()).toBe("abc123");
  });

  it("returns null when the authorization header is missing", async () => {
    expect(await getBearerToken()).toBeNull();
  });

  it("returns null for a non-Bearer auth scheme", async () => {
    mockHeaders.set("authorization", "Basic dXNlcjpwYXNz");
    expect(await getBearerToken()).toBeNull();
  });

  it("returns an empty string for a bare 'Bearer ' prefix with nothing after it", async () => {
    mockHeaders.set("authorization", "Bearer ");
    expect(await getBearerToken()).toBe("");
  });
});

describe("isBot", () => {
  it.each([
    "Googlebot/2.1 (+http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0)",
    "some-random-Crawler/1.0",
    "a spider-thing/1.0",
    "a-scraper-tool/3.2",
    "HeadlessChrome/120.0.0.0",
    "generic BOT client",
  ])("flags %s as a bot", async (ua) => {
    mockHeaders.set("user-agent", ua);
    expect(await isBot()).toBe(true);
  });

  it("does not flag a normal browser UA as a bot", async () => {
    mockHeaders.set(
      "user-agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
    );
    expect(await isBot()).toBe(false);
  });

  it('does not flag "unknown" (no UA header at all) as a bot', async () => {
    expect(await isBot()).toBe(false);
  });
});

describe("isPreflight", () => {
  it("is true only for an OPTIONS method", () => {
    expect(isPreflight("OPTIONS")).toBe(true);
    expect(isPreflight("GET")).toBe(false);
    expect(isPreflight("POST")).toBe(false);
  });

  it("is case-sensitive (does not treat lowercase 'options' as preflight)", () => {
    expect(isPreflight("options")).toBe(false);
  });
});

describe("isMethod", () => {
  it("matches when the method (uppercased) is in the allowed list", () => {
    expect(isMethod("GET", "GET", "POST")).toBe(true);
    expect(isMethod("post", "GET", "POST")).toBe(true);
    expect(isMethod("DELETE", "GET", "POST")).toBe(false);
  });

  it("returns false when no methods are allowed", () => {
    expect(isMethod("GET")).toBe(false);
  });

  it("only normalizes the method argument's case, not the allowed list's", () => {
    // Documents actual behavior: allowed entries are matched verbatim,
    // so a lowercase allowed-list entry will not match an uppercase
    // request method.
    expect(isMethod("GET", "get")).toBe(false);
  });
});

describe("rateLimitIpKey", () => {
  it("collapses every address in one IPv6 /64 to a single bucket", () => {
    // The bypass this closes: checkRateLimit treats its key as an opaque
    // string, so using the raw address gave anyone with a routed /64 (a cheap
    // VPS allocation) 2^64 independent login / signup / forgot-password
    // buckets, which is no rate limit at all.
    const a = rateLimitIpKey("2001:db8:abcd:1234::1");
    const b = rateLimitIpKey("2001:db8:abcd:1234:ffff:ffff:ffff:ffff");
    expect(a).toBe(b);
  });

  it("keeps genuinely different IPv6 /64s in different buckets", () => {
    expect(rateLimitIpKey("2001:db8:abcd:1234::1")).not.toBe(
      rateLimitIpKey("2001:db8:abcd:1235::1"),
    );
  });

  it("leaves IPv4 untouched so a carrier NAT does not share one bucket", () => {
    expect(rateLimitIpKey("203.0.113.5")).toBe("203.0.113.5");
    expect(rateLimitIpKey("203.0.113.5")).not.toBe(
      rateLimitIpKey("203.0.113.6"),
    );
  });

  it("passes through the 'unknown' fallback and anything unparsable", () => {
    expect(rateLimitIpKey("unknown")).toBe("unknown");
    expect(rateLimitIpKey("")).toBe("");
  });
});
