import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for API key IP binding (passesApiKeyIpBinding), plus one
 * validateApiKey integration test proving the check is actually wired
 * into the real lookup path, not just exercised in isolation.
 *
 * Mocked at the database and network boundary: pool.query,
 * sendNotificationEmail, and lib/auth/crypto (real AES/HMAC isn't the
 * thing under test here; see lib/auth/crypto.test.ts and
 * lib/auth/password-hash.test.ts for suites that exercise the real
 * primitives). getClientIp is mocked for the same reason as in
 * auth.test.ts; ipsInSameSubnet is left real via importOriginal.
 */

type Row = Record<string, unknown>;

const queries: { sql: string; params: unknown[] }[] = [];
let settingsRows: Row[] = [];
let encryptedKeyRow: Row | null = null;

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
  if (s.includes("ak.key_encrypted") && s.includes("ak.key_locator = $1")) {
    return { rows: encryptedKeyRow ? [encryptedKeyRow] : [] };
  }
  // Every other lookup branch (legacy/backfill/hash paths) is irrelevant
  // to the row under test in this suite: return empty so validateApiKey
  // falls through them without a match.
  return { rows: [] };
});

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
  },
}));

vi.mock("@/lib/auth/crypto", () => ({
  isEncryptionConfigured: () => true,
  encryptApiKey: (raw: string) => `enc:${raw}`,
  decryptApiKey: (enc: string) => String(enc).replace(/^enc:/, ""),
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

const { passesApiKeyIpBinding, validateApiKey } =
  await import("@/lib/api/api-keys");
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
  encryptedKeyRow = null;
  currentIp = "unknown";
  process.env.API_KEY_ENCRYPTION_KEY = "a".repeat(64);
  invalidateSettingsCache();
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
    encryptedKeyRow = {
      key_id: 9,
      user_id: 3,
      name: "CI key",
      daily_limit: 50,
      revoked_at: null,
      key_encrypted: `enc:${RAW_KEY}`,
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
    encryptedKeyRow = {
      key_id: 9,
      user_id: 3,
      name: "CI key",
      daily_limit: 50,
      revoked_at: null,
      key_encrypted: `enc:${RAW_KEY}`,
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
    encryptedKeyRow = null; // no row matches the locator at all
    currentIp = "203.0.113.5";

    const result = await validateApiKey("vr_live_totally_wrong_key");
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
      key_encrypted: `enc:${RAW_KEY}`,
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
    encryptedKeyRow = keyRowAcceptedAt("2026-06-01T00:00:00.000Z");
    currentIp = "unknown";

    const result = await validateApiKey(RAW_KEY);
    expect(result?.needsTermsAcceptance).toBe(true);
  });

  it("clears needsTermsAcceptance once the database-overridden terms date is satisfied", async () => {
    settingsRows = [{ key: "TERMS_UPDATED_AT", value: "2020-01-01" }];
    encryptedKeyRow = keyRowAcceptedAt("2026-06-01T00:00:00.000Z");
    currentIp = "unknown";

    const result = await validateApiKey(RAW_KEY);
    expect(result?.needsTermsAcceptance).toBe(false);
  });

  it("flags needsTermsAcceptance when the key's user has never accepted", async () => {
    settingsRows = [];
    encryptedKeyRow = keyRowAcceptedAt(null);
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
    encryptedKeyRow = keyRowAcceptedAt("2026-06-01T00:00:00.000Z");
    currentIp = "unknown";

    const result = await validateApiKey(RAW_KEY);
    expect(result?.needsTermsAcceptance).toBe(false);
  });
});
