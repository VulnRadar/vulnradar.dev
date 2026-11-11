import { describe, it, expect, vi } from "vitest";
import { APP_URL } from "@/lib/config/constants";

/**
 * The two dunning emails behind the two-strike rule: a renewal that fails once
 * is retried, and one that fails twice cancels the subscription.
 *
 * They are built by the Stripe webhook (app/api/v3/webhooks/stripe/route.ts)
 * and sent through sendEmail directly, so only the builders are exercised
 * here. The transport and the database pool load with lib/email/email.ts and
 * are mocked so nothing reaches either.
 */
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: vi.fn() }) },
}));
vi.mock("@/lib/database/db", () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

const { paymentFailedEmail, planCancelledEmail } =
  await import("@/lib/email/email");

function allParts(t: {
  subject: string;
  preheader: string;
  text: string;
  html: string;
}) {
  return [t.subject, t.preheader, t.text, t.html];
}

describe("paymentFailedEmail: the first failed renewal", () => {
  const email = paymentFailedEmail({
    planName: "Pro Supporter",
    amountCents: 1000,
    currency: "usd",
    nextAttempt: "November 15, 2026",
  });

  it("says the payment failed, when it will be retried, and what happens if that fails too", () => {
    expect(email.text).toContain("$10.00");
    expect(email.text).toContain("November 15, 2026");
    expect(email.text).toMatch(/retry/i);
    // The second failure cancels the subscription, so the email says that
    // rather than a vague "repeated failures".
    expect(email.text).toMatch(/if the retry fails too/i);
    expect(email.text).toContain("free plan");
    expect(email.html).toContain("Update payment method");
    expect(email.html).toContain(`${APP_URL}/profile?tab=billing`);
  });

  it("still says it will be retried when Stripe gave no date", () => {
    const undated = paymentFailedEmail({
      planName: "Pro Supporter",
      amountCents: 1000,
      currency: "usd",
    });
    expect(undated.text).toMatch(/retry/i);
    expect(undated.html).toMatch(/retry/i);
  });
});

describe("planCancelledEmail: the second failed renewal", () => {
  const email = planCancelledEmail({
    planName: "Elite Supporter",
    amountCents: 2500,
    currency: "usd",
  });

  it("says the plan was cancelled because the payment failed twice, and that the account is on free", () => {
    expect(email.template).toBe("planCancelled");
    expect(email.subject).toContain("Elite Supporter");
    expect(email.text).toContain("$25.00");
    expect(email.text).toMatch(/twice/);
    expect(email.text).toContain("free plan");
    expect(email.html).toContain("Elite Supporter");
  });

  it("says how to resubscribe, and that nothing else will be charged", () => {
    expect(email.text).toContain(`${APP_URL}/pricing`);
    expect(email.html).toContain(`${APP_URL}/pricing`);
    expect(email.text).toMatch(/won't be charged again/);
  });

  it("meets the bar every template meets", () => {
    expect(email.text).not.toContain("<");
    expect(email.html).toContain("<h1");
    expect(email.preheader.trim().length).toBeGreaterThan(10);
    expect(email.preheader.toLowerCase()).not.toBe(email.subject.toLowerCase());
    for (const part of allParts(email)) {
      expect(part).not.toMatch(/[–—·]/);
    }
  });

  it("escapes a plan name that carries markup", () => {
    const hostile = planCancelledEmail({
      planName: "<script>alert(1)</script>",
      amountCents: 100,
      currency: "usd",
    });
    expect(hostile.html).not.toContain("<script>alert(1)</script>");
    expect(hostile.html).toContain("&lt;script&gt;");
  });
});
