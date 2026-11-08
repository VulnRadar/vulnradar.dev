/**
 * Route-level tests for POST /api/v3/scan/verify-batch (AI verification of
 * client-supplied findings, not a stored scan). Auth (session or API key) is
 * mocked at the boundary; the pass (verifyFindingsBatchWithOutcome in
 * lib/ai/verify-findings.ts) and its estimate are mocked since the pass is
 * itself an LLM network boundary. isAcceptedBatchElement runs for real: it is
 * the rule for which elements the route refuses.
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
const mockEstimateVerifyTokens = vi.fn();
vi.mock("@/lib/ai/verify-findings", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/ai/verify-findings")>();
  return {
    ...actual,
    verifyFindingsBatchWithOutcome: (...args: unknown[]) =>
      mockVerifyFindingsBatch(...args),
    // The findings-only form, for a route that still calls it.
    verifyFindingsBatch: async (...args: unknown[]) =>
      (await mockVerifyFindingsBatch(...args)).findings,
    estimateVerifyTokens: (...args: unknown[]) =>
      mockEstimateVerifyTokens(...args),
  };
});

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

const mockReserveAiTokens = vi.fn();
vi.mock("@/lib/billing/ai-usage", () => ({
  reserveAiTokens: (...args: unknown[]) => mockReserveAiTokens(...args),
}));

/** What reserveAiTokens hands back for a pass it let in. */
const RESERVATION = {
  userId: 42,
  usingOwnAi: false,
  windowStart: new Date(0),
  budget: 30_000,
  windowPortion: 30_000,
  creditPortion: 0,
  slotKey: "ai-verify:42",
  settled: false,
};

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

/** What the pass hands back: the findings, and whether it got through them. */
function passed(
  out: unknown[],
  outcome: Record<string, unknown> = {
    configured: true,
    verdicts: out.filter((f) => f !== null).length,
    attempted: out.filter((f) => f !== null).length,
  },
) {
  return { findings: out, outcome };
}

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
  mockValidateApiKey.mockReset();
  mockVerifyFindingsBatch.mockReset();
  mockVerifyFindingsBatch.mockImplementation(async (_url, sent: unknown[]) =>
    passed(sent),
  );
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] }); // no ai_disabled row = AI enabled by default
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 19,
    retryAfterSeconds: 0,
  });
  mockEstimateVerifyTokens.mockReset();
  mockEstimateVerifyTokens.mockResolvedValue({
    estimate: 30_000,
    minimum: 15_000,
  });
  mockReserveAiTokens.mockReset();
  mockReserveAiTokens.mockResolvedValue({
    allowed: true,
    reservation: RESERVATION,
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
      RESERVATION,
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

  // The url was only checked for being truthy, so a number or an object was
  // coerced into a probe of "https://123" or "https://[object Object]".
  it.each([123, true, { href: "https://example.com" }, ["https://a.example"]])(
    "rejects a url that is not a string (%j) before reserving anything",
    async (url) => {
      const res = await POST(postRequest({ url, findings }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(
        "url must be an http or https address.",
      );
      expect(mockReserveAiTokens).not.toHaveBeenCalled();
      expect(mockVerifyFindingsBatch).not.toHaveBeenCalled();
    },
  );

  it.each(["https://", "http://exa mple.com", "javascript:alert(1)"])(
    "rejects a url that does not parse as a web address (%s)",
    async (url) => {
      const res = await POST(postRequest({ url, findings }));
      expect(res.status).toBe(400);
      expect(mockVerifyFindingsBatch).not.toHaveBeenCalled();
    },
  );

  // The probe has always prefixed https:// to a bare host, so that stays
  // accepted; only what cannot become a web address is refused.
  it.each(["example.com", "HTTP://example.com/path", "https://example.com"])(
    "still accepts %s",
    async (url) => {
      const res = await POST(postRequest({ url, findings }));
      expect(res.status).toBe(200);
      expect(mockVerifyFindingsBatch).toHaveBeenCalledWith(
        url,
        findings,
        42,
        RESERVATION,
      );
    },
  );
});

describe("POST /api/v3/scan/verify-batch: which findings[] elements are taken", () => {
  // An object whose toString is not a function, as JSON can send it. The
  // prompt builder throws converting it to text, and that answered 500.
  const unconvertible = { toString: 1 };

  it.each(["id", "title", "category", "severity", "evidence"])(
    "refuses a finding whose %s cannot be converted to text, before reserving anything",
    async (field) => {
      const res = await POST(
        postRequest({
          url: "https://example.com",
          findings: [findings[0], { id: "x", [field]: unconvertible }],
        }),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(
        "findings[1] has an id, title, category, severity, evidence or evidenceExcerpts that cannot be converted to text.",
      );
      expect(mockEstimateVerifyTokens).not.toHaveBeenCalled();
      expect(mockReserveAiTokens).not.toHaveBeenCalled();
      expect(mockVerifyFindingsBatch).not.toHaveBeenCalled();
    },
  );

  it.each<[string, unknown]>([
    ["an array holding one", { id: "x", evidence: [unconvertible] }],
    [
      "evidenceExcerpts",
      { id: "x", evidenceExcerpts: { length: unconvertible } },
    ],
  ])("refuses a field the prompt builder cannot read: %s", async (_l, bad) => {
    const res = await POST(
      postRequest({ url: "https://example.com", findings: [bad] }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^findings\[0\] /);
    expect(mockReserveAiTokens).not.toHaveBeenCalled();
  });

  // Everything 3.9.1 answered 200 for stays accepted, and a null element,
  // which 3.9.1 answered with a 500, is carried through as sent.
  it.each<[string, unknown]>([
    ["a numeric id", { id: 7, title: "Missing CSP" }],
    ["a missing id", { title: "no id" }],
    ["an empty id", { id: "" }],
    ["a long id", { id: "x".repeat(201) }],
    ["a string element", "missing-csp"],
    ["a number element", 7],
    ["a boolean element", true],
    ["an array element", ["a"]],
    ["an object field that converts", { id: "x", title: { a: 1 } }],
    ["a null element", null],
  ])("still accepts %s", async (_label, element) => {
    const body = [findings[0], element];
    const res = await POST(
      postRequest({ url: "https://example.com", findings: body }),
    );
    expect(res.status).toBe(200);
    expect(mockEstimateVerifyTokens).toHaveBeenCalledWith(body);
    expect(mockVerifyFindingsBatch).toHaveBeenCalledWith(
      "https://example.com",
      body,
      42,
      RESERVATION,
    );
  });

  it("still accepts a batch whose only element is a primitive", async () => {
    const res = await POST(
      postRequest({ url: "https://example.com", findings: [7] }),
    );
    expect(res.status).toBe(200);
    expect(mockReserveAiTokens).toHaveBeenCalled();
  });
});

describe("POST /api/v3/scan/verify-batch: nothing but null elements", () => {
  // Nothing to ask about: no reservation, so no 429 from the gate, and no
  // pass, so no probe of the target.
  it.each([[[null]], [[null, null]], [[]]])(
    "answers %j as sent without reserving, probing or refusing",
    async (body) => {
      mockReserveAiTokens.mockResolvedValue({
        allowed: false,
        busy: true,
        message: "Another AI verification is still running on your account.",
      });

      const res = await POST(
        postRequest({ url: "https://example.com", findings: body }),
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toStrictEqual({
        findings: body,
        ai: { configured: true, verdicts: 0, attempted: 0 },
      });
      expect(mockReserveAiTokens).not.toHaveBeenCalled();
      expect(mockVerifyFindingsBatch).not.toHaveBeenCalled();
    },
  );
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
      RESERVATION,
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
    mockVerifyFindingsBatch.mockResolvedValue(passed(enriched));

    const res = await POST(
      postRequest({ url: "https://example.com", findings }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.findings).toEqual(enriched);
    expect(json.ai).toStrictEqual({
      configured: true,
      verdicts: 1,
      attempted: 1,
    });
    expect(mockVerifyFindingsBatch).toHaveBeenCalledWith(
      "https://example.com",
      findings,
      42,
      RESERVATION,
    );
  });

  it("accepts an empty findings array and passes it straight through", async () => {
    const res = await POST(
      postRequest({ url: "https://example.com", findings: [] }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.findings).toEqual([]);
  });

  it("says when no AI endpoint is configured, with the findings as sent", async () => {
    mockVerifyFindingsBatch.mockResolvedValue(
      passed(findings, { configured: false, verdicts: 0, attempted: 1 }),
    );

    const res = await POST(
      postRequest({ url: "https://example.com", findings }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ai).toStrictEqual({
      configured: false,
      verdicts: 0,
      attempted: 1,
    });
  });

  it("does not catch a failure from the AI verification call: it propagates uncontrolled", async () => {
    mockVerifyFindingsBatch.mockRejectedValue(new Error("AI provider down"));

    await expect(
      POST(postRequest({ url: "https://example.com", findings })),
    ).rejects.toThrow("AI provider down");
  });
});

describe("POST /api/v3/scan/verify-batch: when the allowance stops the pass", () => {
  const twoFindings = [
    { id: "f1", title: "Missing CSP" },
    { id: "f2", title: "Missing HSTS" },
  ];

  // The gate prices the first finding against an empty page; the probe can
  // make it cost more than the account has. 3.9.1 answered an account out of
  // allowance with a 429, and a 200 with nothing verified left the caller
  // unable to tell why.
  it("answers 429 as 3.9.1 did when the allowance stopped the pass before anything was verified", async () => {
    mockVerifyFindingsBatch.mockResolvedValue(
      passed(twoFindings, {
        configured: true,
        verdicts: 0,
        attempted: 2,
        budgetExhausted: true,
      }),
    );

    const res = await POST(
      postRequest({ url: "https://example.com", findings: twoFindings }),
    );

    expect(res.status).toBe(429);
    // The 3.9.1 body: the error and nothing else, and no Retry-After.
    expect(await res.json()).toStrictEqual({
      error:
        "Your AI allowance ran out before any finding on this page could be verified. Upgrade your plan, wait for the window to reset, connect your own AI provider key in Profile > AI settings, or buy AI credits in Profile > Billing.",
    });
    expect(res.headers.get("Retry-After")).toBeNull();
  });

  it("answers the gate's own refusal with a 429 and no Retry-After, as 3.9.1 did", async () => {
    mockReserveAiTokens.mockResolvedValue({
      allowed: false,
      busy: false,
      message: "This needs up to 15,000 AI tokens and your account has 1 left.",
    });

    const res = await POST(
      postRequest({ url: "https://example.com", findings: twoFindings }),
    );

    expect(res.status).toBe(429);
    expect(await res.json()).toStrictEqual({
      error: "This needs up to 15,000 AI tokens and your account has 1 left.",
    });
    expect(res.headers.get("Retry-After")).toBeNull();
    expect(mockVerifyFindingsBatch).not.toHaveBeenCalled();
  });

  it("answers 200 with an ai field saying what was left when the pass stopped partway", async () => {
    const out = [{ ...twoFindings[0], aiVerdict: "confirmed" }, twoFindings[1]];
    mockVerifyFindingsBatch.mockResolvedValue(
      passed(out, {
        configured: true,
        verdicts: 1,
        attempted: 2,
        budgetExhausted: true,
      }),
    );

    const res = await POST(
      postRequest({ url: "https://example.com", findings: twoFindings }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({
      findings: out,
      ai: {
        configured: true,
        verdicts: 1,
        attempted: 2,
        budgetExhausted: true,
      },
    });
  });

  // Only the allowance answers 429. A provider that was down or rate limited
  // the pass is not the account's allowance, and 3.9.1 answered 200 for it.
  it.each<[string, Record<string, unknown>]>([
    ["the provider failed every call", { verdicts: 0, attempted: 2 }],
    [
      "the provider rate-limited the pass",
      { verdicts: 0, attempted: 2, rateLimited: true },
    ],
  ])("answers 200 with the ai field when %s", async (_label, counts) => {
    const outcome = { configured: true, ...counts };
    mockVerifyFindingsBatch.mockResolvedValue(passed(twoFindings, outcome));

    const res = await POST(
      postRequest({ url: "https://example.com", findings: twoFindings }),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).ai).toStrictEqual(outcome);
  });
});

describe("POST /api/v3/scan/verify-batch: the AI credit reservation", () => {
  it("returns 429 with the gate's message and never calls verifyFindingsBatch when the account cannot cover one finding", async () => {
    mockReserveAiTokens.mockResolvedValue({
      allowed: false,
      busy: false,
      message:
        "This needs up to 15,000 AI tokens and your account has 1 left: 0 in this 5-hour window and 1 in AI credits.",
    });

    const res = await POST(
      postRequest({ url: "https://example.com", findings }),
    );
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toMatch(/needs up to 15,000 AI tokens/);
    expect(mockVerifyFindingsBatch).not.toHaveBeenCalled();
  });

  it("reserves the caller-supplied batch's estimate before verifying it", async () => {
    const res = await POST(
      postRequest({ url: "https://example.com", findings }),
    );

    expect(res.status).toBe(200);
    expect(mockEstimateVerifyTokens).toHaveBeenCalledWith(findings);
    expect(mockReserveAiTokens).toHaveBeenCalledWith(42, 30_000, 15_000);
    expect(mockReserveAiTokens.mock.invocationCallOrder[0]).toBeLessThan(
      mockVerifyFindingsBatch.mock.invocationCallOrder[0],
    );
  });

  it("hands the reservation to verifyFindingsBatch, which holds the pass to it and settles it", async () => {
    const ownKey = { ...RESERVATION, usingOwnAi: true, budget: null };
    mockReserveAiTokens.mockResolvedValue({
      allowed: true,
      reservation: ownKey,
    });

    const res = await POST(
      postRequest({ url: "https://example.com", findings }),
    );
    expect(res.status).toBe(200);
    expect(mockVerifyFindingsBatch).toHaveBeenCalledWith(
      "https://example.com",
      findings,
      42,
      ownKey,
    );
  });

  it("does not reserve for a batch over the findings cap", async () => {
    const res = await POST(
      postRequest({
        url: "https://example.com",
        findings: Array.from({ length: MAX_FINDINGS + 1 }, (_, i) => ({
          id: `f${i}`,
        })),
      }),
    );
    expect(res.status).toBe(400);
    expect(mockReserveAiTokens).not.toHaveBeenCalled();
  });
});
