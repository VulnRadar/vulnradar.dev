import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Route-level tests for GET /api/v3/whoami-ip (the IPv4 echo). getClientIp
 * runs for real against a mocked next/headers store; the signing key must be
 * set before the token module is imported.
 */

process.env.API_KEY_ENCRYPTION_KEY = "c".repeat(64);

const headerState = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (name: string) => headerState.get(name.toLowerCase()) ?? null,
  })),
}));

const { verifyIpv4Token } = await import("@/lib/auth/ipv4-echo-token");
const { GET } = await import("@/app/api/v3/whoami-ip/route");

beforeEach(() => {
  headerState.clear();
  delete process.env.TRUSTED_PROXY_CIDR;
});

describe("GET /api/v3/whoami-ip", () => {
  it("returns the IPv4 and a token that verifies back to it", async () => {
    headerState.set("x-forwarded-for", "203.0.113.9");
    const res = await GET();
    const json = await res.json();

    expect(json.ip).toBe("203.0.113.9");
    expect(typeof json.token).toBe("string");
    expect(verifyIpv4Token(json.token, Date.now())).toBe("203.0.113.9");
    // Cross-origin readable and never cached.
    expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns no token for an IPv6 caller", async () => {
    headerState.set("x-forwarded-for", "2001:db8::1");
    const res = await GET();
    const json = await res.json();

    expect(json.ip).toBe("2001:db8::1");
    expect(json.token).toBeUndefined();
  });
});
