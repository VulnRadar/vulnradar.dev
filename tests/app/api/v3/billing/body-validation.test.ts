/**
 * POST /api/v3/billing and POST /api/v3/billing/verify destructured
 * `await request.json()`, so a `null` body was a TypeError their catch logged
 * as "could not process the billing action" and answered 500. The body is the
 * caller's mistake: 400, nothing at Stripe, nothing logged.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => ({ userId: 42 })),
}));
const subscriptions = { cancel: vi.fn(), update: vi.fn(), list: vi.fn() };
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => ({ subscriptions }),
}));
vi.mock("@/lib/billing/ai-usage", () => ({ checkAiUsageQuota: vi.fn() }));
vi.mock("@/lib/billing/github-review-usage", () => ({
  checkGithubReviewQuota: vi.fn(),
}));
vi.mock("@/lib/admin/alert-webhook", () => ({ sendAdminAlert: vi.fn() }));
const mockLogError = vi.fn();
vi.mock("@/lib/logging/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logging/log")>()),
  logError: (...args: unknown[]) => mockLogError(...args),
}));
vi.mock("@/lib/rate-limiting/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
  RATE_LIMITS: { billingVerify: { maxAttempts: 5, windowMs: 60_000 } },
}));

const billing = await import("@/app/api/v3/billing/route");
const verify = await import("@/app/api/v3/billing/verify/route");
const cancel = await import("@/app/api/v3/billing/subscription/cancel/route");

function raw(body: string) {
  return new NextRequest("http://localhost/api/v3/billing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  mockLogError.mockReset();
  for (const fn of Object.values(subscriptions)) fn.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

const BAD_BODIES: [string, string][] = [
  ["malformed JSON", "{not json"],
  ["a JSON null", "null"],
  ["a JSON array", "[]"],
  ["a JSON string", '"cancel"'],
];

describe("billing bodies that are not a JSON object", () => {
  for (const [label, body] of BAD_BODIES) {
    it(`POST /billing answers 400 for ${label}`, async () => {
      const res = await billing.POST(raw(body));
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
      expect(subscriptions.cancel).not.toHaveBeenCalled();
      expect(subscriptions.update).not.toHaveBeenCalled();
      expect(mockLogError).not.toHaveBeenCalled();
    });

    it(`POST /billing/verify answers 400 for ${label}`, async () => {
      const res = await verify.POST(raw(body));
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it(`POST /billing/subscription/cancel answers 400 for ${label}`, async () => {
      const res = await cancel.POST(raw(body));
      expect(res.status).toBe(400);
      expect(subscriptions.update).not.toHaveBeenCalled();
    });
  }

  it("POST /billing still answers 400 for an action it does not know", async () => {
    const res = await billing.POST(raw('{"action":"refund"}'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid action");
  });
});
