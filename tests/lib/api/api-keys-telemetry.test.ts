import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

/**
 * Which API version and client each key was last used with, the record the
 * v3 sunset review reads.
 *
 * Mocked at the database boundary, so this proves which statement is sent and
 * when, and nothing about what Postgres does with it: that half is
 * tests/integration/api-key-telemetry.test.ts.
 */

type Row = Record<string, unknown>;

const queries: { sql: string; params: unknown[] }[] = [];
let encryptedKeyRow: Row | null = null;
let failUsageWrite = false;
let listRows: Row[] = [];

const USAGE_WRITE = "SET last_used_api_version";

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  queries.push({ sql, params });
  if (sql.includes(USAGE_WRITE)) {
    if (failUsageWrite) throw new Error("connection terminated");
    return { rows: [], rowCount: 1 };
  }
  if (sql.includes("FROM api_keys ak") && sql.includes("ORDER BY CASE")) {
    return { rows: listRows };
  }
  if (sql.includes("ak.key_encrypted") && sql.includes("ak.key_locator = $1")) {
    return { rows: encryptedKeyRow ? [encryptedKeyRow] : [] };
  }
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

vi.mock("@/lib/api/request-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/request-utils")>()),
  getClientIp: vi.fn(async () => "203.0.113.5"),
}));

vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: vi.fn(async () => {}),
}));

const {
  validateApiKey,
  recordKeyUsage,
  listApiKeysByVersionUsage,
  __resetKeyUsageThrottle,
  __resetLegacyKeyRowCache,
} = await import("@/lib/api/api-keys");
const { authenticateApiKey } = await import("@/lib/api/api-key-auth");
const { versioned } = await import("@/lib/api/v4/wrap");
const { runWithApiContext } = await import("@/lib/database/request-context");
const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");
const { API_KEY_SCOPES } = await import("@/lib/api/api-key-scopes");

const RAW_KEY =
  "vr_live_test2222222222222222222222222222222222222222222222222222";

function keyRow(): Row {
  return {
    key_id: 9,
    user_id: 3,
    name: "CI key",
    revoked_at: null,
    key_encrypted: `enc:${RAW_KEY}`,
    bound_ip: null,
    email: "owner@example.com",
    user_name: "Owner",
    tos_accepted_at: new Date().toISOString(),
    disabled_at: null,
  };
}

function usageWrites() {
  return queries.filter((q) => q.sql.includes(USAGE_WRITE));
}

let now = 1_800_000_000_000;

beforeEach(() => {
  mockQuery.mockClear();
  queries.length = 0;
  encryptedKeyRow = null;
  failUsageWrite = false;
  listRows = [];
  now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  process.env.API_KEY_ENCRYPTION_KEY = "a".repeat(64);
  __resetKeyUsageThrottle();
  __resetLegacyKeyRowCache();
  invalidateSettingsCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("validateApiKey records the version and client it was used with", () => {
  it("writes nothing outside versioned(), where the version is unknown", async () => {
    encryptedKeyRow = keyRow();
    const result = await validateApiKey(RAW_KEY);
    expect(result?.keyId).toBe(9);
    expect(usageWrites()).toEqual([]);
  });

  it("writes the ambient version and client for a genuine key", async () => {
    encryptedKeyRow = keyRow();
    await runWithApiContext({ apiVersion: "v3", client: "cli/2.1.0" }, () =>
      validateApiKey(RAW_KEY),
    );
    expect(usageWrites().map((q) => q.params)).toEqual([
      [9, "v3", "cli/2.1.0"],
    ]);
  });

  it("writes nothing for a key that did not validate", async () => {
    encryptedKeyRow = { ...keyRow(), revoked_at: new Date().toISOString() };
    const result = await runWithApiContext(
      { apiVersion: "v4", client: "extension/0.3.0" },
      () => validateApiKey(RAW_KEY),
    );
    expect(result).toBeNull();
    expect(usageWrites()).toEqual([]);
  });

  it("is recorded on the authenticateApiKey path under versioned(), header and all", async () => {
    encryptedKeyRow = keyRow();
    let authenticated = false;
    const handler = versioned("auth.me", async (request: Request) => {
      const result = await authenticateApiKey(request, {
        scope: API_KEY_SCOPES.SCAN_READ,
      });
      authenticated = result.ok;
      return NextResponse.json({});
    });

    await handler(
      new Request("https://x.test/api/v3/auth/me", {
        headers: {
          authorization: `Bearer ${RAW_KEY}`,
          "x-vulnradar-client": "extension/0.3.0",
        },
      }),
    );

    expect(authenticated).toBe(true);
    expect(usageWrites().map((q) => q.params)).toEqual([
      [9, "v3", "extension/0.3.0"],
    ]);
  });

  it("stores NULL for a client header that is not a plain client name", async () => {
    encryptedKeyRow = keyRow();
    const handler = versioned("scan.reputation", async (request: Request) => {
      await authenticateApiKey(request);
      return NextResponse.json({});
    });

    await handler(
      new Request("https://x.test/api/v3/scan/reputation", {
        headers: {
          authorization: `Bearer ${RAW_KEY}`,
          "x-vulnradar-client": "<script>alert(1)</script>",
        },
      }),
    );

    expect(usageWrites().map((q) => q.params)).toEqual([[9, "v3", null]]);
  });
});

describe("recordKeyUsage", () => {
  it("writes once per key per minute while nothing changes", async () => {
    const usage = { apiVersion: "v3", client: "cli/2.1.0" } as const;
    await recordKeyUsage(9, usage);
    now += 30_000;
    await recordKeyUsage(9, usage);
    now += 29_999;
    await recordKeyUsage(9, usage);
    expect(usageWrites()).toHaveLength(1);

    now += 1;
    await recordKeyUsage(9, usage);
    expect(usageWrites()).toHaveLength(2);
  });

  it("writes at once when the version or the client changes", async () => {
    await recordKeyUsage(9, { apiVersion: "v3", client: "cli/2.1.0" });
    await recordKeyUsage(9, { apiVersion: "v4", client: "cli/2.1.0" });
    await recordKeyUsage(9, { apiVersion: "v4", client: "cli/2.2.0" });
    await recordKeyUsage(9, { apiVersion: "v4", client: null });
    expect(usageWrites().map((q) => q.params)).toEqual([
      [9, "v3", "cli/2.1.0"],
      [9, "v4", "cli/2.1.0"],
      [9, "v4", "cli/2.2.0"],
      [9, "v4", null],
    ]);
  });

  it("throttles each key on its own", async () => {
    const usage = { apiVersion: "v3", client: null } as const;
    await recordKeyUsage(9, usage);
    await recordKeyUsage(10, usage);
    await recordKeyUsage(9, usage);
    expect(usageWrites().map((q) => q.params[0])).toEqual([9, 10]);
  });

  it.each([
    ["a space", "cli 2.1.0"],
    ["a semicolon", "cli/2.1.0;drop"],
    ["65 characters", "x".repeat(65)],
    ["an empty string", ""],
    ["a newline", "cli/2.1.0\n"],
  ])(
    "stores NULL, never a trimmed copy, for a client with %s",
    async (_label, client) => {
      await recordKeyUsage(9, { apiVersion: "v4", client });
      expect(usageWrites().map((q) => q.params)).toEqual([[9, "v4", null]]);
    },
  );

  it("keeps a 64-character client name whole", async () => {
    const client = `cli/${"1".repeat(60)}`;
    await recordKeyUsage(9, { apiVersion: "v4", client });
    expect(usageWrites().map((q) => q.params)).toEqual([[9, "v4", client]]);
  });

  it("logs a failed write without rejecting, and tries again on the next use", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    failUsageWrite = true;
    const usage = { apiVersion: "v3", client: null } as const;

    await expect(recordKeyUsage(9, usage)).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      "[api-keys] could not record which API version a key was used with",
      { keyId: 9 },
      expect.any(Error),
    );

    failUsageWrite = false;
    await recordKeyUsage(9, usage);
    expect(usageWrites()).toHaveLength(2);
  });

  it("remembers a bounded number of keys, forgetting the least recently written", async () => {
    const usage = { apiVersion: "v3", client: null } as const;
    for (let keyId = 1; keyId <= 10_000; keyId += 1) {
      await recordKeyUsage(keyId, usage);
    }
    await recordKeyUsage(1, usage);
    expect(usageWrites()).toHaveLength(10_000);

    // The 10,001st key pushes out key 1, the least recently written.
    await recordKeyUsage(10_001, usage);
    await recordKeyUsage(3, usage);
    expect(usageWrites()).toHaveLength(10_001);
    await recordKeyUsage(1, usage);
    expect(usageWrites()).toHaveLength(10_002);
  });
});

describe("listApiKeysByVersionUsage", () => {
  it("maps rows and passes no filter by default", async () => {
    const lastUsedAt = new Date("2026-11-01T00:00:00Z");
    listRows = [
      {
        key_id: 4,
        key_prefix: "vr_live_ab",
        name: "CI",
        user_id: 3,
        email: "owner@example.com",
        last_used_api_version: "v3",
        last_used_client: null,
        last_used_at: lastUsedAt,
      },
    ];

    await expect(listApiKeysByVersionUsage()).resolves.toEqual([
      {
        keyId: 4,
        keyPrefix: "vr_live_ab",
        keyName: "CI",
        userId: 3,
        ownerEmail: "owner@example.com",
        lastUsedApiVersion: "v3",
        lastUsedClient: null,
        lastUsedAt,
      },
    ]);
    expect(queries[0].params).toEqual([100, 0, null]);
    expect(queries[0].sql).toContain("ak.revoked_at IS NULL");
  });

  it("passes the narrowing list as a parameter and clamps the page", async () => {
    await listApiKeysByVersionUsage({ only: "no-client", limit: 10_000 });
    await listApiKeysByVersionUsage({ only: "v3", limit: 0, offset: -5 });
    expect(queries.map((q) => q.params)).toEqual([
      [500, 0, "no-client"],
      [1, 0, "v3"],
    ]);
  });
});
