import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  makeCookieStore,
  makeHeaderStore,
  defaultSessionRow,
} from "../_test-harness";

/**
 * Route-level tests for GET /api/v3/auth/me.
 *
 * Mocked at the network/database boundary only (see tests/README.md): the
 * pg pool. getSession runs for real against the mocked pool and a fake
 * next/headers cookie/header store. The bearer-token path's validateApiKey
 * (lib/api/api-keys) is mocked directly -- that module has its own
 * separate test coverage and isn't in scope for this task, matching the
 * precedent in tests/app/api/v3/scan/route.test.ts.
 */

const queries: { sql: string; params: unknown[] }[] = [];

let sessionRow: Record<string, unknown> | null = null;
let userInfoRow: Record<string, unknown> | null = null;
let badgesRows: Record<string, unknown>[] = [];
let giftedRow: Record<string, unknown> | null = null;
let discordRow: Record<string, unknown> | null = null;
let bearerUserRow: Record<string, unknown> | null = null;
let settingsRows: { key: string; value: string }[] = [];

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
  queries.push({ sql: s, params });

  if (s.startsWith("SELECT key, value FROM system_settings"))
    return { rows: settingsRows };
  if (s.startsWith("DELETE FROM sessions WHERE expires_at"))
    return { rows: [] };
  if (s.startsWith("DELETE FROM sessions WHERE id")) return { rows: [] };
  if (s.includes("SELECT s.user_id")) {
    return { rows: sessionRow ? [sessionRow] : [] };
  }
  if (s.includes("onboarding_completed")) {
    return { rows: userInfoRow ? [userInfoRow] : [] };
  }
  if (s.includes("FROM user_badges ub")) {
    return { rows: badgesRows };
  }
  if (s.includes("FROM gifted_subscriptions")) {
    return { rows: giftedRow ? [giftedRow] : [] };
  }
  if (s.includes("FROM discord_connections")) {
    return { rows: discordRow ? [discordRow] : [] };
  }
  if (
    s.startsWith(
      "SELECT totp_enabled, two_factor_method, role, avatar_url, plan, scans_private_by_default FROM users",
    )
  ) {
    return { rows: bearerUserRow ? [bearerUserRow] : [] };
  }
  return { rows: [] };
});

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
  },
}));

const { store: cookieStore, state: cookieState } = makeCookieStore();
const { store: headerStore, state: headerState } = makeHeaderStore();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
  headers: vi.fn(async () => headerStore),
}));

const mockValidateApiKey = vi.fn();
vi.mock("@/lib/api/api-keys", () => ({
  validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args),
}));

const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");
const { AUTH_SESSION_COOKIE_NAME } = await import("@/lib/config/constants");
const { GET } = await import("@/app/api/v3/auth/me/route");

function meRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v3/auth/me", {
    method: "GET",
    headers,
  });
}

beforeEach(() => {
  mockQuery.mockClear();
  queries.length = 0;
  cookieState.clear();
  headerState.clear();
  mockValidateApiKey.mockReset();
  sessionRow = null;
  userInfoRow = null;
  badgesRows = [];
  giftedRow = null;
  discordRow = null;
  bearerUserRow = null;
  settingsRows = [];
  invalidateSettingsCache();
});

describe("GET /api/v3/auth/me", () => {
  describe("bearer token path", () => {
    it("rejects an invalid or revoked API key", async () => {
      mockValidateApiKey.mockResolvedValue(null);
      const res = await GET(meRequest({ authorization: "Bearer vr_bad_key" }));
      expect(res.status).toBe(401);
    });

    it("rejects a key that still needs Terms of Service acceptance", async () => {
      mockValidateApiKey.mockResolvedValue({
        userId: 5,
        email: "api@example.com",
        needsTermsAcceptance: true,
      });
      const res = await GET(
        meRequest({ authorization: "Bearer vr_needs_tos" }),
      );
      expect(res.status).toBe(403);
    });

    it("returns account info for a valid key, with no gift, using the plain plan", async () => {
      mockValidateApiKey.mockResolvedValue({
        userId: 5,
        email: "api@example.com",
        userName: "API User",
        needsTermsAcceptance: false,
      });
      bearerUserRow = {
        totp_enabled: false,
        two_factor_method: null,
        role: "user",
        avatar_url: null,
        plan: "core_supporter",
      };
      giftedRow = null;

      const res = await GET(meRequest({ authorization: "Bearer vr_good_key" }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.userId).toBe(5);
      expect(json.email).toBe("api@example.com");
      expect(json.name).toBe("API User");
      expect(json.plan).toBe("core_supporter");
      expect(json.isAdmin).toBe(false);
      // getSession must never run on the bearer path.
      expect(queries.some((q) => q.sql.includes("SELECT s.user_id"))).toBe(
        false,
      );
    });

    it("prefers an active gifted plan over the account's own plan", async () => {
      mockValidateApiKey.mockResolvedValue({
        userId: 5,
        email: "api@example.com",
        needsTermsAcceptance: false,
      });
      bearerUserRow = {
        totp_enabled: false,
        two_factor_method: null,
        role: "user",
        avatar_url: null,
        plan: "free",
      };
      giftedRow = { plan: "elite_supporter" };

      const res = await GET(meRequest({ authorization: "Bearer vr_good_key" }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.plan).toBe("elite_supporter");
    });
  });

  describe("session cookie path", () => {
    it("rejects an unauthenticated request", async () => {
      const res = await GET(meRequest());
      expect(res.status).toBe(401);
    });

    it("returns basic account info for a plain session with no extras", async () => {
      cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
      sessionRow = defaultSessionRow({
        user_id: 7,
        email: "user@example.com",
        name: "User",
      });
      userInfoRow = {
        totp_enabled: false,
        two_factor_method: null,
        onboarding_completed: true,
        role: "user",
        avatar_url: null,
        backup_codes: null,
        plan: null,
        subscription_status: null,
        discord_id: null,
      };

      const res = await GET(meRequest());
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.userId).toBe(7);
      expect(json.email).toBe("user@example.com");
      expect(json.totpEnabled).toBe(false);
      expect(json.backupCodesInvalid).toBe(false);
      expect(json.plan).toBe("free");
      expect(json.discordId).toBeNull();
      expect(json.badges).toEqual([]);
    });

    it("flags backup codes as invalid when 2FA is enabled and codes are in the old plaintext format", async () => {
      cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
      sessionRow = defaultSessionRow({ user_id: 7 });
      userInfoRow = {
        totp_enabled: true,
        two_factor_method: "app",
        onboarding_completed: true,
        role: "user",
        avatar_url: null,
        backup_codes: JSON.stringify(["ABCD1234", "EFGH5678"]), // no ":" -> plaintext format
        plan: "free",
        subscription_status: null,
        discord_id: null,
      };

      const res = await GET(meRequest());
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.backupCodesInvalid).toBe(true);
    });

    it("does not flag backup codes as invalid when they are real (hashed) codes", async () => {
      cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
      sessionRow = defaultSessionRow({ user_id: 7 });
      userInfoRow = {
        totp_enabled: true,
        two_factor_method: "app",
        onboarding_completed: true,
        role: "user",
        avatar_url: null,
        backup_codes: JSON.stringify([
          "131072:8:1:abcd:ef01",
          "131072:8:1:1234:5678",
        ]),
        plan: "free",
        subscription_status: null,
        discord_id: null,
      };

      const res = await GET(meRequest());
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.backupCodesInvalid).toBe(false);
    });

    it("never inspects backup codes when 2FA is disabled, even if the stored value is malformed", async () => {
      cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
      sessionRow = defaultSessionRow({ user_id: 7 });
      userInfoRow = {
        totp_enabled: false,
        two_factor_method: null,
        onboarding_completed: true,
        role: "user",
        avatar_url: null,
        backup_codes: "not even valid json",
        plan: "free",
        subscription_status: null,
        discord_id: null,
      };

      const res = await GET(meRequest());
      const json = await res.json();

      // Route must not throw / 500 -- the malformed value is only reachable
      // through the totp_enabled-gated branch, which is skipped here.
      expect(res.status).toBe(200);
      expect(json.backupCodesInvalid).toBe(false);
    });

    it("prefers an active gifted plan over the account's own plan and reports it as the subscription status", async () => {
      cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
      sessionRow = defaultSessionRow({ user_id: 7 });
      userInfoRow = {
        totp_enabled: false,
        two_factor_method: null,
        onboarding_completed: true,
        role: "user",
        avatar_url: null,
        backup_codes: null,
        plan: "free",
        subscription_status: "active",
        discord_id: null,
      };
      giftedRow = {
        plan: "pro_supporter",
        expires_at: "2027-01-01T00:00:00.000Z",
      };

      const res = await GET(meRequest());
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.plan).toBe("pro_supporter");
      expect(json.subscriptionStatus).toBe("gifted");
      expect(json.giftedSubscription).toEqual({
        plan: "pro_supporter",
        expiresAt: "2027-01-01T00:00:00.000Z",
      });
    });

    it("prefers the discord_connections row over users.discord_id, and falls back when absent", async () => {
      cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
      sessionRow = defaultSessionRow({ user_id: 7 });
      userInfoRow = {
        totp_enabled: false,
        two_factor_method: null,
        onboarding_completed: true,
        role: "user",
        avatar_url: null,
        backup_codes: null,
        plan: "free",
        subscription_status: null,
        discord_id: "fallback-discord-id",
      };
      discordRow = {
        discord_id: "connected-discord-id",
        discord_username: "someone",
        discord_avatar: "avatarhash",
      };

      const res = await GET(meRequest());
      const json = await res.json();

      expect(json.discordId).toBe("connected-discord-id");
      expect(json.discordUsername).toBe("someone");

      discordRow = null;
      const res2 = await GET(meRequest());
      const json2 = await res2.json();
      expect(json2.discordId).toBe("fallback-discord-id");
      expect(json2.discordUsername).toBeNull();
    });

    it("returns the user's badges", async () => {
      cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
      sessionRow = defaultSessionRow({ user_id: 7 });
      userInfoRow = {
        totp_enabled: false,
        two_factor_method: null,
        onboarding_completed: true,
        role: "user",
        avatar_url: null,
        backup_codes: null,
        plan: "free",
        subscription_status: null,
        discord_id: null,
      };
      badgesRows = [
        { id: 1, name: "early-bird", display_name: "Early Bird", priority: 10 },
      ];

      const res = await GET(meRequest());
      const json = await res.json();

      expect(json.badges).toEqual(badgesRows);
    });

    it("reports isAdmin true only for the admin role", async () => {
      cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
      sessionRow = defaultSessionRow({ user_id: 7 });
      userInfoRow = {
        totp_enabled: false,
        two_factor_method: null,
        onboarding_completed: true,
        role: "admin",
        avatar_url: null,
        backup_codes: null,
        plan: "free",
        subscription_status: null,
        discord_id: null,
      };

      const res = await GET(meRequest());
      const json = await res.json();
      expect(json.isAdmin).toBe(true);
      expect(json.role).toBe("admin");
    });

    it("returns the shipped terms-of-service default when no admin override exists", async () => {
      cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
      sessionRow = defaultSessionRow({ user_id: 7 });
      userInfoRow = {
        totp_enabled: false,
        two_factor_method: null,
        onboarding_completed: true,
        role: "user",
        avatar_url: null,
        backup_codes: null,
        plan: "free",
        subscription_status: null,
        discord_id: null,
      };
      settingsRows = [];

      const res = await GET(meRequest());
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.termsUpdatedAt).toBe("2026-08-10");
      expect(json.termsChangeSummary).toEqual(expect.any(String));
    });

    it("reflects an admin's database-saved terms update immediately -- no rebuild needed", async () => {
      cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
      sessionRow = defaultSessionRow({ user_id: 7 });
      userInfoRow = {
        totp_enabled: false,
        two_factor_method: null,
        onboarding_completed: true,
        role: "user",
        avatar_url: null,
        backup_codes: null,
        plan: "free",
        subscription_status: null,
        discord_id: null,
      };
      settingsRows = [
        { key: "TERMS_UPDATED_AT", value: "2026-09-01" },
        {
          key: "TERMS_CHANGE_SUMMARY",
          value: "Added a new data retention clause.",
        },
      ];

      const res = await GET(meRequest());
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.termsUpdatedAt).toBe("2026-09-01");
      expect(json.termsChangeSummary).toBe(
        "Added a new data retention clause.",
      );
    });
  });
});
