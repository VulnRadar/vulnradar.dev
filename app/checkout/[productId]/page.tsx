"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { Check, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { PRODUCTS, getPlanFromProductId } from "@/lib/billing/products";
import { PLANS } from "@/lib/billing/plans";
import { ACTIVE_SUBSCRIPTION_STATUSES } from "@/lib/billing/subscription-status";
import { isStaffRole } from "@/lib/auth/permissions-client";
import Link from "next/link";
import { ROUTES, BILLING_ENABLED, APP_NAME } from "@/lib/config/constants";
import { StripeCheckout } from "@/components/billing/stripe-checkout";
import { CheckoutSkeleton } from "@/components/billing/checkout-skeleton";

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
          router.push(`/auth?redirect=/checkout/${productId}`);
          return;
        }
        const meData = await meRes.json();
        setHasActiveSubscription(
          ACTIVE_SUBSCRIPTION_STATUSES.includes(
            meData.data?.subscriptionStatus,
          ),
        );
        setIsStaffAccount(isStaffRole(meData.data?.role));
      } catch {
        router.push(`/auth?redirect=/checkout/${productId}`);
      } finally {
        setLoading(false);
      }
    }

    checkAuth();
  }, [productId, product, router]);

  if (!BILLING_ENABLED) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-md px-4">
          <h1 className="text-2xl font-bold mb-2">
            There is nothing to pay for
          </h1>
          <p className="text-muted-foreground mb-4">
            Billing is switched off on this {APP_NAME} deployment, so every
            account already has full access.
          </p>
          <Button size="lg" className="h-11 px-6 gap-2" asChild>
            <Link href={ROUTES.DASHBOARD}>Go to Scanner</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (isStaffAccount && isBelowStaffFloor) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-md px-4">
          <h1 className="text-2xl font-bold mb-2">
            There is nothing to pay for
          </h1>
          <p className="text-muted-foreground mb-4">
            Staff accounts already have Pro Supporter access, so there is no
            need to subscribe to a lower plan. You can still upgrade to Elite
            Supporter from the pricing page if you want it.
          </p>
          <Button size="lg" className="h-11 px-6 gap-2" asChild>
            <Link href={ROUTES.PRICING}>View plans</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!product || !plan) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center px-4">
          <h1 className="text-2xl font-bold mb-2">That plan does not exist</h1>
          <p className="text-muted-foreground mb-4">
            The link you followed does not match a current plan. Nothing has
            been charged.
          </p>
          <Button size="lg" className="h-11 px-6 gap-2" asChild>
            <Link href={ROUTES.PRICING}>View plans</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (loading) {
    return <CheckoutSkeleton />;
  }

  if (checkoutComplete) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-background"
        role="status"
      >
        <div className="text-center px-4">
          <div className="w-16 h-16 rounded-full bg-[hsl(var(--success)/0.12)] flex items-center justify-center mx-auto mb-6">
            <Check
              className="h-8 w-8 text-[hsl(var(--success))]"
              aria-hidden="true"
            />
          </div>
          <h1 className="text-2xl font-bold mb-2">You are subscribed</h1>
          <p className="text-muted-foreground mb-6">
            Your account is on{" "}
            <span className="font-medium text-foreground">{plan.name}</span>{" "}
            now. The new scan limit applies immediately.
          </p>
          <Button size="lg" className="h-11 px-6 gap-2" asChild>
            <Link href={ROUTES.DASHBOARD}>Start scanning</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 sticky top-[var(--vr-banner-h,0px)] z-10 transition-[top] duration-300">
        <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link
            href={ROUTES.PRICING}
            className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span className="text-sm">Back to plans</span>
          </Link>
          <div className="w-4" />
        </div>
      </header>
      {/* position: sticky reserves flow space at the header's unshifted
          height only -- the extra top-[var(--vr-banner-h)] offset that
          pushes it down below a banner is a paint-only shift, so without
          this the header visually overlaps the content below it. */}
      <div
        className="h-[var(--vr-banner-h,0px)] transition-[height] duration-300"
        aria-hidden="true"
      />

      {/* Main content */}
      <main className="container max-w-5xl mx-auto px-4 py-8 md:py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 md:items-start">
          {/* Left column - order summary */}
          <div>
            <div className="mb-6">
              <h1 className="text-2xl md:text-3xl font-bold mb-2">
                {isYearly
                  ? "Switch to yearly billing"
                  : "Start your subscription"}
              </h1>
              <p className="text-muted-foreground">
                {product.name} runs {plan.limits.dailyScans} scans a day,
                starting the moment payment goes through.
              </p>
            </div>

            <div className="sticky top-24">
              {/* Order Summary */}
              <div className="relative overflow-hidden rounded-xl border border-border bg-card p-5 mb-6">
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 w-1"
                  style={{
                    backgroundColor: plan.badge?.color || "hsl(var(--primary))",
                  }}
                />
                <div className="pl-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-semibold text-lg">{product.name}</p>
                    <p className="text-sm font-medium tabular-nums text-muted-foreground">
                      {plan.limits.dailyScans} scans/day
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {product.description}
                  </p>
                </div>

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
                    <span className="text-2xl font-bold">
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

              {/* Features */}
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="text-sm font-medium text-muted-foreground mb-3">
                  What&apos;s included
                </h3>
                <ul className="space-y-2">
                  {plan.features.slice(0, 5).map((feature, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <Check
                        className="h-4 w-4 text-[hsl(var(--success))] shrink-0"
                        aria-hidden="true"
                      />
                      <span>{feature}</span>
                    </li>
                  ))}
                  <li className="flex items-center gap-2 text-sm">
                    <Check
                      className="h-4 w-4 text-[hsl(var(--success))] shrink-0"
                      aria-hidden="true"
                    />
                    <span>{plan.limits.dailyScans} scans per day</span>
                  </li>
                </ul>
              </div>

              <p className="text-center text-xs text-muted-foreground mt-4">
                Payment handled by Stripe, not us. Cancel anytime, no lock-in.
              </p>
            </div>
          </div>

          {/* Right column - payment form */}
          <div className="md:pt-[120px]">
            <div className="sticky top-24">
              <div className="rounded-xl border border-border bg-card p-6">
                <h2 className="text-base font-semibold mb-5">
                  Payment details
                </h2>
                <StripeCheckout
                  productId={productId}
                  planName={plan.name}
                  amountCents={product.priceInCents}
                  hasActiveSubscription={hasActiveSubscription}
                  onSuccess={() => setCheckoutComplete(true)}
                />
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
      </main>
    </div>
  );
}
