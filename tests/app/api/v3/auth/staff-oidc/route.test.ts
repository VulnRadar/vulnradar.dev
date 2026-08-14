/**
 * Route-level tests for GET /api/v3/auth/staff-oidc (the SSO flow
 * initiator). Mocked at the module boundary: lib/auth/staff-oidc.ts's
 * getStaffOidcConfig/getDiscoveryDocument, and next/headers for the
 * response cookie jar. signOAuthState runs for real.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

process.env.API_KEY_ENCRYPTION_KEY = "f".repeat(64);

// resolveAppUrl (lib/config/runtime-config.ts) reads system_settings via
// the pg pool on every request -- mocked to always miss so it falls back
// to the request's own origin, same pattern as the sibling OAuth start
// route's suite (tests/app/api/v3/auth/oauth/[provider]/route.test.ts).
vi.mock("@/lib/database/db", () => ({
  default: { query: vi.fn(async () => ({ rows: [] })) },
}));

const mockGetStaffOidcConfig = vi.fn();
const mockGetDiscoveryDocument = vi.fn();
vi.mock("@/lib/auth/staff-oidc", () => ({
  getStaffOidcConfig: (...args: unknown[]) => mockGetStaffOidcConfig(...args),
  getDiscoveryDocument: (...args: unknown[]) =>
    mockGetDiscoveryDocument(...args),
}));

const { GET } = await import("@/app/api/v3/auth/staff-oidc/route");

function makeRequest() {
  return new NextRequest("https://vulnradar.dev/api/v3/auth/staff-oidc");
}

beforeEach(() => {
  mockGetStaffOidcConfig.mockReset();
  mockGetDiscoveryDocument.mockReset();
});

describe("GET /api/v3/auth/staff-oidc", () => {
  it("redirects to /login?error=oauth_not_configured when staff SSO isn't configured", async () => {
    mockGetStaffOidcConfig.mockResolvedValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain(
      "/login?error=oauth_not_configured",
    );
    expect(mockGetDiscoveryDocument).not.toHaveBeenCalled();
  });

  it("redirects to /login?error=oauth_failed when discovery fails", async () => {
    mockGetStaffOidcConfig.mockResolvedValue({
      issuerUrl: "https://idp.example.com",
      clientId: "id",
      clientSecret: "secret",
    });
    mockGetDiscoveryDocument.mockRejectedValue(new Error("boom"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login?error=oauth_failed");
  });

  it("redirects to the IdP's authorization endpoint with the right params and sets a nonce cookie", async () => {
    mockGetStaffOidcConfig.mockResolvedValue({
      issuerUrl: "https://idp.example.com",
      clientId: "staff-client-id",
      clientSecret: "secret",
    });
    mockGetDiscoveryDocument.mockResolvedValue({
      issuer: "https://idp.example.com",
      authorization_endpoint: "https://idp.example.com/authorize",
      token_endpoint: "https://idp.example.com/token",
      jwks_uri: "https://idp.example.com/jwks",
    });

    const res = await GET(makeRequest());

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe(
      "https://idp.example.com/authorize",
    );
    expect(location.searchParams.get("client_id")).toBe("staff-client-id");
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(location.searchParams.get("scope")).toBe("openid email profile");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://vulnradar.dev/api/v3/auth/staff-oidc/callback",
    );
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(location.searchParams.get("nonce")).toBeTruthy();

    const setCookie = res.headers.get("set-cookie") || "";
    expect(setCookie).toContain("staff_oidc_nonce=");
    expect(setCookie.toLowerCase()).toContain("httponly");
    // The cookie's nonce value must be the exact one sent to the IdP, so
    // the callback can verify the ID token's nonce claim against it.
    const cookieNonce = /staff_oidc_nonce=([^;]+)/.exec(setCookie)?.[1];
    expect(cookieNonce).toBe(location.searchParams.get("nonce"));
  });

  it("generates a different nonce on every call (never reused across flows)", async () => {
    mockGetStaffOidcConfig.mockResolvedValue({
      issuerUrl: "https://idp.example.com",
      clientId: "id",
      clientSecret: "secret",
    });
    mockGetDiscoveryDocument.mockResolvedValue({
      issuer: "https://idp.example.com",
      authorization_endpoint: "https://idp.example.com/authorize",
      token_endpoint: "https://idp.example.com/token",
      jwks_uri: "https://idp.example.com/jwks",
    });

    const res1 = await GET(makeRequest());
    const res2 = await GET(makeRequest());
    const nonce1 = new URL(res1.headers.get("location")!).searchParams.get(
      "nonce",
    );
    const nonce2 = new URL(res2.headers.get("location")!).searchParams.get(
      "nonce",
    );
    expect(nonce1).not.toBe(nonce2);
  });
});
