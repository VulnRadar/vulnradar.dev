/**
 * Route-level tests for GET/POST /api/v3/keys.
 *
 * @/lib/api/api-keys is NOT mocked: generateApiKey and getUserApiKeys are
 * thin wrappers around pool.query sitting at the DB boundary, and the whole
 * point of testing ownership/limits here is to prove the real SQL and the
 * real cap/plan-limit logic run, not a copy of it pasted into the test. Only
 * pool.query, getSession, outbound email, and the Next.js-runtime-only
 * getClientIp/getUserAgent (which need a real request scope this unit test
 * doesn't have) are mocked.
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

// getUserPlanLimits (lib/billing/plan-limits.ts) is real: only its two DB
// touch points are mocked, matching how the rest of the config-resolver
// wiring in this codebase is tested. Default plan is core_supporter
// (apiKeys: 3), which reproduces every existing test's original flat-3
// assumption without changing them.
const mockGetSetting = vi.fn();
// getSettings resolves from the real registry defaults rather than
// hand-copied numbers, so these tests can't silently drift from what the
// registry actually ships (matching the "prove the real cap logic runs"
// approach this suite already uses for getUserApiKeys/generateApiKey).
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

const { GET, POST } = await import("@/app/api/v3/keys/route");

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/v3/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Flush the setImmediate the POST handler uses to fire the notification
// email without blocking the response.
async function flushSetImmediate() {
  await new Promise((resolve) => setImmediate(resolve));
}

function existingKeyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    key_prefix: "vr_live_aaaaaaaa",
    name: "Old key",
    daily_limit: 25,
    created_at: new Date().toISOString(),
    last_used_at: null,
    revoked_at: null,
    usage_today: 0,
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
  mockGetSetting.mockResolvedValue(true);
  mockGetUserPlan.mockReset();
  mockGetUserPlan.mockResolvedValue("core_supporter");
  process.env.API_KEY_ENCRYPTION_KEY = "a".repeat(64);
});

describe("GET /api/v3/keys", () => {
  it("rejects an unauthenticated request before touching the database", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns only the session user's own keys", async () => {
    const row = existingKeyRow();
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.keys).toEqual([row]);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("ak.user_id = $1");
    expect(params).toEqual([7]);
  });
});

describe("POST /api/v3/keys", () => {
  it("rejects an unauthenticated request before touching the database", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await POST(postRequest({ name: "CI" }));

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("creates a key with the free plan's daily limit and returns raw_key once", async () => {
    // billing: dailyLimit now comes from the same getUserPlanLimits() call
    // already made for the active-key-count check (plan-limits.ts, which
    // resolves the live, admin-configurable per-plan value), not a second
    // hand-rolled "SELECT plan" query, so the plan comes from the mocked
    // getUserPlan rather than a queued pool.query row.
    mockGetUserPlan.mockResolvedValue("free");
    mockQuery.mockResolvedValueOnce({ rows: [] }); // getUserApiKeys (existing)
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 5,
          key_prefix: "vr_live_bbbbbbbb",
          name: "CI",
          daily_limit: 25,
          created_at: new Date().toISOString(),
        },
      ],
    }); // INSERT

    const res = await POST(postRequest({ name: "CI" }));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(typeof json.key.raw_key).toBe("string");
    expect(json.key.raw_key.startsWith("vr_live_")).toBe(true);

    const insertParams = mockQuery.mock.calls[1][1];
    expect(insertParams[4]).toBe("CI"); // name
    expect(insertParams[5]).toBe(25); // free plan's daily limit

    await flushSetImmediate();
    expect(mockSendNotificationEmail).toHaveBeenCalledTimes(1);
    const emailCall = mockSendNotificationEmail.mock.calls[0][0];
    expect(emailCall.userId).toBe(7);
    expect(emailCall.type).toBe("api_keys");
  });

  it("maps an unlimited plan (-1) to the 999999 sentinel", async () => {
    mockGetUserPlan.mockResolvedValue("elite_supporter");
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 6,
          key_prefix: "vr_live_cccccccc",
          name: "Default",
          daily_limit: 999999,
          created_at: new Date().toISOString(),
        },
      ],
    });

    await POST(postRequest({}));

    const insertParams = mockQuery.mock.calls[1][1];
    expect(insertParams[4]).toBe("Default"); // no name supplied
    expect(insertParams[5]).toBe(999999);
  });

  it("blocks creation once the caller already has 3 active keys", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        existingKeyRow({ id: 1 }),
        existingKeyRow({ id: 2 }),
        existingKeyRow({ id: 3 }),
      ],
    });

    const res = await POST(postRequest({ name: "Fourth" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("up to 3 API keys");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("blocks creation on the free plan once the caller already has its one allowed key", async () => {
    mockGetUserPlan.mockResolvedValue("free");
    mockQuery.mockResolvedValueOnce({ rows: [existingKeyRow({ id: 1 })] });

    const res = await POST(postRequest({ name: "Second" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("up to 1 API keys");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("does not cap key creation when billing is disabled", async () => {
    mockGetSetting.mockResolvedValue(false);
    mockQuery.mockResolvedValueOnce({
      rows: [
        existingKeyRow({ id: 1 }),
        existingKeyRow({ id: 2 }),
        existingKeyRow({ id: 3 }),
        existingKeyRow({ id: 4 }),
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 9,
          key_prefix: "vr_live_ffffffff",
          name: "Fifth",
          daily_limit: 999999,
          created_at: new Date().toISOString(),
        },
      ],
    });

    const res = await POST(postRequest({ name: "Fifth" }));

    expect(res.status).toBe(201);
    // getUserPlan is never called: getUserPlanLimits short-circuits on the
    // billing-disabled check before it would need the caller's plan.
    expect(mockGetUserPlan).not.toHaveBeenCalled();

    const insertParams = mockQuery.mock.calls[1][1];
    expect(insertParams[5]).toBe(999999); // billing off -> unlimited sentinel
  });

  it("does not count revoked keys toward the 3-active-key cap", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        existingKeyRow({ id: 1, revoked_at: new Date().toISOString() }),
        existingKeyRow({ id: 2 }),
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 7,
          key_prefix: "vr_live_dddddddd",
          name: "Third active",
          daily_limit: 100,
          created_at: new Date().toISOString(),
        },
      ],
    });

    const res = await POST(postRequest({ name: "Third active" }));

    expect(res.status).toBe(201);
  });

  it("truncates an overlong name to 100 characters", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 8,
          key_prefix: "vr_live_eeeeeeee",
          name: "x".repeat(100),
          daily_limit: 100,
          created_at: new Date().toISOString(),
        },
      ],
    });

    await POST(postRequest({ name: "x".repeat(150) }));

    const insertParams = mockQuery.mock.calls[1][1];
    expect(insertParams[4]).toHaveLength(100);
  });
});
