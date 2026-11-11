import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  makeCookieStore,
  makeHeaderStore,
  defaultSessionRow,
} from "../_test-harness";
import { CONFIG_TERMS_UPDATED_AT } from "@/lib/config/config-values";

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

// The Bearer half's limiter and quota block have their own suite
// (tests/lib/auth/me.test.ts). Replaced here so the faked pool above answers
// only the queries this file is about.
const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limiting/rate-limit")>()),
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const QUOTA = {
  scans: {
    limit: 100,
    used: 3,
    remaining: 97,
    resetsAt: "2026-01-02T00:00:00.000Z",
  },
  requests: {
    limit: 500,
    used: 7,
    remaining: 493,
    resetsAt: "2026-01-02T05:00:00.000Z",
  },
};
const mockBuildQuotaBlock = vi.fn();
vi.mock("@/lib/api/quota", () => ({
  buildQuotaBlock: (...args: unknown[]) => mockBuildQuotaBlock(...args),
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
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 59,
    retryAfterSeconds: 0,
  });
  mockBuildQuotaBlock.mockReset();
  mockBuildQuotaBlock.mockResolvedValue(QUOTA);
});

/** A distinct key id per test, so the per-key quota cache never carries over. */
let nextKeyId = 1000;
function keyFor(overrides: Record<string, unknown> = {}) {
  return {
    keyId: nextKeyId++,
    keyName: "CI key",
    userId: 5,
    email: "api@example.com",
    userName: "API User",
    dailyLimit: 500,
    scopes: ["scan:read", "scan:write"],
    needsTermsAcceptance: false,
    ...overrides,
  };
}

describe("GET /api/v3/auth/me", () => {
  describe("bearer token path", () => {
    it("rejects an invalid or revoked API key", async () => {
      mockValidateApiKey.mockResolvedValue(null);
      const res = await GET(meRequest({ authorization: "Bearer vr_bad_key" }));
      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe("INVALID_API_KEY");
      expect(mockCheckRateLimit).not.toHaveBeenCalled();
    });

    it("rejects a key that still needs Terms of Service acceptance, with its code", async () => {
      mockValidateApiKey.mockResolvedValue(
        keyFor({ needsTermsAcceptance: true }),
      );
      const res = await GET(
        meRequest({ authorization: "Bearer vr_needs_tos" }),
      );
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("TERMS_ACCEPTANCE_REQUIRED");
      expect(mockBuildQuotaBlock).not.toHaveBeenCalled();
    });

    it("answers 429 RATE_LIMITED with a Retry-After once the key's identity checks are spent", async () => {
      const key = keyFor();
      mockValidateApiKey.mockResolvedValue(key);
      mockCheckRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        retryAfterSeconds: 42,
      });

      const res = await GET(meRequest({ authorization: "Bearer vr_busy" }));

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("42");
      expect((await res.json()).code).toBe("RATE_LIMITED");
      expect(mockCheckRateLimit).toHaveBeenCalledWith(
        expect.objectContaining({
          key: `auth-me:${key.keyId}`,
          limit: "authMe",
        }),
      );
      expect(mockBuildQuotaBlock).not.toHaveBeenCalled();
      expect(queries).toHaveLength(0);
    });

    it("adds the key and the quota block to what a key learns about itself", async () => {
      const key = keyFor();
      mockValidateApiKey.mockResolvedValue(key);
      bearerUserRow = { role: "user", plan: "free" };

      const res = await GET(meRequest({ authorization: "Bearer vr_good_key" }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.key).toEqual({
        id: key.keyId,
        name: "CI key",
        scopes: ["scan:read", "scan:write"],
      });
      expect(json.quota).toEqual(QUOTA);
      expect(mockBuildQuotaBlock).toHaveBeenCalledWith(5, {
        keyId: key.keyId,
        dailyLimit: 500,
      });
      // The session view's fields stay on the session half.
      expect(json.apiKeys).toBeUndefined();
      expect(json.badges).toBeUndefined();
    });

    it("returns account info for a valid key, with no gift, using the plain plan", async () => {
      mockValidateApiKey.mockResolvedValue(keyFor());
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
      // getSession must never run on the bearer path.
      expect(queries.some((q) => q.sql.includes("SELECT s.user_id"))).toBe(
        false,
      );
    });

    it("prefers an active gifted plan over the account's own plan", async () => {
      mockValidateApiKey.mockResolvedValue(keyFor());
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
    // The catch path, which had no coverage and used to swallow silently.
    // backup_codes is written as JSON by our own code, so a value that will
    // not parse is a value nobody can redeem; reporting it as fine tells an
    // account with 2FA on that its recovery codes are in order, and it finds
    // out otherwise at the one moment they matter.
    it("flags backup codes as invalid when the stored value cannot be parsed", async () => {
      cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
      sessionRow = defaultSessionRow({ user_id: 7 });
      userInfoRow = {
        totp_enabled: true,
        two_factor_method: "app",
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
        discord_username: "signed-up-with-discord",
        discord_avatar_url:
          "https://cdn.discordapp.com/avatars/fallback-discord-id/hash.png",
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
      expect(json.discordAvatar).toBe("avatarhash");

      // Signing up with Discord writes the name and avatar onto the users
      // row and never touches discord_connections. discordId already fell
      // back there; the name and avatar did not, so such an account showed
      // in the profile as a nameless, faceless "Connected".
      discordRow = null;
      const res2 = await GET(meRequest());
      const json2 = await res2.json();
      expect(json2.discordId).toBe("fallback-discord-id");
      expect(json2.discordUsername).toBe("signed-up-with-discord");
      expect(json2.discordAvatarUrl).toBe(
        "https://cdn.discordapp.com/avatars/fallback-discord-id/hash.png",
      );
      // The hash column only ever exists on the connection row, so it stays
      // null here rather than being conflated with the whole URL above.
      expect(json2.discordAvatar).toBeNull();
    });

    it("selects the Discord identity columns it reads from the users row", async () => {
      // The columns were written by lib/auth/auth.ts on every Discord
      // sign-up and simply never selected here, which is why the fallback
      // above could not have worked before.
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

      await GET(meRequest());

      const userQuery = queries.find((q) =>
        q.sql.includes("onboarding_completed"),
      );
      expect(userQuery?.sql).toContain("discord_username");
      expect(userQuery?.sql).toContain("discord_avatar_url");
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

    it("returns the admin role for an admin user", async () => {
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
      expect(json.termsUpdatedAt).toBe(CONFIG_TERMS_UPDATED_AT);
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

    // The Developer tab gates its Create button on this number, so it has to
    // be the one POST /keys enforces: the live, admin-editable setting for
    // the resolved plan, not the catalog's shipped default.
    describe("apiKeys, the live per-plan key limit", () => {
      function signIn(row: Record<string, unknown>) {
        cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
        sessionRow = defaultSessionRow({ user_id: 7 });
        userInfoRow = {
          totp_enabled: false,
          two_factor_method: null,
          onboarding_completed: true,
          avatar_url: null,
          backup_codes: null,
          subscription_status: null,
          discord_id: null,
          role: "user",
          plan: "free",
          ...row,
        };
      }

      const billingOn = (extra: { key: string; value: string }[] = []) => [
        { key: "BILLING_ENABLED", value: "true" },
        { key: "BILLING_FREE_API_KEYS", value: "2" },
        { key: "BILLING_CORE_SUPPORTER_API_KEYS", value: "7" },
        { key: "BILLING_PRO_SUPPORTER_API_KEYS", value: "11" },
        { key: "BILLING_ELITE_SUPPORTER_API_KEYS", value: "-1" },
        ...extra,
      ];

      it("is -1 (unlimited) when billing is off", async () => {
        signIn({ plan: "core_supporter" });
        settingsRows = [{ key: "BILLING_ENABLED", value: "false" }];
        const json = await (await GET(meRequest())).json();
        expect(json.apiKeys).toBe(-1);
      });

      it("reads an admin's edited limit for the account's own plan", async () => {
        signIn({ plan: "core_supporter" });
        settingsRows = billingOn();
        const json = await (await GET(meRequest())).json();
        expect(json.apiKeys).toBe(7);
      });

      it("follows a higher gifted plan", async () => {
        signIn({ plan: "free" });
        giftedRow = { plan: "pro_supporter", expires_at: "2099-01-01" };
        settingsRows = billingOn();
        const json = await (await GET(meRequest())).json();
        expect(json.apiKeys).toBe(11);
      });

      it("gives a staff account on the free plan the Pro Supporter floor", async () => {
        signIn({ plan: "free", role: "admin" });
        settingsRows = billingOn();
        const json = await (await GET(meRequest())).json();
        expect(json.apiKeys).toBe(11);
      });

      it("passes an unlimited plan through as -1", async () => {
        signIn({ plan: "elite_supporter" });
        settingsRows = billingOn();
        const json = await (await GET(meRequest())).json();
        expect(json.apiKeys).toBe(-1);
      });
    });
  });
});
