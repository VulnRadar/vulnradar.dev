import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The plan switch screen is the only thing a subscriber reads before their
 * card is charged, and it used to say the difference was "prorated" without
 * saying when. An upgrade is charged on the spot now (sec-money-1), so the
 * screen has to say so, and has to say a downgrade charges nothing today.
 */
vi.mock("@stripe/stripe-js", () => ({ loadStripe: () => null }));
vi.mock("@/app/actions/stripe", () => ({
  createSubscription: vi.fn(),
  confirmSubscription: vi.fn(),
}));
vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({ isStaff: false }),
}));

const { StripeCheckout } = await import("@/components/billing/stripe-checkout");

describe("the plan switch panel", () => {
  const html = renderToStaticMarkup(
    <StripeCheckout
      productId="elite_supporter_monthly"
      planName="Elite Supporter"
      amountCents={2000}
      hasActiveSubscription
    />,
  );

  it("says an upgrade is charged now, and when the new plan starts", () => {
    expect(html).toContain(
      "A higher plan or a different billing period charges the prorated difference to that card now",
    );
    expect(html).toContain("the new plan starts once the charge goes through");
  });

  it("says a downgrade charges nothing now", () => {
    expect(html).toContain(
      "A lower plan on the same billing period charges nothing now",
    );
  });

  it("no longer promises only a prorated difference with no time attached", () => {
    expect(html).not.toContain("prorates the difference on your existing");
  });
});

describe("an upgrade whose charge did not go through", () => {
  const src = readFileSync(
    path.resolve(__dirname, "../../../components/billing/stripe-checkout.tsx"),
    "utf8",
  );

  it("is handled on both entry points, never sent to the confirm loop", () => {
    // The confirm loop would retry for eight seconds and then claim Stripe had
    // taken a payment it had in fact declined.
    expect(src.match(/kind === "upgrade_unpaid"/g)).toHaveLength(2);
  });
});
