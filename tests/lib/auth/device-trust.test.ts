import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for the new user-facing helpers in lib/auth/device-trust.ts:
 * listTrustedDevices (GET /api/v3/auth/trusted-devices) and
 * revokeTrustedDevice (DELETE /api/v3/auth/trusted-devices/[id]).
 *
 * findTrustedDevice/upsertTrustedDevice (the pre-existing 2FA-login
 * functions) are left untouched and untested here -- only the new
 * account-owner-facing surface is in scope.
 *
 * Mocked at the database boundary only, per tests/README.md.
 */

type Row = Record<string, unknown>;

const queries: { sql: string; params: unknown[] }[] = [];
let listRows: Row[] = [];
let deleteRowCount = 0;

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  queries.push({ sql, params });
  const s = sql.trim();
  if (s.startsWith("SELECT id, device_fingerprint, device_name")) {
    return { rows: listRows };
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

const { listTrustedDevices, revokeTrustedDevice } =
  await import("@/lib/auth/device-trust");

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
