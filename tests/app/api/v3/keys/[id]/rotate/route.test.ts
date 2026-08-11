/**
 * Route-level tests for POST /api/v3/keys/[id]/rotate.
 *
 * @/lib/api/api-keys is NOT mocked. The route first gates on
 * `getUserApiKeys(session.userId).find(k => k.id === keyId && !k.revoked_at)`
 * -- a non-owned or already-revoked key ID must 404 *before* any UPDATE
 * happens. On success, rotateApiKey's real SQL does
 * `SELECT daily_limit, scopes WHERE id = $1 AND user_id = $2`, then
 * regenerates the secret and UPDATEs the SAME row in place (new key_hash/
 * key_locator/key_prefix/key_encrypted, same id) rather than deleting and
 * recreating it. Rotating in place (not delete-then-insert) keeps the row's
 * id stable, so api_usage rows -- which reference api_keys(id) ON DELETE
 * CASCADE -- survive a rotation instead of being wiped along with the old
 * row, and the key's daily usage count doesn't reset to zero just because
 * its secret changed. The tests below prove the UPDATE targets the SAME id
 * and that no DELETE ever runs.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
  getUserAgent: vi.fn(async () => "vitest"),
}));

const mockSendNotificationEmail = vi.fn();
vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: (...args: unknown[]) =>
    mockSendNotificationEmail(...args),
}));

// billing: the route resolves the rotated key's daily limit through
// getUserPlanLimits (lib/billing/plan-limits.ts), which itself resolves
// getSetting/getSettings and getUserPlan. Mock those two at their own module
// boundary (same approach as tests/app/api/v3/keys/route.test.ts) instead of
// a hand-rolled "SELECT plan" pool.query row, so getUserPlanLimits's real
// cap/plan-limit logic still runs.
const mockGetSetting = vi.fn();
async function resolveFromRegistry(keys: string[]) {
  const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");
  return Object.fromEntries(
    keys.map((k) => [
      k,
      SETTINGS_REGISTRY[k as keyof typeof SETTINGS_REGISTRY].default,
    ]),
  );
}
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
  getSettings: (keys: string[]) => resolveFromRegistry(keys),
}));

const mockGetUserPlan = vi.fn();
vi.mock("@/lib/rate-limiting/daily-limits", () => ({
  getUserPlan: (...args: unknown[]) => mockGetUserPlan(...args),
}));

const { POST } = await import("@/app/api/v3/keys/[id]/rotate/route");

function params(id = "42") {
  return { params: Promise.resolve({ id }) };
}

function postRequest() {
  return new NextRequest("http://localhost/api/v3/keys/42/rotate", {
    method: "POST",
  });
}

function activeKeyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    key_prefix: "vr_live_aaaaaaaa",
    name: "Prod key",
    daily_limit: 25,
    revoked_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 7, email: "owner@example.com" });
  mockSendNotificationEmail.mockReset();
  mockSendNotificationEmail.mockResolvedValue(undefined);
  mockGetSetting.mockReset();
  mockGetSetting.mockResolvedValue(true); // billing enabled by default
  mockGetUserPlan.mockReset();
  mockGetUserPlan.mockResolvedValue("core_supporter");
  process.env.API_KEY_ENCRYPTION_KEY = "a".repeat(64);
});

describe("POST /api/v3/keys/[id]/rotate", () => {
  it("rejects an unauthenticated request before touching the database", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await POST(postRequest(), params());

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric key id before touching the database", async () => {
    const res = await POST(postRequest(), params("nope"));

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("looks up the caller's own keys scoped by user_id", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await POST(postRequest(), params());

    const [sql, sqlParams] = mockQuery.mock.calls[0];
    expect(sql).toContain("ak.user_id = $1");
    expect(sqlParams).toEqual([7]);
  });

  it("404s a non-owned key id before any UPDATE runs", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // caller owns no key with this id

    const res = await POST(postRequest(), params("42"));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Key not found or already revoked");
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(
      mockQuery.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE api_keys"),
      ),
    ).toBe(false);
  });

  it("404s an already-revoked key id before any UPDATE runs", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [activeKeyRow({ revoked_at: new Date().toISOString() })],
    });

    const res = await POST(postRequest(), params("42"));

    expect(res.status).toBe(404);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("rotates the caller's own active key in place: same id, no DELETE, new raw_key returned once", async () => {
    mockGetUserPlan.mockResolvedValue("free");
    mockQuery.mockResolvedValueOnce({ rows: [activeKeyRow()] }); // gating getUserApiKeys
    mockQuery.mockResolvedValueOnce({
      rows: [{ daily_limit: 25, scopes: null }],
    }); // rotateApiKey's internal SELECT
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 42,
          key_prefix: "vr_live_ffffffff",
          name: "Prod key",
          daily_limit: 25,
          created_at: new Date().toISOString(),
          scopes: null,
        },
      ],
    }); // UPDATE ... RETURNING -- same id as the original key
    mockQuery.mockResolvedValueOnce({
      rows: [{ email: "owner@example.com" }],
    }); // rotateApiKey's own "SELECT email FROM users" for the notification

    const res = await POST(postRequest(), params("42"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(typeof json.key.raw_key).toBe("string");
    expect(json.key.raw_key.length).toBeGreaterThan(0);
    expect(json.key.name).toBe("Prod key");
    // Same id as before rotation -- proves the row was updated in place,
    // not replaced, so api_usage rows tied to this id (and this key's
    // usage-today count) survive the rotation.
    expect(json.key.id).toBe(42);

    const updateCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE api_keys"),
    );
    expect(updateCall).toBeDefined();
    // Last two bind params are the WHERE clause: id = $7 AND user_id = $8.
    expect(updateCall?.[1].slice(-2)).toEqual([42, 7]);
    expect(
      mockQuery.mock.calls.some(([sql]) =>
        String(sql).includes("DELETE FROM api_keys"),
      ),
    ).toBe(false);

    // Sent once, from inside rotateApiKey() itself (lib/api/api-keys.ts),
    // using apiKeyRotationEmail rather than the route re-sending
    // apiKeyCreatedEmail -- a rotation is not a first-time key creation.
    expect(mockSendNotificationEmail).toHaveBeenCalledTimes(1);
    expect(mockSendNotificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        userEmail: "owner@example.com",
        type: "api_keys",
      }),
    );
  });

  it("maps an unlimited plan (-1) to the 999999 sentinel on rotation", async () => {
    mockGetUserPlan.mockResolvedValue("elite_supporter");
    mockQuery.mockResolvedValueOnce({ rows: [activeKeyRow()] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ daily_limit: 25, scopes: null }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 42,
          key_prefix: "vr_live_gggggggg",
          name: "Prod key",
          daily_limit: 999999,
          created_at: new Date().toISOString(),
          scopes: null,
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ email: "owner@example.com" }],
    }); // rotateApiKey's own "SELECT email FROM users" for the notification

    await POST(postRequest(), params("42"));

    const updateCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE api_keys"),
    );
    expect(updateCall?.[1][4]).toBe(999999);
  });

  it("carries the old key's scopes forward onto the rotated replacement instead of resetting to the new-key default", async () => {
    mockGetUserPlan.mockResolvedValue("free");
    mockQuery.mockResolvedValueOnce({ rows: [activeKeyRow()] }); // gating getUserApiKeys
    mockQuery.mockResolvedValueOnce({
      rows: [{ daily_limit: 25, scopes: ["scan:delete"] }],
    }); // rotateApiKey's internal SELECT -- old key had ONLY scan:delete,
    // which is not part of the new-key default (scan:write + scan:read)
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 42,
          key_prefix: "vr_live_hhhhhhhh",
          name: "Prod key",
          daily_limit: 25,
          created_at: new Date().toISOString(),
          scopes: ["scan:delete"],
        },
      ],
    }); // UPDATE ... RETURNING
    mockQuery.mockResolvedValueOnce({
      rows: [{ email: "owner@example.com" }],
    }); // rotation notification lookup

    const res = await POST(postRequest(), params("42"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.key.scopes).toEqual(["scan:delete"]);

    const updateCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE api_keys"),
    );
    expect(JSON.parse(updateCall?.[1][5])).toEqual(["scan:delete"]);
  });

  it("returns 500 if the key disappears between the gating check and rotateApiKey's own SELECT", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [activeKeyRow()] }); // gating passes
    mockQuery.mockResolvedValueOnce({ rows: [] }); // rotateApiKey's SELECT finds nothing (race)

    const res = await POST(postRequest(), params("42"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe("Failed to rotate key");
    expect(
      mockQuery.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE api_keys"),
      ),
    ).toBe(false);
  });

  it("returns 500 if the row disappears between rotateApiKey's SELECT and its UPDATE", async () => {
    mockGetUserPlan.mockResolvedValue("free");
    mockQuery.mockResolvedValueOnce({ rows: [activeKeyRow()] }); // gating passes
    mockQuery.mockResolvedValueOnce({
      rows: [{ daily_limit: 25, scopes: null }],
    }); // rotateApiKey's SELECT finds the row
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE matches nothing (race)

    const res = await POST(postRequest(), params("42"));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe("Failed to rotate key");
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
  });
});
