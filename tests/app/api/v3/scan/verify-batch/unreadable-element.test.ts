/**
 * POST /api/v3/scan/verify-batch with a finding the prompt builder cannot
 * turn into text, run through the real pricing and the real pass. 3.9.1
 * answered 200 and handed such a finding back unverified, so v3 keeps that
 * answer: the element is not priced, not sent to the model, and comes back
 * as it was sent while the rest of the batch is verified.
 *
 * Only the boundaries are faked: auth, the rate limiter, the settings
 * resolver, the reservation, the probe's fetch of the target and the AI
 * provider's fetch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

vi.mock("@/lib/auth", () => ({
  getSession: async () => ({ userId: 42 }),
}));

vi.mock("@/lib/rate-limiting/rate-limit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/rate-limiting/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: async () => ({
      allowed: true,
      remaining: 19,
      retryAfterSeconds: 0,
    }),
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
const mockSettleAiTokens = vi.fn();
vi.mock("@/lib/billing/ai-usage", () => ({
  reserveAiTokens: (...args: unknown[]) => mockReserveAiTokens(...args),
  settleAiTokens: (...args: unknown[]) => mockSettleAiTokens(...args),
}));

vi.mock("@/lib/scanner/safe-fetch", () => ({
  safeFetch: async () => ({
    status: 200,
    url: "https://example.com/",
    headers: new Headers(),
    text: async () => "<html></html>",
  }),
}));

const { POST } = await import("@/app/api/v3/scan/verify-batch/route");
const { estimateVerifyTokens } = await import("@/lib/ai/verify-findings");

const RESERVATION = {
  userId: 42,
  usingOwnAi: false,
  windowStart: new Date(0),
  budget: null,
  windowPortion: 0,
  creditPortion: 0,
  slotKey: null,
  settled: false,
};

function finding(id: string) {
  return {
    id,
    title: `Finding ${id}`,
    severity: "medium",
    category: "headers",
    evidence: "some evidence",
  };
}

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/v3/scan/verify-batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const originalFetch = global.fetch;
const originalEnv = { ...process.env };
const prompts: string[] = [];

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  mockReserveAiTokens.mockReset();
  mockReserveAiTokens.mockResolvedValue({
    allowed: true,
    reservation: RESERVATION,
  });
  mockSettleAiTokens.mockReset();
  prompts.length = 0;

  process.env.AI_BASE_URL = "https://api.example-llm.test/v1";
  process.env.AI_API_KEY = "test-key";
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;

  global.fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    prompts.push(body.messages[1].content);
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: "confirmed",
                confidence: 90,
                reason: "Header missing on the live response.",
              }),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }),
    };
  }) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe("POST /api/v3/scan/verify-batch: a finding that cannot be converted to text", () => {
  it.each(["id", "title", "category", "severity", "evidence"])(
    "answers 200 with a %s that cannot be converted: that finding unverified, the others verified",
    async (field) => {
      const unreadable = { ...finding("f9"), [field]: { toString: 1 } };
      const sent = [finding("f1"), unreadable, finding("f2")];

      const res = await POST(
        postRequest({ url: "https://example.com", findings: sent }),
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.findings).toHaveLength(3);
      expect(json.findings[0]).toMatchObject({
        id: "f1",
        aiVerdict: "confirmed",
      });
      expect(json.findings[1]).toStrictEqual(unreadable);
      expect(json.findings[2]).toMatchObject({
        id: "f2",
        aiVerdict: "confirmed",
      });
      expect(json.ai).toStrictEqual({
        configured: true,
        verdicts: 2,
        attempted: 2,
      });
      // Never sent to the model: two calls, for f1 and f2 only.
      expect(prompts).toHaveLength(2);
      expect(prompts.some((p) => p.includes("finding_id: f9"))).toBe(false);
    },
  );

  it("does not price it: the reservation asked for is that of the readable findings alone", async () => {
    const unreadable = {
      ...finding("f9"),
      evidenceExcerpts: { length: { toString: 1 } },
    };
    const readable = [finding("f1"), finding("f2")];
    const { estimate, minimum } = await estimateVerifyTokens(readable as never);

    const res = await POST(
      postRequest({
        url: "https://example.com",
        findings: [unreadable, ...readable],
      }),
    );

    expect(res.status).toBe(200);
    expect(mockReserveAiTokens).toHaveBeenCalledWith(42, estimate, minimum);
  });

  it("keeps the verdict of a finding that shares its id off the skipped one", async () => {
    const unreadable = { ...finding("f1"), title: { toString: 1 } };

    const res = await POST(
      postRequest({
        url: "https://example.com",
        findings: [finding("f1"), unreadable],
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.findings[0]).toMatchObject({ aiVerdict: "confirmed" });
    expect(json.findings[1]).not.toHaveProperty("aiVerdict");
    expect(json.ai).toStrictEqual({
      configured: true,
      verdicts: 1,
      attempted: 1,
    });
  });
});
