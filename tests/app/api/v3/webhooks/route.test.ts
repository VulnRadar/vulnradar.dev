/**
 * Route-level tests for POST /api/v3/webhooks: secret generation/exposure
 * and the plan-tier webhook cap.
 *
 * getUserPlanLimits (lib/billing/plan-limits.ts) is REAL here, same
 * approach as tests/app/api/v3/schedules/route.test.ts and
 * tests/app/api/v3/keys/route.test.ts -- only its DB/setting touch points
 * (getSetting/getSettings, getUserPlan) are mocked, so a test that proves
 * "plan X gets capped at N webhooks" is proving the real resolver + the
 * real withinPlanLimit() check in the route, not a hand-rolled stand-in.
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

const mockValidateScanTarget = vi.fn();
vi.mock("@/lib/scanner/safe-fetch", () => ({
  validateScanTarget: (...args: unknown[]) => mockValidateScanTarget(...args),
  safeFetch: vi.fn(),
}));

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
}));

const mockSendNotificationEmail = vi.fn();
vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: (...args: unknown[]) =>
    mockSendNotificationEmail(...args),
}));

const mockGetSetting = vi.fn();
const mockGetFeatureWebhooks = vi.fn();
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
  getSetting: async (key: string) => {
    if (key === "BILLING_ENABLED") return mockGetSetting();
    if (key === "FEATURE_WEBHOOKS") return mockGetFeatureWebhooks();
    const [resolved] = Object.values(await resolveFromRegistry([key]));
    return resolved;
  },
  getSettings: (keys: string[]) => resolveFromRegistry(keys),
}));

const mockGetUserPlan = vi.fn();
vi.mock("@/lib/rate-limiting/daily-limits", () => ({
  getUserPlan: (...args: unknown[]) => mockGetUserPlan(...args),
}));

const { GET, POST } = await import("@/app/api/v3/webhooks/route");

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/v3/webhooks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 7, email: "owner@example.com" });
  mockValidateScanTarget.mockReset();
  mockValidateScanTarget.mockResolvedValue({ safe: true });
  mockSendNotificationEmail.mockReset();
  mockSendNotificationEmail.mockResolvedValue(undefined);
  mockGetSetting.mockReset();
  mockGetSetting.mockResolvedValue(true); // billing enabled
  mockGetFeatureWebhooks.mockReset();
  mockGetFeatureWebhooks.mockResolvedValue(true);
  mockGetUserPlan.mockReset();
  mockGetUserPlan.mockResolvedValue("pro_supporter"); // webhooks: 5
});

describe("GET /api/v3/webhooks", () => {
  it("never selects the secret column", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await GET();

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).not.toContain("secret");
  });
});

describe("POST /api/v3/webhooks: FEATURE_WEBHOOKS settings wiring", () => {
  /**
   * Settings-wiring regression: FEATURE_WEBHOOKS is a registry-backed
   * deployment-wide kill switch. It used to resolve into a dead
   * FEATURES.WEBHOOKS object nothing ever read, so an admin disabling
   * webhooks in /admin had zero effect. This proves the live (mocked)
   * value actually gates webhook creation.
   */
  it("rejects webhook creation when FEATURE_WEBHOOKS is disabled", async () => {
    mockGetFeatureWebhooks.mockResolvedValue(false);

    const res = await POST(
      postRequest({ url: "https://example.com/hook", type: "auto" }),
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toMatch(/disabled/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("POST /api/v3/webhooks: secret", () => {
  it("generates a 64-hex-char secret, inserts it, and returns it once", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] }); // count
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          url: "https://example.com/hook",
          name: "Default",
          type: "generic",
          active: true,
          created_at: new Date().toISOString(),
          secret: "will-be-overwritten-by-insertParams-check",
        },
      ],
    }); // INSERT

    const res = await POST(
      postRequest({ url: "https://example.com/hook", type: "auto" }),
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(typeof json.secret).toBe("string");

    const insertCall = mockQuery.mock.calls[1];
    expect(insertCall[0]).toContain("INSERT INTO webhooks");
    expect(insertCall[0]).toContain("secret");
    const insertedSecret = insertCall[1][4];
    expect(insertedSecret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates a different secret for every webhook", async () => {
    mockQuery.mockResolvedValue({ rows: [{ count: 0 }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    await POST(postRequest({ url: "https://example.com/hook-a" }));
    const first = mockQuery.mock.calls[1][1][4];

    mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 2 }] });
    await POST(postRequest({ url: "https://example.com/hook-b" }));
    const second = mockQuery.mock.calls[3][1][4];

    expect(first).not.toBe(second);
  });
});

describe("POST /api/v3/webhooks: plan-tier limit", () => {
  it("blocks creation once a Pro Supporter (limit 5) already has 5 webhooks", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 5 }] });

    const res = await POST(postRequest({ url: "https://example.com/hook-6" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("5 Webhooks");
    // Only the count query ran; no INSERT.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("blocks creation on the free plan, which allows 0 webhooks", async () => {
    mockGetUserPlan.mockResolvedValue("free");
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });

    const res = await POST(postRequest({ url: "https://example.com/hook" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/not available on your plan/);
  });

  it("core_supporter (limit 1) can create its first webhook but not a second", async () => {
    mockGetUserPlan.mockResolvedValue("core_supporter");
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          url: "https://example.com/hook",
          name: "Default",
          type: "generic",
          active: true,
          created_at: new Date().toISOString(),
          secret: "x".repeat(64),
        },
      ],
    });

    const res = await POST(postRequest({ url: "https://example.com/hook" }));
    expect(res.status).toBe(201);

    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });
    const res2 = await POST(postRequest({ url: "https://example.com/hook-2" }));
    const json2 = await res2.json();
    expect(res2.status).toBe(400);
    expect(json2.error).toContain("1 Webhooks");
  });

  it("does not cap creation for an unlimited (elite) plan", async () => {
    mockGetUserPlan.mockResolvedValue("elite_supporter");
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 42 }] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 99,
          url: "https://example.com/hook",
          name: "Default",
          type: "generic",
          active: true,
          created_at: new Date().toISOString(),
          secret: "x".repeat(64),
        },
      ],
    });

    const res = await POST(postRequest({ url: "https://example.com/hook" }));
    expect(res.status).toBe(201);
  });

  it("does not cap creation when billing is disabled", async () => {
    mockGetSetting.mockResolvedValue(false);
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 999 }] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 100,
          url: "https://example.com/hook",
          name: "Default",
          type: "generic",
          active: true,
          created_at: new Date().toISOString(),
          secret: "x".repeat(64),
        },
      ],
    });

    const res = await POST(postRequest({ url: "https://example.com/hook" }));
    expect(res.status).toBe(201);
    expect(mockGetUserPlan).not.toHaveBeenCalled();
  });
});
