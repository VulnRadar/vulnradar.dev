/**
 * Route-level test for GET /api/v3/auth/staff-oidc/info -- the public
 * "is staff SSO configured" check the login page's link visibility depends
 * on. Confirms it never leaks the issuer URL or client id, only a boolean.
 */
import { describe, it, expect, vi } from "vitest";

const mockGetStaffOidcConfig = vi.fn();
vi.mock("@/lib/auth/staff-oidc", () => ({
  getStaffOidcConfig: (...args: unknown[]) => mockGetStaffOidcConfig(...args),
}));

const { GET } = await import("@/app/api/v3/auth/staff-oidc/info/route");

describe("GET /api/v3/auth/staff-oidc/info", () => {
  it("returns configured: false when staff SSO isn't set up", async () => {
    mockGetStaffOidcConfig.mockResolvedValue(null);
    const res = await GET();
    const json = await res.json();
    expect(json).toEqual({ configured: false });
  });

  it("returns configured: true, and never the issuer URL or client id, when it is set up", async () => {
    mockGetStaffOidcConfig.mockResolvedValue({
      issuerUrl: "https://idp.example.com",
      clientId: "secret-looking-client-id",
      clientSecret: "definitely-secret",
    });
    const res = await GET();
    const json = await res.json();
    expect(json).toEqual({ configured: true });
    expect(JSON.stringify(json)).not.toContain("idp.example.com");
    expect(JSON.stringify(json)).not.toContain("secret-looking-client-id");
  });
});
