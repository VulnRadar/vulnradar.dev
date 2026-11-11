/**
 * Ending a customer's subscription on the spot cannot be undone from their
 * side: the paid period they already bought is gone and a new purchase is
 * the only way back. That is not a step a staff member reproducing a bug
 * through an impersonation session gets to take on the customer's behalf.
 * A cancellation at the period end stays allowed, because the customer can
 * reactivate it themselves.
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

const mockGetStripe = vi.fn();
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => mockGetStripe(),
}));
vi.mock("@/lib/billing/ai-usage", () => ({ checkAiUsageQuota: vi.fn() }));
vi.mock("@/lib/billing/github-review-usage", () => ({
  checkGithubReviewQuota: vi.fn(),
}));
vi.mock("@/lib/admin/alert-webhook", () => ({ sendAdminAlert: vi.fn() }));

const billing = await import("@/app/api/v3/billing/route");
const cancelRoute =
  await import("@/app/api/v3/billing/subscription/cancel/route");

const OWN = { userId: 42 };
const IMPERSONATED = { userId: 42, impersonatedBy: 7 };

const subscriptions = {
  cancel: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
};

function request(path: string, body: unknown) {
  return new NextRequest(`http://localhost/api/v3/billing${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({
    rows: [{ stripe_subscription_id: "sub_1", plan: "pro_supporter" }],
  });
  subscriptions.cancel.mockReset().mockResolvedValue({});
  subscriptions.update.mockReset().mockResolvedValue({ cancel_at: null });
  subscriptions.list.mockReset().mockResolvedValue({ data: [] });
  mockGetStripe.mockReturnValue({ subscriptions });
});

describe("immediate cancellation during an impersonation", () => {
  it("POST /billing cancel_immediately answers 403 and Stripe hears nothing", async () => {
    mockGetSession.mockResolvedValue(IMPERSONATED);
    const res = await billing.POST(
      request("", { action: "cancel_immediately" }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).impersonationBlocked).toBe(true);
    expect(subscriptions.cancel).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("POST /billing/subscription/cancel with immediate answers 403", async () => {
    mockGetSession.mockResolvedValue(IMPERSONATED);
    const res = await cancelRoute.POST(
      request("/subscription/cancel", { immediate: true }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).impersonationBlocked).toBe(true);
    expect(subscriptions.update).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("still lets the impersonation cancel at the period end, which the customer can undo", async () => {
    mockGetSession.mockResolvedValue(IMPERSONATED);
    const viaBilling = await billing.POST(request("", { action: "cancel" }));
    expect(viaBilling.status).toBe(200);
    const viaCancel = await cancelRoute.POST(
      request("/subscription/cancel", { immediate: false }),
    );
    expect(viaCancel.status).toBe(200);
    expect(subscriptions.update).toHaveBeenCalledWith("sub_1", {
      cancel_at_period_end: true,
    });
  });

  it("still cancels immediately for the account holder", async () => {
    mockGetSession.mockResolvedValue(OWN);
    const res = await billing.POST(
      request("", { action: "cancel_immediately" }),
    );
    expect(res.status).toBe(200);
    expect(subscriptions.cancel).toHaveBeenCalledWith("sub_1");

    const viaCancel = await cancelRoute.POST(
      request("/subscription/cancel", { immediate: true }),
    );
    expect(viaCancel.status).toBe(200);
    expect(subscriptions.update).toHaveBeenCalledWith("sub_1", {
      cancel_at: expect.any(Number),
    });
  });
});
