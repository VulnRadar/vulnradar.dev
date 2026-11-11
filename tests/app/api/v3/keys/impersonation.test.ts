/**
 * An API key is a credential that outlives the session that minted it: a
 * staff member impersonating a customer could create one, walk away with it,
 * and keep using the customer's account after the impersonation ended, or
 * revoke, rotate and unbind the keys the customer's integrations depend on.
 * Each of the four key routes refuses an impersonation session before it
 * reaches the function that writes the key, and still serves the account
 * holder's own session.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockGenerateApiKey = vi.fn();
const mockRotateApiKey = vi.fn();
const mockRevokeApiKey = vi.fn();
const mockResetApiKeyBinding = vi.fn();
const mockGetUserApiKeys = vi.fn();
vi.mock("@/lib/api/api-keys", () => ({
  UNLIMITED_API_KEY_DAILY_LIMIT: 2147483647,
  generateApiKey: (...a: unknown[]) => mockGenerateApiKey(...a),
  rotateApiKey: (...a: unknown[]) => mockRotateApiKey(...a),
  revokeApiKey: (...a: unknown[]) => mockRevokeApiKey(...a),
  resetApiKeyBinding: (...a: unknown[]) => mockResetApiKeyBinding(...a),
  getUserApiKeys: (...a: unknown[]) => mockGetUserApiKeys(...a),
}));

vi.mock("@/lib/database/db", () => ({
  default: { query: vi.fn(async () => ({ rows: [{ name: "ci" }] })) },
}));
vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
  getUserAgent: vi.fn(async () => "vitest"),
}));
vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: vi.fn(async () => undefined),
}));
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: vi.fn(async () => true),
  getSettings: vi.fn(async () => ({})),
}));
vi.mock("@/lib/rate-limiting/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
  RATE_LIMITS: { login: { maxAttempts: 5, windowMs: 900_000 } },
}));
vi.mock("@/lib/billing/plan-limits", () => ({
  getUserPlanLimits: vi.fn(async () => null),
  withinPlanLimit: () => true,
  planLimitMessage: () => "limit",
}));

const keysRoute = await import("@/app/api/v3/keys/route");
const rotateRoute = await import("@/app/api/v3/keys/[id]/rotate/route");
const revokeRoute = await import("@/app/api/v3/keys/[id]/revoke/route");
const resetRoute = await import("@/app/api/v3/keys/[id]/reset-binding/route");

const OWN = { userId: 5, email: "owner@example.com" };
const IMPERSONATED = { ...OWN, impersonatedBy: 9 };

function post(path: string, body?: unknown) {
  return new NextRequest(`http://localhost/api/v3/keys${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const LIVE_KEY = {
  id: 3,
  name: "ci",
  key_prefix: "vr_abc",
  revoked_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserApiKeys.mockResolvedValue([LIVE_KEY]);
  mockGenerateApiKey.mockResolvedValue({ ...LIVE_KEY, raw_key: "vr_x" });
  mockRotateApiKey.mockResolvedValue({ ...LIVE_KEY, raw_key: "vr_y" });
  mockRevokeApiKey.mockResolvedValue(true);
  mockResetApiKeyBinding.mockResolvedValue(true);
});

const cases = [
  {
    name: "POST /keys (create)",
    run: () => keysRoute.POST(post("", { name: "ci" })),
    writer: mockGenerateApiKey,
  },
  {
    name: "POST /keys/[id]/rotate",
    run: () => rotateRoute.POST(post("/3/rotate"), params("3")),
    writer: mockRotateApiKey,
  },
  {
    name: "POST /keys/[id]/revoke",
    run: () => revokeRoute.POST(post("/3/revoke"), params("3")),
    writer: mockRevokeApiKey,
  },
  {
    name: "POST /keys/[id]/reset-binding",
    run: () => resetRoute.POST(post("/3/reset-binding"), params("3")),
    writer: mockResetApiKeyBinding,
  },
];

describe("API key routes during an impersonation", () => {
  for (const c of cases) {
    it(`${c.name} answers 403 and writes no key`, async () => {
      mockGetSession.mockResolvedValue(IMPERSONATED);
      const res = await c.run();
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.impersonationBlocked).toBe(true);
      expect(body.error).toMatch(/admin/i);
      expect(c.writer).not.toHaveBeenCalled();
    });

    it(`${c.name} still works for the account holder`, async () => {
      mockGetSession.mockResolvedValue(OWN);
      const res = await c.run();
      expect(res.status).toBeLessThan(300);
      expect(c.writer).toHaveBeenCalledTimes(1);
    });
  }
});
