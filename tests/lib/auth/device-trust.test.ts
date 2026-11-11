import { createHash } from "node:crypto";
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for the new user-facing helpers in lib/auth/device-trust.ts:
 * listTrustedDevices (GET /api/v3/auth/trusted-devices) and
 * revokeTrustedDevice (DELETE /api/v3/auth/trusted-devices/[id]).
 *
 * And the 2FA-login pair, findTrustedDevice and upsertTrustedDevice: a
 * trusted-device token skips the second factor, so the table keeps only its
 * SHA-256 and a database read is no longer a 2FA bypass for every account
 * with a remembered browser.
 *
 * Mocked at the database boundary only, per tests/README.md.
 */

type Row = Record<string, unknown>;

const queries: { sql: string; params: unknown[] }[] = [];
let listRows: Row[] = [];
let deleteRowCount = 0;
let trustedFingerprints: string[] = [];

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  queries.push({ sql, params });
  const s = sql.trim();
  if (s.startsWith("SELECT id, device_fingerprint, device_name")) {
    return { rows: listRows };
  }
  if (s.startsWith("SELECT 1 FROM device_trust")) {
    return {
      rows: trustedFingerprints.includes(params[1] as string) ? [{}] : [],
    };
  }
  if (s.startsWith("DELETE FROM device_trust WHERE id = $1 AND user_id = $2")) {
    return { rows: [], rowCount: deleteRowCount };
  }
  return { rows: [] };
});

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
  },
}));

const {
  findTrustedDevice,
  listTrustedDevices,
  revokeTrustedDevice,
  upsertTrustedDevice,
} = await import("@/lib/auth/device-trust");

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

beforeEach(() => {
  mockQuery.mockClear();
  queries.length = 0;
  listRows = [];
  deleteRowCount = 0;
});

describe("listTrustedDevices", () => {
  it("scopes the query to the given user_id and only unexpired devices", async () => {
    listRows = [
      {
        id: 5,
        device_fingerprint: "f".repeat(64),
        device_name: "Work laptop",
        ip_address: "203.0.113.5",
        user_agent: "curl/8.0",
        last_used_at: "2026-01-05T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
        expires_at: "2026-06-01T00:00:00.000Z",
      },
    ];

    const rows = await listTrustedDevices(42);

    expect(rows).toEqual(listRows);
    const call = queries[0];
    expect(call.sql).toContain("FROM device_trust");
    expect(call.sql).toContain("WHERE user_id = $1 AND expires_at > NOW()");
    expect(call.params).toEqual([42]);
  });

  it("includes device_fingerprint in the raw row (route strips it before responding)", async () => {
    listRows = [
      {
        id: 1,
        device_fingerprint: "secret-fingerprint",
        device_name: null,
        ip_address: null,
        user_agent: null,
        last_used_at: "2026-01-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
        expires_at: "2026-06-01T00:00:00.000Z",
      },
    ];
    const rows = await listTrustedDevices(1);
    expect(rows[0].device_fingerprint).toBe("secret-fingerprint");
  });
});

describe("revokeTrustedDevice", () => {
  it("sends a DELETE scoped to both id and user_id, and reports success", async () => {
    deleteRowCount = 1;
    const ok = await revokeTrustedDevice(42, 5);
    expect(ok).toBe(true);

    const call = queries.find((q) =>
      q.sql.startsWith(
        "DELETE FROM device_trust WHERE id = $1 AND user_id = $2",
      ),
    );
    expect(call?.params).toEqual([5, 42]);
  });

  it("reports failure when no row matched (wrong user_id, or no such device) -- the IDOR guard", async () => {
    deleteRowCount = 0;
    // user 42 trying to revoke device id 5, which actually belongs to
    // another user: the query still runs scoped to user_id = 42, so it
    // affects zero rows rather than deleting someone else's device.
    const ok = await revokeTrustedDevice(42, 5);
    expect(ok).toBe(false);
  });
});

describe("the trusted-device token is stored hashed", () => {
  beforeEach(() => {
    trustedFingerprints = [];
  });

  it("writes sha256 of the cookie value, never the value itself", async () => {
    const cookie = await upsertTrustedDevice(42, null, "203.0.113.5", "ua");

    const insert = queries.find((q) =>
      q.sql.includes("INSERT INTO device_trust"),
    )!;
    expect(cookie).toMatch(/^[0-9a-f]{64}$/);
    expect(insert.params[1]).toBe(sha256(cookie));
    expect(insert.params).not.toContain(cookie);
  });

  it("looks the cookie up by its hash, so the stored value is not a credential", async () => {
    const cookie = "a".repeat(64);
    trustedFingerprints = [sha256(cookie)];

    expect(await findTrustedDevice(42, cookie)).toBe(true);
    // What a database read hands an attacker: the stored hash. Presented as a
    // cookie it is hashed again and matches nothing.
    expect(await findTrustedDevice(42, sha256(cookie))).toBe(false);
    for (const q of queries.filter((x) => x.sql.includes("device_trust"))) {
      expect(q.params).not.toContain(cookie);
    }
  });

  it("refuses a rows-from-before value stored raw", async () => {
    const legacy = "b".repeat(64);
    trustedFingerprints = [legacy];
    expect(await findTrustedDevice(42, legacy)).toBe(false);
  });
});
