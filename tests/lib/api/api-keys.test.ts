import { describe, it, expect, vi, beforeEach } from "vitest";
import { ALL_API_KEY_SCOPES } from "@/lib/config/client-constants";
import { hashApiKey } from "@/lib/api/api-key-digest";

/**
 * Tests for API key IP binding (passesApiKeyIpBinding), plus one
 * validateApiKey integration test proving the check is actually wired
 * into the real lookup path, not just exercised in isolation.
 *
 * Mocked at the database and network boundary: pool.query and
 * sendNotificationEmail. The key digest is real (tests/lib/api/
 * api-keys-hashed.test.ts covers how keys are stored). getClientIp is mocked
 * for the same reason as in auth.test.ts; ipsInSameSubnet is left real via
 * importOriginal.
 */

type Row = Record<string, unknown>;

const queries: { sql: string; params: unknown[] }[] = [];
let settingsRows: Row[] = [];
let keyRow: Row | null = null;

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  queries.push({ sql, params });
  const s = sql.trim();
  if (s.startsWith("SELECT key, value FROM system_settings")) {
    return { rows: settingsRows };
  }
  if (s.startsWith("UPDATE api_keys SET bound_ip")) {
    return { rows: [] };
  }
  if (s.startsWith("INSERT INTO security_alerts")) {
    return { rows: [] };
  }
  if (s.includes("ak.key_hash = $1")) {
    return {
      rows: keyRow && keyRow.key_hash === params[0] ? [keyRow] : [],
    };
  }
  // The legacy bcrypt path is irrelevant to the row under test in this
  // suite: return empty so validateApiKey falls through it without a match.
  return { rows: [] };
});

// generateApiKey serializes a CAPPED create behind a per-user advisory lock,
// so that path runs on a pooled client rather than on the pool itself. The
// client forwards the real statement to the same mockQuery every expectation
// here queues against; BEGIN, the lock and COMMIT are transaction plumbing
// with no result worth queueing, so they are answered locally instead of
// consuming a queued row.
const TX_PLUMBING = /^(BEGIN|COMMIT|ROLLBACK)$|pg_advisory_xact_lock/i;
const mockConnect = vi.fn(async () => ({
  query: async (...args: unknown[]) => {
    if (TX_PLUMBING.test(String(args[0] ?? "").trim())) {
      return { rows: [], rowCount: 0 };
    }
    return mockQuery(...(args as [string, unknown[]?]));
  },
  release: vi.fn(),
}));

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
    connect: () => mockConnect(),
  },
}));

let currentIp = "unknown";

vi.mock("@/lib/api/request-utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/request-utils")>();
  return {
    ...actual,
    getClientIp: vi.fn(async () => currentIp),
  };
});

const mockSendNotificationEmail = vi.fn(async (_params: unknown) => {});
vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: (params: unknown) => mockSendNotificationEmail(params),
}));

const {
  passesApiKeyIpBinding,
  validateApiKey,
  rotateApiKey,
  __resetLegacyKeyRowCache,
} = await import("@/lib/api/api-keys");
const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");

function enableSettingsRow(enabled: boolean, ipv4 = 32, ipv6 = 128) {
  settingsRows = [
    { key: "API_KEY_IP_BINDING_ENABLED", value: String(enabled) },
    { key: "API_KEY_IP_BINDING_IPV4_PREFIX", value: String(ipv4) },
    { key: "API_KEY_IP_BINDING_IPV6_PREFIX", value: String(ipv6) },
  ];
}

const baseRow = {
  key_id: 9,
  user_id: 3,
  email: "owner@example.com",
  name: "CI key",
};

beforeEach(() => {
  mockQuery.mockClear();
  mockSendNotificationEmail.mockClear();
  queries.length = 0;
  settingsRows = [];
  keyRow = null;
  currentIp = "unknown";
  process.env.API_KEY_ENCRYPTION_KEY = "a".repeat(64);
  __resetLegacyKeyRowCache();
  invalidateSettingsCache();
});

function digestOf(raw: string): string {
  return hashApiKey(raw);
}

describe("validation does not depend on API_KEY_ENCRYPTION_KEY", () => {
  it.each([
    ["no hex at all", "z".repeat(64)],
    ["63 hex characters and a g", `${"a".repeat(63)}g`],
  ])(
    "answers normally under a 64-character key with %s",
    async (_label, key) => {
      // The 3.9.1 locator was an HMAC under this key, so a malformed one threw
      // here. The digest is unkeyed: boot validation (lib/config/env.ts) is
      // what refuses a malformed key now, and validation is not affected.
      process.env.API_KEY_ENCRYPTION_KEY = key;
      await expect(validateApiKey("vr_live_anything")).resolves.toBeNull();
    },
  );
});

describe("passesApiKeyIpBinding", () => {
  it("does nothing when the feature is disabled (shipped default)", async () => {
    currentIp = "8.8.8.8";
    const ok = await passesApiKeyIpBinding({
      ...baseRow,
      bound_ip: "203.0.113.5",
    });
    expect(ok).toBe(true);
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
  });

  it("does nothing when the current IP can't be determined", async () => {
    enableSettingsRow(true);
    currentIp = "unknown";
    const ok = await passesApiKeyIpBinding({
      ...baseRow,
      bound_ip: "203.0.113.5",
    });
    expect(ok).toBe(true);
  });

  it("adopts the first request's subnet instead of rejecting it", async () => {
    enableSettingsRow(true);
    currentIp = "203.0.113.5";
    const ok = await passesApiKeyIpBinding({ ...baseRow, bound_ip: null });
    expect(ok).toBe(true);

    const update = queries.find((q) =>
      q.sql.startsWith("UPDATE api_keys SET bound_ip"),
    );
    expect(update?.params).toEqual(["203.0.113.5", 9]);
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
  });

  it("passes silently for an exact IP match (default /32)", async () => {
    enableSettingsRow(true);
    currentIp = "203.0.113.5";
    const ok = await passesApiKeyIpBinding({
      ...baseRow,
      bound_ip: "203.0.113.5",
    });
    expect(ok).toBe(true);
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
  });

  it("declines a request from a different address at the default /32 (stricter than a session's /24)", async () => {
    enableSettingsRow(true);
    currentIp = "203.0.113.6"; // one address off -- same /24, not the same /32
    const ok = await passesApiKeyIpBinding({
      ...baseRow,
      bound_ip: "203.0.113.5",
    });
    expect(ok).toBe(false);

    const alertCall = queries.find((q) =>
      q.sql.includes("INSERT INTO security_alerts"),
    );
    expect(alertCall?.sql).toContain("api_key_ip_mismatch");
    expect(alertCall?.params[0]).toBe(3); // user_id

    expect(mockSendNotificationEmail).toHaveBeenCalledTimes(1);
    const emailArgs = mockSendNotificationEmail.mock.calls[0][0] as {
      userId: number;
      userEmail: string;
      type: string;
    };
    expect(emailArgs.userId).toBe(3);
    expect(emailArgs.userEmail).toBe("owner@example.com");
    expect(emailArgs.type).toBe("api_keys");
  });

  it("does not revoke the key on mismatch -- only that request is declined", async () => {
    enableSettingsRow(true);
    currentIp = "10.0.0.9";
    await passesApiKeyIpBinding({ ...baseRow, bound_ip: "203.0.113.5" });
    expect(queries.some((q) => q.sql.includes("revoked_at = NOW()"))).toBe(
      false,
    );
  });

  it("an admin can widen the subnet (e.g. /24) if /32 is too strict for their deployment", async () => {
    enableSettingsRow(true, 24, 48);
    currentIp = "203.0.113.250";
    const ok = await passesApiKeyIpBinding({
      ...baseRow,
      bound_ip: "203.0.113.5",
    });
    expect(ok).toBe(true);
  });
});

describe("validateApiKey (integration: ip binding is wired into the real lookup)", () => {
  const RAW_KEY =
    "vr_live_test0000000000000000000000000000000000000000000000000000";

  it("returns the key normally when binding is disabled", async () => {
    keyRow = {
      key_id: 9,
      user_id: 3,
      name: "CI key",
      daily_limit: 50,
      revoked_at: null,
      key_hash: digestOf(RAW_KEY),
      bound_ip: "203.0.113.5",
      email: "owner@example.com",
      user_name: "Owner",
      tos_accepted_at: new Date().toISOString(),
    };
    currentIp = "8.8.8.8"; // different network, but the feature is off

    const result = await validateApiKey(RAW_KEY);
    expect(result?.keyId).toBe(9);
    expect(result?.userId).toBe(3);
  });

  it("declines the request (returns null, key untouched) on a subnet mismatch", async () => {
    enableSettingsRow(true);
    keyRow = {
      key_id: 9,
      user_id: 3,
      name: "CI key",
      daily_limit: 50,
      revoked_at: null,
      key_hash: digestOf(RAW_KEY),
      bound_ip: "203.0.113.5",
      email: "owner@example.com",
      user_name: "Owner",
      tos_accepted_at: new Date().toISOString(),
    };
    currentIp = "198.51.100.9";

    const result = await validateApiKey(RAW_KEY);
    expect(result).toBeNull();
    expect(
      queries.some((q) => q.sql.includes("INSERT INTO security_alerts")),
    ).toBe(true);
  });

  it("still returns null for a genuinely wrong key regardless of IP binding", async () => {
    enableSettingsRow(true);
    keyRow = null; // no row matches the digest at all
    currentIp = "203.0.113.5";

    const result = await validateApiKey("vr_live_totally_wrong_key");
    expect(result).toBeNull();
  });
});

describe("validateApiKey (integration: account-state gate -- a suspended account's keys stop working)", () => {
  const RAW_KEY =
    "vr_live_test1111111111111111111111111111111111111111111111111111";

  function keyRowForUser(extra: Row) {
    return {
      key_id: 9,
      user_id: 3,
      name: "CI key",
      daily_limit: 50,
      revoked_at: null,
      key_hash: digestOf(RAW_KEY),
      bound_ip: null,
      email: "owner@example.com",
      user_name: "Owner",
      tos_accepted_at: new Date().toISOString(),
      disabled_at: null,
      ...extra,
    };
  }

  it("rejects every key once FEATURE_API_KEYS is turned off, not just new ones", async () => {
    // Turning the feature off used to gate only key creation, so an operator
    // reacting to a leaked key found every existing key still working.
    settingsRows = [{ key: "FEATURE_API_KEYS", value: "false" }];
    keyRow = keyRowForUser({});
    const result = await validateApiKey(RAW_KEY);
    expect(result).toBeNull();
  });

  it("selects the owner's disabled_at so the account state is available to the gate", async () => {
    keyRow = keyRowForUser({});
    await validateApiKey(RAW_KEY);
    expect(queries.some((q) => q.sql.includes("u.disabled_at"))).toBe(true);
  });

  it("returns the key while the owning account is in good standing", async () => {
    keyRow = keyRowForUser({});
    const result = await validateApiKey(RAW_KEY);
    expect(result?.keyId).toBe(9);
  });

  it("returns null once the owning account is suspended, even though the key itself is not revoked", async () => {
    // The admin 'disable' action wipes sessions but never touches api_keys, and
    // the cookie path re-checks disabled_at on every getSession(). Without this
    // gate the Bearer path had no equivalent, so a user banned for abuse kept a
    // working vr_live_... key: they could go on running scans and reading or
    // deleting history while the admin panel showed the account as disabled.
    keyRow = keyRowForUser({
      disabled_at: "2026-08-01T00:00:00.000Z",
    });
    const result = await validateApiKey(RAW_KEY);
    expect(result).toBeNull();
  });
});

describe("validateApiKey (integration: terms-of-service gating resolves through the runtime config)", () => {
  const RAW_KEY =
    "vr_live_test2222222222222222222222222222222222222222222222222222";

  function keyRowAcceptedAt(tos_accepted_at: string | null) {
    return {
      key_id: 9,
      user_id: 3,
      name: "CI key",
      daily_limit: 50,
      revoked_at: null,
      key_hash: digestOf(RAW_KEY),
      bound_ip: null,
      email: "owner@example.com",
      user_name: "Owner",
      tos_accepted_at,
    };
  }

  it("flags needsTermsAcceptance using a database-overridden terms date, not the shipped default", async () => {
    // Shipped default (CONFIG_TERMS_UPDATED_AT) is well in the past, so this
    // acceptance date alone would pass with no database row at all -- the
    // database override, not the compiled constant, is what fails it here.
    settingsRows = [{ key: "TERMS_UPDATED_AT", value: "2030-01-01" }];
    keyRow = keyRowAcceptedAt("2026-06-01T00:00:00.000Z");
    currentIp = "unknown";

    const result = await validateApiKey(RAW_KEY);
    expect(result?.needsTermsAcceptance).toBe(true);
  });

  it("clears needsTermsAcceptance once the database-overridden terms date is satisfied", async () => {
    settingsRows = [{ key: "TERMS_UPDATED_AT", value: "2020-01-01" }];
    keyRow = keyRowAcceptedAt("2026-06-01T00:00:00.000Z");
    currentIp = "unknown";

    const result = await validateApiKey(RAW_KEY);
    expect(result?.needsTermsAcceptance).toBe(false);
  });

  it("flags needsTermsAcceptance when the key's user has never accepted", async () => {
    settingsRows = [];
    keyRow = keyRowAcceptedAt(null);
    currentIp = "unknown";

    const result = await validateApiKey(RAW_KEY);
    expect(result?.needsTermsAcceptance).toBe(true);
  });

  it("does not block the key on a malformed stored terms date", async () => {
    // "not-a-date" is 10 characters, so it satisfies the registry's length
    // bounds (the "string" type has no date-shape check -- see
    // app/api/v3/admin/features/route.ts's dateShapeError for where that
    // gap is actually closed, on the write path) and is resolved as-is.
    // hasAcceptedLatestTerms's own isNaN guard is what keeps this from
    // wrongly blocking every key once the value is unparseable.
    settingsRows = [{ key: "TERMS_UPDATED_AT", value: "not-a-date" }];
    keyRow = keyRowAcceptedAt("2026-06-01T00:00:00.000Z");
    currentIp = "unknown";

    const result = await validateApiKey(RAW_KEY);
    expect(result?.needsTermsAcceptance).toBe(false);
  });
});

describe("validateApiKey (integration: scoping migration -- a pre-existing key with no scopes column value behaves as full access)", () => {
  const RAW_KEY =
    "vr_live_test3333333333333333333333333333333333333333333333333333";

  function keyRowWithScopes(scopes: unknown) {
    return {
      key_id: 9,
      user_id: 3,
      name: "CI key",
      daily_limit: 50,
      revoked_at: null,
      key_hash: digestOf(RAW_KEY),
      bound_ip: null,
      email: "owner@example.com",
      user_name: "Owner",
      tos_accepted_at: new Date().toISOString(),
      scopes,
    };
  }

  it("grandfathers a key created before scoping existed (scopes column is NULL) in with every scope", async () => {
    keyRow = keyRowWithScopes(null);
    currentIp = "unknown";

    const result = await validateApiKey(RAW_KEY);
    expect(result?.scopes).toEqual(ALL_API_KEY_SCOPES);
  });

  it("also grandfathers a row where the scopes key is entirely absent, not just NULL", async () => {
    const row = keyRowWithScopes(undefined);
    delete (row as { scopes?: unknown }).scopes;
    keyRow = row;
    currentIp = "unknown";

    const result = await validateApiKey(RAW_KEY);
    expect(result?.scopes).toEqual(ALL_API_KEY_SCOPES);
  });

  it("honors an explicit, narrower scopes array from the database instead of widening it", async () => {
    keyRow = keyRowWithScopes(["scan:read"]);
    currentIp = "unknown";

    const result = await validateApiKey(RAW_KEY);
    expect(result?.scopes).toEqual(["scan:read"]);
  });
});

/**
 * An invalid key used to fall from the O(1) lookup straight into a full scan
 * of the legacy bcrypt rows, running a bcryptjs compare (cost 12, pure JS,
 * main thread) per row. No code path writes a bcrypt row, so the answer on a
 * normal install is "there is nothing to scan", and that is checked once and
 * cached.
 */
describe("validateApiKey: legacy fallback scans", () => {
  const RAW =
    "vr_live_test0000000000000000000000000000000000000000000000000000";

  it("skips the bcrypt scan when no legacy bcrypt row exists", async () => {
    keyRow = null;

    const result = await validateApiKey(RAW);

    expect(result).toBeNull();
    const probes = queries.filter((q) => q.sql.includes("SELECT EXISTS"));
    expect(probes).toHaveLength(1);
    // The full scan of the bcrypt rows was not issued.
    expect(
      queries.filter(
        (q) =>
          q.sql.includes("LIKE '$2%'") &&
          !q.sql.includes("SELECT EXISTS") &&
          !q.sql.startsWith("UPDATE"),
      ),
    ).toHaveLength(0);
  });

  it("probes only once across repeated invalid keys", async () => {
    keyRow = null;

    await validateApiKey(RAW);
    await validateApiKey(RAW);
    await validateApiKey(RAW);

    expect(queries.filter((q) => q.sql.includes("SELECT EXISTS"))).toHaveLength(
      1,
    );
  });
});

describe("rotateApiKey", () => {
  function queueRotation() {
    mockQuery.mockImplementationOnce(async (sql: string, params = []) => {
      queries.push({ sql, params });
      return { rows: [{ daily_limit: 50, scopes: ["scan:read"] }] };
    });
    mockQuery.mockImplementationOnce(async (sql: string, params = []) => {
      queries.push({ sql, params });
      return {
        rows: [
          {
            id: 9,
            key_prefix: "vr_live_abcd1234",
            name: "CI key",
            daily_limit: 50,
            created_at: new Date("2030-01-01T00:00:00.000Z"),
            scopes: ["scan:read"],
          },
        ],
      };
    });
  }

  it("clears the IP binding in the same UPDATE that swaps the secret", async () => {
    // The binding belongs to the old secret. A key that kept it could not be
    // used from the network the owner just rotated it for, and the rotation
    // itself is the proof of ownership that reset-binding asks for.
    queueRotation();

    const rotated = await rotateApiKey(9, 3);

    expect(rotated?.id).toBe(9);
    const update = queries.find((q) =>
      /^\s*UPDATE api_keys\s+SET key_hash/.test(q.sql),
    );
    expect(update?.sql).toMatch(/bound_ip = NULL/);
    expect(update?.sql).toMatch(/WHERE id = \$7 AND user_id = \$8/);
    expect(update?.params.slice(-2)).toEqual([9, 3]);
  });
});
