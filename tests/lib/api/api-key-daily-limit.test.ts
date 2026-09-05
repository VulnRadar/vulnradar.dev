/**
 * An API key's daily limit must follow the owner's CURRENT plan, not the
 * api_keys.daily_limit column stamped when the key was created.
 *
 * That column is written exactly twice in the whole codebase (key creation and
 * key rotation) and no billing path touches it: not the Stripe webhook, not
 * the staff-plan grant/revoke, not an admin plan change. Enforcement read it
 * anyway, so a cancelled Elite subscriber kept a 5,000/day allowance forever
 * and someone upgrading off Free stayed at 25/day despite paying, which is the
 * opposite of what components/pricing/pricing-faq.tsx promises ("raises your
 * daily limit on the spot").
 *
 * Every row below therefore carries a deliberately WRONG daily_limit, so a
 * test can only pass by ignoring it.
 *
 * Mocked at the database and settings boundary only. resolveEffectivePlan and
 * getPlanLimitsForPlan are real: the bug was in the wiring between them and
 * validateApiKey, so mocking either would test nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;

/** The row the locator lookup finds, minus the plan columns each test sets. */
let keyRow: Row | null = null;

const mockQuery = vi.fn(async (sql: string, _params?: unknown[]) => {
  const s = sql.trim();
  if (s.includes("ak.key_encrypted") && s.includes("ak.key_locator = $1")) {
    return { rows: keyRow ? [keyRow] : [] };
  }
  if (s.startsWith("SELECT EXISTS")) {
    return { rows: [{ present: false }] };
  }
  if (s.includes("FROM users u") && s.includes("gifted_subscriptions")) {
    // getUserApiKeys' plan lookup.
    return { rows: keyRow ? [keyRow] : [] };
  }
  if (s.includes("FROM api_keys ak") && s.includes("usage_today")) {
    return {
      rows: [
        { id: 1, key_prefix: "vr_live_abc", name: "CI", daily_limit: 25 },
        { id: 2, key_prefix: "vr_live_def", name: "prod", daily_limit: 999999 },
      ],
    };
  }
  return { rows: [] };
});

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (...args: unknown[]) =>
      (mockQuery as (...a: unknown[]) => unknown)(...args),
  },
}));

vi.mock("@/lib/auth/crypto", () => ({
  isEncryptionConfigured: () => true,
  encryptApiKey: (raw: string) => `enc:${raw}`,
  decryptApiKey: (enc: string) => String(enc).replace(/^enc:/, ""),
}));

vi.mock("@/lib/api/request-utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/request-utils")>();
  return { ...actual, getClientIp: vi.fn(async () => "unknown") };
});

vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: vi.fn(async () => {}),
}));

/**
 * The admin-configurable per-plan numbers. Deliberately not the shipped
 * defaults: an assertion that matched the catalog by coincidence would not
 * prove the resolver was consulted at all.
 */
let settings: Record<string, unknown> = {};

vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: async (key: string) => settings[key],
  getSettings: async (keys: readonly string[]) =>
    Object.fromEntries(keys.map((k) => [k, settings[k]])),
}));

const {
  validateApiKey,
  getUserApiKeys,
  __resetLegacyKeyRowCache,
  UNLIMITED_API_KEY_DAILY_LIMIT,
} = await import("@/lib/api/api-keys");

const RAW_KEY = `vr_live_${"a".repeat(64)}`;

function setKeyOwner(owner: {
  plan?: string | null;
  role?: string | null;
  gifted_plan?: string | null;
  /** The stale snapshot in the column. Always wrong on purpose. */
  daily_limit: number;
}) {
  keyRow = {
    key_id: 7,
    user_id: 42,
    name: "CI",
    revoked_at: null,
    disabled_at: null,
    key_encrypted: `enc:${RAW_KEY}`,
    bound_ip: null,
    scopes: ["scan:read"],
    email: "owner@example.com",
    user_name: "Owner",
    tos_accepted_at: "2030-01-01T00:00:00.000Z",
    plan: null,
    role: null,
    gifted_plan: null,
    ...owner,
  };
}

beforeEach(() => {
  // computeKeyLocator refuses to run without a real 32-byte secret (there is
  // deliberately no hardcoded fallback).
  process.env.API_KEY_ENCRYPTION_KEY = "a".repeat(64);
  mockQuery.mockClear();
  __resetLegacyKeyRowCache();
  keyRow = null;
  settings = {
    FEATURE_API_KEYS: true,
    TERMS_UPDATED_AT: "2020-01-01T00:00:00.000Z",
    API_KEY_IP_BINDING_ENABLED: false,
    BILLING_ENABLED: true,
    BILLING_FREE_API_REQUESTS_PER_DAY: 25,
    BILLING_CORE_SUPPORTER_API_REQUESTS_PER_DAY: 100,
    BILLING_PRO_SUPPORTER_API_REQUESTS_PER_DAY: 5000,
    BILLING_ELITE_SUPPORTER_API_REQUESTS_PER_DAY: 20000,
  };
});

describe("validateApiKey daily limit", () => {
  it("uses the owner's current plan, not the limit stored on the key", async () => {
    // The upgrade direction: key issued on Free (25 stamped into the column),
    // owner has since paid for Elite. Before this, they kept the free cap.
    setKeyOwner({ plan: "elite_supporter", daily_limit: 25 });

    const result = await validateApiKey(RAW_KEY);

    expect(result?.dailyLimit).toBe(20000);
  });

  it("drops a cancelled subscriber back to their new plan's allowance", async () => {
    // The downgrade direction, and the one that costs money: key issued on
    // Elite (999999 stamped), subscription cancelled, users.plan back to free.
    setKeyOwner({ plan: "free", daily_limit: 999999 });

    const result = await validateApiKey(RAW_KEY);

    expect(result?.dailyLimit).toBe(25);
  });

  it("resolves an admin's edit to the per-plan setting without a rotation", async () => {
    setKeyOwner({ plan: "core_supporter", daily_limit: 100 });
    settings.BILLING_CORE_SUPPORTER_API_REQUESTS_PER_DAY = 250;

    const result = await validateApiKey(RAW_KEY);

    expect(result?.dailyLimit).toBe(250);
  });

  it("lets a gifted plan raise the limit, but never lower it", async () => {
    // resolveEffectivePlan's rule: a gift is only ever an upgrade, so a Core
    // gift handed to a paying Elite account must not cut them to 100.
    setKeyOwner({
      plan: "elite_supporter",
      gifted_plan: "core_supporter",
      daily_limit: 25,
    });
    expect((await validateApiKey(RAW_KEY))?.dailyLimit).toBe(20000);

    setKeyOwner({
      plan: "free",
      gifted_plan: "pro_supporter",
      daily_limit: 25,
    });
    expect((await validateApiKey(RAW_KEY))?.dailyLimit).toBe(5000);
  });

  it("caps a staff account at the Pro Supporter allowance rather than unlimited", async () => {
    setKeyOwner({ plan: "free", role: "moderator", daily_limit: 25 });

    const result = await validateApiKey(RAW_KEY);

    expect(result?.dailyLimit).toBe(5000);
  });

  it("maps the -1 unlimited sentinel to a finite number, never Infinity", async () => {
    // This value is serialised into the 429 body and X-RateLimit-Limit, and
    // JSON.stringify(Infinity) is `null`.
    setKeyOwner({ plan: "elite_supporter", daily_limit: 25 });
    settings.BILLING_ELITE_SUPPORTER_API_REQUESTS_PER_DAY = -1;

    const result = await validateApiKey(RAW_KEY);

    expect(result?.dailyLimit).toBe(UNLIMITED_API_KEY_DAILY_LIMIT);
    expect(Number.isFinite(result?.dailyLimit)).toBe(true);
  });

  it("treats a billing-disabled deployment as uncapped", async () => {
    setKeyOwner({ plan: "free", daily_limit: 25 });
    settings.BILLING_ENABLED = false;

    const result = await validateApiKey(RAW_KEY);

    expect(result?.dailyLimit).toBe(UNLIMITED_API_KEY_DAILY_LIMIT);
  });

  it("fails closed to zero on a corrupt per-plan setting rather than uncapping", async () => {
    setKeyOwner({ plan: "free", daily_limit: 25 });
    settings.BILLING_FREE_API_REQUESTS_PER_DAY = "not a number";

    const result = await validateApiKey(RAW_KEY);

    expect(result?.dailyLimit).toBe(0);
  });

  it("resolves the plan from the same lookup, adding no extra query", async () => {
    // The whole reason this can sit on every authenticated API request: the
    // plan columns ride the JOIN the key lookup already does, and the per-plan
    // numbers come out of the cached settings snapshot.
    setKeyOwner({ plan: "pro_supporter", daily_limit: 25 });

    await validateApiKey(RAW_KEY);

    const lookups = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("FROM api_keys ak"),
    );
    expect(lookups).toHaveLength(1);
    expect(String(lookups[0][0])).toContain("gifted_subscriptions");
  });
});

describe("getUserApiKeys daily limit", () => {
  it("reports the live plan allowance on every key, not the stored column", async () => {
    // Enforcement and the profile's "12 of 25 today" meter have to agree, or
    // the account is told a number the API is not applying.
    setKeyOwner({ plan: "pro_supporter", daily_limit: 25 });

    const keys = await getUserApiKeys(42);

    expect(keys.map((k) => k.daily_limit)).toEqual([5000, 5000]);
  });
});
