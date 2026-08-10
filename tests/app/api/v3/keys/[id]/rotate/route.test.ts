/**
 * Route-level tests for POST /api/v3/keys/[id]/rotate.
 *
 * @/lib/api/api-keys is NOT mocked. The route first gates on
 * `getUserApiKeys(session.userId).find(k => k.id === keyId && !k.revoked_at)`
 * -- a non-owned or already-revoked key ID must 404 *before* any DELETE or
 * INSERT happens. On success, rotateApiKey's real SQL does
 * `SELECT ... WHERE id = $1 AND user_id = $2`, then hard-deletes the old row
 * (`DELETE FROM api_keys WHERE id = $1`, invalidating it), then inserts a
 * new one via generateApiKey. The tests below prove the DELETE is actually
 * issued and that the response's raw_key is present.
 *
 * Note (flagged in the final report, not fixed here): that DELETE has no
 * user_id filter. It's safe today only because the preceding SELECT inside
 * rotateApiKey already scoped by user_id and returned a row before the
 * DELETE runs -- a defense-in-depth gap, not a live IDOR.
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

  it("404s a non-owned key id before any DELETE or INSERT runs", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // caller owns no key with this id

    const res = await POST(postRequest(), params("42"));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Key not found or already revoked");
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(
      mockQuery.mock.calls.some(([sql]) =>
        String(sql).includes("DELETE FROM api_keys"),
      ),
    ).toBe(false);
  });

  it("404s an already-revoked key id before any DELETE or INSERT runs", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [activeKeyRow({ revoked_at: new Date().toISOString() })],
    });

    const res = await POST(postRequest(), params("42"));

    expect(res.status).toBe(404);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("rotates the caller's own active key: old key hard-deleted, new raw_key returned once", async () => {
    mockGetUserPlan.mockResolvedValue("free");
    mockQuery.mockResolvedValueOnce({ rows: [activeKeyRow()] }); // gating getUserApiKeys
    mockQuery.mockResolvedValueOnce({
      rows: [{ name: "Prod key", daily_limit: 25 }],
    }); // rotateApiKey's internal SELECT
    mockQuery.mockResolvedValueOnce({ rows: [] }); // DELETE FROM api_keys
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 43,
          key_prefix: "vr_live_ffffffff",
          name: "Prod key",
          daily_limit: 25,
          created_at: new Date().toISOString(),
        },
      ],
    }); // INSERT (generateApiKey)
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

    // The old key was actually hard-deleted -- this is the "rotation
    // invalidates the old key" proof.
    const deleteCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("DELETE FROM api_keys"),
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall?.[1]).toEqual([42, 7]);

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
      rows: [{ name: "Prod key", daily_limit: 25 }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 44,
          key_prefix: "vr_live_gggggggg",
          name: "Prod key",
          daily_limit: 999999,
          created_at: new Date().toISOString(),
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ email: "owner@example.com" }],
    }); // rotateApiKey's own "SELECT email FROM users" for the notification

    await POST(postRequest(), params("42"));

    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO api_keys"),
    );
    expect(insertCall?.[1][5]).toBe(999999);
  });

  it("carries the old key's scopes forward onto the rotated replacement instead of resetting to the new-key default", async () => {
    mockGetUserPlan.mockResolvedValue("free");
    mockQuery.mockResolvedValueOnce({ rows: [activeKeyRow()] }); // gating getUserApiKeys
    mockQuery.mockResolvedValueOnce({
      rows: [{ name: "Prod key", daily_limit: 25, scopes: ["scan:delete"] }],
    }); // rotateApiKey's internal SELECT -- old key had ONLY scan:delete,
    // which is not part of the new-key default (scan:write + scan:read)
    mockQuery.mockResolvedValueOnce({ rows: [] }); // DELETE FROM api_keys
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 45,
          key_prefix: "vr_live_hhhhhhhh",
          name: "Prod key",
          daily_limit: 25,
          created_at: new Date().toISOString(),
          scopes: ["scan:delete"],
        },
      ],
    }); // INSERT (generateApiKey)
    mockQuery.mockResolvedValueOnce({
      rows: [{ email: "owner@example.com" }],
    }); // rotation notification lookup

    const res = await POST(postRequest(), params("42"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.key.scopes).toEqual(["scan:delete"]);

    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO api_keys"),
    );
    expect(JSON.parse(insertCall?.[1][7])).toEqual(["scan:delete"]);
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
        String(sql).includes("DELETE FROM api_keys"),
      ),
    ).toBe(false);
  });
});
