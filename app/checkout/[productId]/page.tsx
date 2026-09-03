"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { PRODUCTS, getPlanFromProductId } from "@/lib/billing/products";
import { PLANS } from "@/lib/billing/plans";
import { usePlanLimits } from "@/lib/hooks/use-plan-limits";
import { ACTIVE_SUBSCRIPTION_STATUSES } from "@/lib/billing/subscription-status";
import { isStaffRole } from "@/lib/auth/permissions-client";
import Link from "next/link";
import {
  ROUTES,
  BILLING_ENABLED,
  APP_NAME,
} from "@/lib/config/client-constants";
import { StripeCheckout } from "@/components/billing/stripe-checkout";
import { CheckoutShell } from "@/components/billing/checkout-shell";
import { PaymentFormSkeleton } from "@/components/billing/checkout-status";
import { CheckoutMessage } from "@/components/billing/checkout-message";

export default function CheckoutPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = use(params);
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false);
  const [isStaffAccount, setIsStaffAccount] = useState(false);
  const [checkoutComplete, setCheckoutComplete] = useState(false);

  const product = PRODUCTS.find((p) => p.id === productId);
  const planId = product ? getPlanFromProductId(product.id) : null;
  const plan = planId ? PLANS.find((p) => p.id === planId) : null;
  // The scan-a-day figure quoted on this page is the number the buyer is about
  // to pay for, so it is read from the settings the API enforces rather than
  // from the catalog copy compiled into the bundle (AUDIT-011#drift-10).
  const planLimits = usePlanLimits();
  const dailyScans = planId
    ? planLimits[planId].dailyScans
    : (plan?.limits.dailyScans ?? 0);

  // billing: PLANS is already ordered lowest-to-highest tier (free, core,
  // pro, elite) -- see components/pricing/pricing-cards.tsx's identical
  // comment. Staff (lib/billing/staff-plan.ts) already hold a real,
  // granted pro_supporter floor and cannot self-downgrade below it by
  // checking out for a cheaper plan, but CAN pay for Elite on top of it.
  const proSupporterRank = PLANS.findIndex((p) => p.id === "pro_supporter");
  const isBelowStaffFloor =
    planId != null &&
    PLANS.findIndex((p) => p.id === planId) < proSupporterRank;

  const monthlyPrice = product ? product.priceInCents / 100 : 0;
  const isYearly = product?.interval === "year";
  const effectiveMonthly = isYearly ? monthlyPrice / 12 : monthlyPrice;

  useEffect(() => {
    // An unknown productId is knowable synchronously from PRODUCTS -- the
    // `!product || !plan` check below already renders for it, so there's
    // nothing for this effect to do (and no session to check) in that case.
    if (!product) return;

    async function checkAuth() {
      try {
        const meRes = await fetch("/api/v3/auth/me");
        if (!meRes.ok) {
          router.push(`${ROUTES.LOGIN}?redirect=/checkout/${productId}`);
          return;
        }
        const meData = await meRes.json();
        // billing: this read `meData.data?.subscriptionStatus`, but
        // ApiResponse.success() returns the payload FLAT (lib/api/api-utils.ts:15
        // is `NextResponse.json(data)`, with no envelope), so `.data` was always
        // undefined and this always evaluated false. Every existing subscriber
        // was therefore shown the new-subscription flow instead of the upgrade
        // one, on the checkout page.
        setHasActiveSubscription(
          ACTIVE_SUBSCRIPTION_STATUSES.includes(meData?.subscriptionStatus),
        );
        // Same flat-response bug as subscriptionStatus above: staff were never
        // detected here, so the staff-account branch was unreachable.
        setIsStaffAccount(isStaffRole(meData?.role));
      } catch {
        router.push(`${ROUTES.LOGIN}?redirect=/checkout/${productId}`);
      } finally {
        setLoading(false);
      }
    }

    checkAuth();
  }, [productId, product, router]);

  if (!BILLING_ENABLED) {
    return (
      <CheckoutMessage
        title="There is nothing to pay for"
        description={`Billing is switched off on this ${APP_NAME} deployment, so every account already has full access.`}
        action={
          <Button size="lg" className="h-11 px-6 gap-2" asChild>
            <Link href={ROUTES.DASHBOARD}>Go to Scanner</Link>
          </Button>
        }
      />
    );
  }

  if (isStaffAccount && isBelowStaffFloor) {
    return (
      <CheckoutMessage
        title="There is nothing to pay for"
        description="Staff accounts already have Pro Supporter access, so there is no need to subscribe to a lower plan. You can still upgrade to Elite Supporter from the pricing page if you want it."
        action={
          <Button size="lg" className="h-11 px-6 gap-2" asChild>
            <Link href={ROUTES.PRICING}>View plans</Link>
          </Button>
        }
      />
    );
  }

  if (!product || !plan) {
    return (
      <CheckoutMessage
        title="That plan does not exist"
        description="The link you followed does not match a current plan. Nothing has been charged."
        action={
          <Button size="lg" className="h-11 px-6 gap-2" asChild>
            <Link href={ROUTES.PRICING}>View plans</Link>
          </Button>
        }
      />
    );
  }

  if (checkoutComplete) {
    return (
      <CheckoutMessage
        tone="success"
        title="You are subscribed"
        description={
          <>
            Your account is on{" "}
            <span className="font-medium text-foreground">{plan.name}</span>{" "}
            now. The new scan limit applies immediately.
          </>
        }
        action={
          <Button size="lg" className="h-11 px-6 gap-2" asChild>
            <Link href={ROUTES.DASHBOARD}>Start scanning</Link>
          </Button>
        }
      />
    );
  }

  // Everything below except the payment form is derived synchronously from
  // PRODUCTS and PLANS, so none of it waits on anything: the heading, the
  // order summary and the feature list are correct on the first frame. The
  // auth request only decides whether Stripe is asked to start a subscription
  // or an upgrade, so it is the payment column alone that holds a placeholder,
  // and it holds the same PaymentFormSkeleton the Stripe form shows before it
  // mounts. The page used to hand its entire body to CheckoutSkeleton while
  // that one request was in flight, which spent the round trip drawing grey
  // boxes over prices it already had.
  return (
    <CheckoutShell>
      <div
        className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-x-12 md:items-start"
        /* The one md: breakpoint left on these pages, deliberately: every
             other one moved to sm: to match the rest of app/, but this is the
             split that gives the Stripe payment form its own column, and at
             640px that column would be about 270px wide. Wide enough to
             render the card fields, not wide enough to fill them in. */
      >
        {/* The heading is its own full-width grid row, so both panels below
              start on the same grid line whatever the heading wraps to. It
              used to live inside the left column with a hardcoded
              md:pt-[120px] pushing the right one down to match, which only
              lined up at the exact width where the heading happened to be
              120px tall. */}
        <div className="md:col-span-2">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-5 text-balance">
            {isYearly ? "Switch to yearly billing" : "Start your subscription"}
          </h1>
          <p className="text-muted-foreground">
            {product.name} runs {dailyScans} scans a day, starting the moment
            payment goes through.
          </p>
        </div>

        {/* Left column - order summary */}
        <div>
          <div className="sticky top-24">
            {/* Order Summary */}
            <div className="relative overflow-hidden rounded-xl border border-border bg-card p-5">
              {/* Not dead code and not a token bypass to remove: badge.color
                    is real catalog data (lib/billing/catalog.ts gives core,
                    pro and elite their own value) and it is the SAME per-plan
                    accent the profile, admin and shared-report pages paint, so
                    a plan reads as one colour everywhere. Only the free plan
                    has no badge, and the free plan is never checked out, which
                    is what makes the fallback look unreachable. A class cannot
                    express a value that comes from data. */}
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-1"
                style={{
                  backgroundColor: plan.badge?.color || "hsl(var(--primary))",
                }}
              />
              {/* One pl-3 around the whole card, not just its header: the
                    indent that clears the accent edge used to wrap the plan
                    name only, so the name sat 12px to the right of the price
                    rows under it and nothing in the panel shared a left edge. */}
              <div className="pl-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-semibold text-lg">{product.name}</p>
                  <p className="text-sm font-medium tabular-nums text-muted-foreground">
                    {dailyScans} scans/day
                  </p>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {product.description}
                </p>

                <Separator className="my-4" />

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {isYearly
                        ? "Yearly subscription"
                        : "Monthly subscription"}
                    </span>
                    <span className="font-medium">
                      ${monthlyPrice.toFixed(2)}/{isYearly ? "yr" : "mo"}
                    </span>
                  </div>
                  {isYearly && (
                    <div className="flex justify-between text-[hsl(var(--success))]">
                      <span>Annual discount (20% off)</span>
                      <span>Included</span>
                    </div>
                  )}
                </div>

                <Separator className="my-4" />

                <div className="flex justify-between items-center">
                  <span className="font-semibold">Total today</span>
                  <div className="text-right">
                    <span className="text-2xl font-semibold tabular-nums">
                      ${monthlyPrice.toFixed(2)}
                    </span>
                    <p className="text-xs text-muted-foreground">
                      {isYearly
                        ? `$${effectiveMonthly.toFixed(2)}/mo effective`
                        : "Billed monthly"}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  Renews {isYearly ? "every year" : "every month"} at{" "}
                  {`$${monthlyPrice.toFixed(2)}`} until you cancel. No trial, no
                  separate setup fee.
                </p>
              </div>
            </div>

            {/* Supporting, not equal. This used to be a second
                  `rounded-xl border bg-card p-5` panel stacked under the order
                  summary, so the thing being bought and the footnote about it
                  carried identical weight. It is now a plain list on the page:
                  no border, no surface, and no column of six identical check
                  glyphs, which carried no information the sentence beside them
                  did not. The trailing "N scans per day" row is gone as well;
                  the summary states that number four lines above. */}
            <div className="mt-6">
              <h2 className="text-sm font-medium text-foreground mb-2">
                What&apos;s included
              </h2>
              <ul className="list-disc pl-4 space-y-1.5 text-sm text-muted-foreground marker:text-muted-foreground/50">
                {plan.features.slice(0, 5).map((feature, i) => (
                  <li key={i} className="leading-relaxed">
                    {feature}
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-xs text-muted-foreground mt-6">
              Payment handled by Stripe, not us. Cancel anytime, no lock-in.
            </p>
          </div>
        </div>

        {/* Right column - payment form */}
        <div>
          <div className="sticky top-24">
            <div className="rounded-xl border border-border bg-card p-6">
              <h2 className="text-base font-semibold mb-5">Payment details</h2>
              {/* hasActiveSubscription is what the auth request is for, and
                    it decides whether Stripe opens a new subscription or an
                    upgrade, so the form cannot be mounted before it lands.
                    PaymentFormSkeleton is what StripeCheckout itself renders
                    while it waits for the theme, so the wait is one shape
                    from here to the real card fields. */}
              {loading ? (
                <PaymentFormSkeleton />
              ) : (
                <StripeCheckout
                  productId={productId}
                  planName={plan.name}
                  amountCents={product.priceInCents}
                  hasActiveSubscription={hasActiveSubscription}
                  onSuccess={() => setCheckoutComplete(true)}
                />
              )}
            </div>

            <p className="text-center text-xs text-muted-foreground mt-4">
              By subscribing, you agree to our{" "}
              <Link
                href="/legal/terms"
                className="underline hover:text-foreground"
              >
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link
                href="/legal/privacy"
                className="underline hover:text-foreground"
              >
                Privacy Policy
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </CheckoutShell>
  );
}
