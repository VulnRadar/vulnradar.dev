/**
 * The staff directory names the staff accounts that sign in with a password
 * alone while ENFORCE_STAFF_2FA is off.
 *
 * That setting ships off, and with it off such an account reaches every
 * admin route on its password. The directory showed this only as a count in
 * the stat bar and a pill per row, so nothing said the setting that closes
 * it was off. The banner appears while the setting resolves false and some
 * account lacks two-factor, and not otherwise.
 *
 * No DOM: renderToStaticMarkup, and a stubbed fetch for the settings read.
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({ me: { userId: 1, role: "admin" }, isLoading: false }),
  clearAuthCache: () => {},
}));

const {
  StaffTwoFactorBanner,
  staffWithoutTwoFactor,
  fetchStaffTwoFactorEnforced,
} = await import("@/components/admin/staff/staff-list");
const { API } = await import("@/lib/config/client-constants");
type Admin = Parameters<typeof staffWithoutTwoFactor>[0][number];

function admin(over: Partial<Admin>): Admin {
  return {
    id: 1,
    email: "a@example.com",
    name: null,
    role: "admin",
    avatar_url: null,
    created_at: "2026-01-01T00:00:00Z",
    totp_enabled: true,
    last_session_created: null,
    active_sessions: 0,
    last_admin_action: null,
    last_action_type: null,
    last_ip: null,
    total_actions: 0,
    actions_24h: 0,
    ...over,
  };
}

const STAFF = [
  admin({ id: 1, name: "Ada", totp_enabled: true }),
  admin({ id: 2, name: "Bea", totp_enabled: false }),
  admin({ id: 3, email: "cy@example.com", totp_enabled: false }),
];

function banner(admins: Admin[], enforced: boolean | null) {
  return renderToStaticMarkup(
    <StaffTwoFactorBanner admins={admins} enforced={enforced} />,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StaffTwoFactorBanner", () => {
  it("names every staff account without two-factor while the setting is off", () => {
    const html = banner(STAFF, false);
    expect(html).toContain("2 staff accounts sign in with a password alone.");
    expect(html).toContain("Bea, cy@example.com");
    expect(html).not.toContain("Ada");
    expect(html).toContain("Turn on");
    expect(html).toMatch(
      /<a[^>]*href="\/admin\?tab=settings"[^>]*>Require 2FA for staff<\/a>/,
    );
    expect(html).toContain("once they have set it up.");
  });

  it("agrees with one account", () => {
    expect(banner([STAFF[1]], false)).toContain(
      "1 staff account signs in with a password alone.",
    );
  });

  it("is a standing notice, not an announcement", () => {
    expect(banner(STAFF, false)).not.toContain('role="alert"');
  });

  it("shows nothing when every staff account has two-factor", () => {
    expect(banner([STAFF[0]], false)).toBe("");
  });

  it("shows nothing when the setting is on, or could not be read", () => {
    expect(banner(STAFF, true)).toBe("");
    expect(banner(STAFF, null)).toBe("");
  });
});

describe("staffWithoutTwoFactor", () => {
  it("keeps only the accounts with two-factor off", () => {
    expect(staffWithoutTwoFactor(STAFF).map((a) => a.id)).toEqual([2, 3]);
  });
});

describe("fetchStaffTwoFactorEnforced", () => {
  function stub(status: number, body: unknown) {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    return calls;
  }

  it("reads the effective value the Settings tab reads", async () => {
    const calls = stub(200, { effective: { ENFORCE_STAFF_2FA: false } });
    expect(await fetchStaffTwoFactorEnforced()).toBe(false);
    expect(calls[0].url).toBe(`${API.ADMIN}/features`);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      section: "system_settings",
      action: "effective",
    });
    stub(200, { effective: { ENFORCE_STAFF_2FA: true } });
    expect(await fetchStaffTwoFactorEnforced()).toBe(true);
  });

  it("is null on a refusal, a missing key or no network", async () => {
    stub(401, { error: "Unauthorized" });
    expect(await fetchStaffTwoFactorEnforced()).toBeNull();
    stub(200, { effective: {} });
    expect(await fetchStaffTwoFactorEnforced()).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await fetchStaffTwoFactorEnforced()).toBeNull();
  });
});
