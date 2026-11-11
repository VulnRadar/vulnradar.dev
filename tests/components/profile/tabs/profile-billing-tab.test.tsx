import type { ComponentProps } from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BillingInfo } from "@/components/profile/types";

vi.mock("@/app/actions/stripe", () => ({
  createBillingPortalSession: vi.fn(),
}));
vi.mock("@/components/providers/auth-provider", () => ({
  refreshAuthCache: vi.fn(),
}));

const { ProfileBillingTab } =
  await import("@/components/profile/tabs/profile-billing-tab");

type Props = ComponentProps<typeof ProfileBillingTab>;

const subscription: NonNullable<BillingInfo["subscription"]> = {
  id: "sub_paid",
  status: "active",
  currentPeriodStart: "2026-11-01T00:00:00.000Z",
  currentPeriodEnd: "2026-12-01T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  cancelAt: null,
  priceAmount: 5,
  priceCurrency: "usd",
  priceInterval: "month",
  priceIntervalCount: 1,
  cardBrand: null,
  cardLast4: null,
  cardExpMonth: null,
  cardExpYear: null,
  lastPaymentAmount: null,
  lastPaymentStatus: null,
  lastPaymentDate: null,
  nextBillingDate: "2026-12-01T00:00:00.000Z",
};

function billingInfo(over: Partial<BillingInfo> = {}): BillingInfo {
  return {
    billingEnabled: true,
    plan: "core_supporter",
    subscriptionStatus: "active",
    stripeCustomerId: "cus_1",
    subscription,
    giftedSubscription: null,
    usage: {
      used: 4,
      limit: 25,
      remaining: 21,
      resetsAt: "2026-11-12T00:00:00.000Z",
      unlimited: false,
    },
    limits: {
      free: 5,
      core_supporter: 25,
      pro_supporter: 100,
      elite_supporter: -1,
    },
    aiUsage: {
      used: 100,
      limit: 1000,
      resetsAt: "2026-11-11T05:00:00.000Z",
      windowHours: 5,
      unlimited: false,
      usingOwnAi: false,
      creditBalance: 0,
    },
    githubReviewUsage: {
      used: 10,
      limit: 100,
      resetsAt: "2026-11-11T05:00:00.000Z",
      windowHours: 5,
      unlimited: false,
      usingOwnAi: false,
      creditBalance: 0,
    },
    browserbaseUsage: {
      usedSeconds: 60,
      limitMinutes: 30,
      resetsAt: "2026-12-01T00:00:00.000Z",
      unlimited: false,
      creditBalanceSeconds: 0,
    },
    ...over,
  } as BillingInfo;
}

function render(info: BillingInfo): string {
  const props = {
    user: { email: "user@example.com" },
    setError: () => undefined,
    setSuccess: () => undefined,
    preloadedBillingInfo: info,
  } as unknown as Props;
  return renderToStaticMarkup(<ProfileBillingTab {...props} />);
}

const gift = {
  plan: "elite_supporter",
  startedAt: "2026-11-01T00:00:00.000Z",
  expiresAt: "2027-02-01T00:00:00.000Z",
};

describe("ProfileBillingTab with a gift on top of a paid subscription", () => {
  // sec-money-7. Every paid-subscription control was gated on there being no
  // gift, so a customer still being charged had nothing in-product to stop it.
  const html = render(
    billingInfo({ plan: "elite_supporter", giftedSubscription: gift }),
  );

  it("still offers to cancel the subscription that is being charged", () => {
    expect(html).toContain("Cancel subscription");
  });

  it("still links to the billing portal and shows what is charged", () => {
    expect(html).toContain("Manage billing &amp; view invoices");
    expect(html).toContain("Billing Amount");
  });

  it("shows the gift beside it", () => {
    expect(html).toContain("You have a gifted");
  });
});

describe("ProfileBillingTab with only a gift", () => {
  const html = render(
    billingInfo({
      plan: "elite_supporter",
      subscriptionStatus: null,
      stripeCustomerId: null,
      subscription: null,
      giftedSubscription: gift,
    }),
  );

  it("has no subscription to cancel or manage", () => {
    expect(html).not.toContain("Cancel subscription");
    expect(html).not.toContain("Manage billing");
    expect(html).toContain("You have a gifted");
  });
});

describe("ProfileBillingTab meters", () => {
  const html = render(billingInfo());

  it("names each of the four progress bars", () => {
    // ux-a11y-9. Unnamed, a screen reader heard "progress bar, 16 percent"
    // four times with nothing to say which meter it was.
    const bars = html.match(/<div[^>]*role="progressbar"[^>]*>/g) ?? [];
    expect(bars).toHaveLength(4);
    const labels = bars.map((bar) => /aria-label="([^"]+)"/.exec(bar)?.[1]);
    expect(labels).toEqual([
      "Daily scans used",
      "AI verification tokens used",
      "GitHub review tokens used",
      "Live-browser minutes used this month",
    ]);
  });

  it("puts each top-level panel on the panel tone, not the nested one", () => {
    // ux-design-6. These Cards sit directly on the page, so the quieter
    // nested tone made them a shade off the panels on the tabs beside them.
    expect(html).not.toContain("border-border/50 bg-card/50");
    expect(html.match(/rounded-xl border border-border bg-card/g)).toHaveLength(
      5,
    );
  });

  it("says AI chat and summaries are free, and chat is rate limited", () => {
    expect(html).toContain(
      "AI finding verification tokens. Scan summaries are free, and AI chat is free but rate limited.",
    );
    expect(html).not.toContain("unlimited on every plan");
  });
});
