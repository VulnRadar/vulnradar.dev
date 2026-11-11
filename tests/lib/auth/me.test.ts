import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * lib/auth/me.ts, the Bearer half's protections: GET /auth/me is the one
 * key-authenticated endpoint that is not metered, and its quota block costs a
 * COUNT(*) over the key's last day of api_usage. So the block is cached per
 * key for 30 seconds and the endpoint is limited per key.
 *
 * The route-level behaviour of both halves is in
 * tests/app/api/v3/auth/me/route.test.ts.
 */

const mockQuery = vi.fn(async () => ({ rows: [] as unknown[] }));
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...(args as [])) },
}));

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => null) }));

const mockValidateApiKey = vi.fn();
vi.mock("@/lib/api/api-keys", () => ({
  validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limiting/rate-limit")>()),
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockBuildQuotaBlock = vi.fn();
vi.mock("@/lib/api/quota", () => ({
  buildQuotaBlock: (...args: unknown[]) => mockBuildQuotaBlock(...args),
}));

vi.mock("@/lib/billing/plan-limits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/billing/plan-limits")>()),
  getPlanLimitsForPlan: vi.fn(async () => null),
}));

const { meForApiKey, meForSession } = await import("@/lib/auth/me");

function quota(used: number) {
  return {
    scans: { limit: 25, used, remaining: 25 - used, resetsAt: "x" },
    requests: { limit: 100, used, remaining: 100 - used, resetsAt: "y" },
  };
}

let nextKeyId = 1;
function key(overrides: Record<string, unknown> = {}) {
  return {
    keyId: nextKeyId++,
    keyName: "laptop",
    userId: 3,
    email: "k@example.com",
    userName: "K",
    dailyLimit: 100,
    scopes: ["scan:read"],
    needsTermsAcceptance: false,
    ...overrides,
  };
}

function bearer() {
  return new Request("http://localhost/api/v3/auth/me", {
    headers: { authorization: "Bearer vr_live_x" },
  });
}

async function quotaUsed(): Promise<number> {
  const res = await meForApiKey(bearer());
  expect(res.status).toBe(200);
  return (await res.json()).quota.scans.used;
}

beforeEach(() => {
  mockQuery.mockClear();
  mockValidateApiKey.mockReset();
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 59,
    retryAfterSeconds: 0,
  });
  mockBuildQuotaBlock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("meForApiKey: the per-key quota cache", () => {
  it("reads the quota once per key within 30 seconds, and again after", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    mockValidateApiKey.mockResolvedValue(key());
    mockBuildQuotaBlock
      .mockResolvedValueOnce(quota(1))
      .mockResolvedValueOnce(quota(2));

    expect(await quotaUsed()).toBe(1);
    vi.setSystemTime(new Date("2026-01-01T00:00:29Z"));
    expect(await quotaUsed()).toBe(1);
    expect(mockBuildQuotaBlock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-01-01T00:00:31Z"));
    expect(await quotaUsed()).toBe(2);
    expect(mockBuildQuotaBlock).toHaveBeenCalledTimes(2);
  });

  it("keeps each key's figures apart", async () => {
    const a = key();
    const b = key();
    mockBuildQuotaBlock.mockImplementation(
      async (_userId: number, k: { keyId: number }) => quota(k.keyId % 20),
    );

    mockValidateApiKey.mockResolvedValue(a);
    expect(await quotaUsed()).toBe(a.keyId % 20);
    mockValidateApiKey.mockResolvedValue(b);
    expect(await quotaUsed()).toBe(b.keyId % 20);
    expect(mockBuildQuotaBlock).toHaveBeenCalledTimes(2);
  });

  it("shares one read between concurrent checks from the same key", async () => {
    mockValidateApiKey.mockResolvedValue(key());
    let release: (v: unknown) => void = () => {};
    mockBuildQuotaBlock.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const pending = [meForApiKey(bearer()), meForApiKey(bearer())];
    await vi.waitFor(() => expect(mockBuildQuotaBlock).toHaveBeenCalled());
    release(quota(4));
    const answers = await Promise.all(pending);

    expect(mockBuildQuotaBlock).toHaveBeenCalledTimes(1);
    for (const res of answers) {
      expect((await res.json()).quota.scans.used).toBe(4);
    }
  });

  it("does not keep a failed read for the next caller", async () => {
    mockValidateApiKey.mockResolvedValue(key());
    mockBuildQuotaBlock
      .mockRejectedValueOnce(new Error("pool exhausted"))
      .mockResolvedValueOnce(quota(5));

    await expect(meForApiKey(bearer())).rejects.toThrow("pool exhausted");
    expect(await quotaUsed()).toBe(5);
    expect(mockBuildQuotaBlock).toHaveBeenCalledTimes(2);
  });

  it("stays bounded: a flood of distinct keys evicts the oldest entry", async () => {
    mockBuildQuotaBlock.mockResolvedValue(quota(0));
    const first = key();
    mockValidateApiKey.mockResolvedValue(first);
    await quotaUsed();

    for (let i = 0; i < 1_000; i++) {
      mockValidateApiKey.mockResolvedValue(key());
      await meForApiKey(bearer());
    }
    const reads = mockBuildQuotaBlock.mock.calls.length;

    mockValidateApiKey.mockResolvedValue(first);
    await quotaUsed();
    expect(mockBuildQuotaBlock.mock.calls.length).toBe(reads + 1);
  });
});

describe("meForApiKey: the auth-me limiter", () => {
  it("is keyed per API key and checked before any read", async () => {
    const k = key();
    mockValidateApiKey.mockResolvedValue(k);
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 17,
    });

    const res = await meForApiKey(bearer());

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("17");
    const body = await res.json();
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.error).toContain("17 second(s)");
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ key: `auth-me:${k.keyId}`, limit: "authMe" }),
    );
    expect(mockBuildQuotaBlock).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("is not reached by a key that fails authentication", async () => {
    mockValidateApiKey.mockResolvedValue(null);
    const res = await meForApiKey(bearer());
    expect(res.status).toBe(401);
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });
});

describe("meForSession", () => {
  // The internal route mounts it alone, so a stray Bearer header from an
  // extension must not be able to change which account it describes.
  it("takes no request, so it cannot read the Authorization header", () => {
    expect(meForSession.length).toBe(0);
  });

  it("answers 401 without a session", async () => {
    const res = await meForSession();
    expect(res.status).toBe(401);
    expect(mockValidateApiKey).not.toHaveBeenCalled();
  });
});
