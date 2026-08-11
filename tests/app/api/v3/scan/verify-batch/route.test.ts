/**
 * Route-level tests for POST /api/v3/scan/verify-batch (AI verification of
 * client-supplied findings, not a stored scan). Auth (session or API key) is
 * mocked at the boundary; verifyFindingsBatch (lib/ai/verify-findings.ts) is
 * mocked outright since it is itself an LLM network boundary.
 *
 * Unlike verify/route.ts, this route never reads scan_history: the caller
 * supplies url + findings[] directly in the body, so there is no scan
 * ownership check to make (there's no scanId to own): userId is only used
 * to pick the caller's own AI provider config (BYOK), gate on ai_disabled,
 * and key the shared rate limit.
 *
 * checkRateLimit is mocked at its module boundary (same reasoning as
 * tests/app/api/v3/scan/verify/route.test.ts), and lib/config/runtime-config
 * is mocked to resolve every setting to its registry default (same pattern
 * tests/app/api/v3/scan/bulk/route.test.ts uses for MAX_URLS_BULK) so the
 * findings-cap tests don't depend on a live DB-backed settings resolver.
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

const mockValidateApiKey = vi.fn();
vi.mock("@/lib/api/api-keys", () => ({
  validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args),
}));

const mockVerifyFindingsBatch = vi.fn();
vi.mock("@/lib/ai/verify-findings", () => ({
  verifyFindingsBatch: (...args: unknown[]) => mockVerifyFindingsBatch(...args),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/rate-limiting/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  };
});

vi.mock("@/lib/config/runtime-config", async () => {
  const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");
  return {
    getSetting: vi.fn(
      async (key: keyof typeof SETTINGS_REGISTRY) =>
        SETTINGS_REGISTRY[key].default,
    ),
    getSettings: vi.fn(async (keys: (keyof typeof SETTINGS_REGISTRY)[]) =>
      Object.fromEntries(keys.map((k) => [k, SETTINGS_REGISTRY[k].default])),
    ),
  };
});

const mockCheckAiUsageQuota = vi.fn();
vi.mock("@/lib/billing/ai-usage", () => ({
  checkAiUsageQuota: (...args: unknown[]) => mockCheckAiUsageQuota(...args),
}));

const { POST } = await import("@/app/api/v3/scan/verify-batch/route");
const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");

const MAX_FINDINGS = SETTINGS_REGISTRY.AI_VERIFY_BATCH_MAX_FINDINGS
  .default as number;

function postRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v3/scan/verify-batch", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const findings = [{ id: "f1", title: "Missing CSP" }];

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
  mockValidateApiKey.mockReset();
  mockVerifyFindingsBatch.mockReset();
  mockVerifyFindingsBatch.mockResolvedValue(findings);
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] }); // no ai_disabled row = AI enabled by default
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 19,
    retryAfterSeconds: 0,
  });
  mockCheckAiUsageQuota.mockReset();
  mockCheckAiUsageQuota.mockResolvedValue({
    allowed: true,
    usingOwnAi: false,
    usedTokens: 0,
    limitTokens: 20_000,
  });
});

describe("POST /api/v3/scan/verify-batch: auth", () => {
  it("requires session or API key authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(
      postRequest({ url: "https://example.com", findings }),
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Authentication required.");
    expect(mockVerifyFindingsBatch).not.toHaveBeenCalled();
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });

  it("rejects an invalid API key", async () => {
    mockGetSession.mockResolvedValue(null);
    mockValidateApiKey.mockResolvedValue(null);

    const res = await POST(
      postRequest(
        { url: "https://example.com", findings },
        { Authorization: "Bearer vr_live_bad" },
      ),
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Invalid API key.");
  });

  it("authenticates via a valid API key and uses its userId", async () => {
    mockGetSession.mockResolvedValue(null);
    mockValidateApiKey.mockResolvedValue({ userId: 77 });

    const res = await POST(
      postRequest(
        { url: "https://example.com", findings },
        { Authorization: "Bearer vr_live_good" },
      ),
    );
    expect(res.status).toBe(200);
    expect(mockVerifyFindingsBatch).toHaveBeenCalledWith(
      "https://example.com",
      findings,
      77,
      false,
    );
    // The shared aiVerify bucket is keyed the same way regardless of auth
    // method: an API-key caller and a session caller with the same userId
    // draw from the same quota.
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ key: "ai-verify:77" }),
    );
  });
});

describe("POST /api/v3/scan/verify-batch: rate limiting", () => {
  it("rate limits per-user (shared bucket with /api/v3/scan/verify) before touching the request body", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 90,
    });

    const res = await POST(
      postRequest({ url: "https://example.com", findings }),
    );
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain("Too many AI verification requests");
    expect(json.error).toContain("2 minute(s)");
    expect(mockVerifyFindingsBatch).not.toHaveBeenCalled();

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ key: "ai-verify:42" }),
    );
  });

  it("applies the same rate limit to an API-key caller, not just session auth", async () => {
    mockGetSession.mockResolvedValue(null);
    mockValidateApiKey.mockResolvedValue({ userId: 5 });
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 30,
    });

    const res = await POST(
      postRequest(
        { url: "https://example.com", findings },
        { Authorization: "Bearer vr_live_good" },
      ),
    );
    expect(res.status).toBe(429);
    expect(mockVerifyFindingsBatch).not.toHaveBeenCalled();
  });
});

describe("POST /api/v3/scan/verify-batch: AI-disabled setting", () => {
  it("returns 403 without calling verifyFindingsBatch when AI is disabled for the user", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ai_disabled: true }] });

    const res = await POST(
      postRequest({ url: "https://example.com", findings }),
    );
    expect(res.status).toBe(403);
    expect(mockVerifyFindingsBatch).not.toHaveBeenCalled();
  });

  it("treats a missing config row as AI enabled by default", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await POST(
      postRequest({ url: "https://example.com", findings }),
    );
    expect(res.status).toBe(200);
  });

  it("treats a failure reading the AI config as AI enabled by default", async () => {
    mockQuery.mockRejectedValueOnce(new Error("config query failed"));

    const res = await POST(
      postRequest({ url: "https://example.com", findings }),
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /api/v3/scan/verify-batch: request validation", () => {
  it("rejects invalid JSON", async () => {
    const req = new NextRequest("http://localhost/api/v3/scan/verify-batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects a missing url", async () => {
    const res = await POST(postRequest({ findings }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("url and findings[] are required.");
    expect(mockVerifyFindingsBatch).not.toHaveBeenCalled();
  });

  it("rejects findings that are not an array", async () => {
    const res = await POST(
      postRequest({ url: "https://example.com", findings: "nope" }),
    );
    expect(res.status).toBe(400);
    expect(mockVerifyFindingsBatch).not.toHaveBeenCalled();
  });
});

describe("POST /api/v3/scan/verify-batch: findings cap", () => {
  it("accepts a findings array exactly at the cap", async () => {
    const maxed = Array.from({ length: MAX_FINDINGS }, (_, i) => ({
      id: `f${i}`,
      title: "Missing CSP",
    }));

    const res = await POST(
      postRequest({ url: "https://example.com", findings: maxed }),
    );
    expect(res.status).toBe(200);
    expect(mockVerifyFindingsBatch).toHaveBeenCalledWith(
      "https://example.com",
      maxed,
      42,
      false,
    );
  });

  it("rejects a findings array over the cap without calling verifyFindingsBatch", async () => {
    const tooMany = Array.from({ length: MAX_FINDINGS + 1 }, (_, i) => ({
      id: `f${i}`,
      title: "Missing CSP",
    }));

    const res = await POST(
      postRequest({ url: "https://example.com", findings: tooMany }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain(String(MAX_FINDINGS));
    expect(mockVerifyFindingsBatch).not.toHaveBeenCalled();
  });
});

describe("POST /api/v3/scan/verify-batch: happy path", () => {
  it("returns the AI-enriched findings for a session-authenticated caller", async () => {
    const enriched = [{ ...findings[0], aiVerdict: "confirmed" }];
    mockVerifyFindingsBatch.mockResolvedValue(enriched);

    const res = await POST(
      postRequest({ url: "https://example.com", findings }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.findings).toEqual(enriched);
    expect(mockVerifyFindingsBatch).toHaveBeenCalledWith(
      "https://example.com",
      findings,
      42,
      false,
    );
  });

  it("accepts an empty findings array and passes it straight through", async () => {
    mockVerifyFindingsBatch.mockResolvedValue([]);
    const res = await POST(
      postRequest({ url: "https://example.com", findings: [] }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.findings).toEqual([]);
  });

  it("does not catch a failure from the AI verification call: it propagates uncontrolled", async () => {
    mockVerifyFindingsBatch.mockRejectedValue(new Error("AI provider down"));

    await expect(
      POST(postRequest({ url: "https://example.com", findings })),
    ).rejects.toThrow("AI provider down");
  });
});

describe("POST /api/v3/scan/verify-batch: unified AI usage quota", () => {
  it("returns 429 with the quota message and never calls verifyFindingsBatch when the quota is exceeded", async () => {
    mockCheckAiUsageQuota.mockResolvedValue({
      allowed: false,
      usingOwnAi: false,
      usedTokens: 20_000,
      limitTokens: 20_000,
      message: "You've used all your AI tokens for this window.",
    });

    const res = await POST(
      postRequest({ url: "https://example.com", findings }),
    );
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toBe("You've used all your AI tokens for this window.");
    expect(mockVerifyFindingsBatch).not.toHaveBeenCalled();
    expect(mockCheckAiUsageQuota).toHaveBeenCalledWith(42);
  });

  it("passes quota.usingOwnAi through to verifyFindingsBatch", async () => {
    mockCheckAiUsageQuota.mockResolvedValue({
      allowed: true,
      usingOwnAi: true,
      usedTokens: 0,
      limitTokens: -1,
    });

    const res = await POST(
      postRequest({ url: "https://example.com", findings }),
    );
    expect(res.status).toBe(200);
    expect(mockVerifyFindingsBatch).toHaveBeenCalledWith(
      "https://example.com",
      findings,
      42,
      true,
    );
  });
});
