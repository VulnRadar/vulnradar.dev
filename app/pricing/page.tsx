"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  APP_NAME,
  ROUTES,
  BILLING_ENABLED,
  BILLING_PLAN_LIMITS,
  BILLING_HISTORY_RETENTION,
  API,
} from "@/lib/config/client-constants";
import Link from "next/link";
import { useAuth } from "@/components/providers/auth-provider";
import { PLANS as LIB_PLANS } from "@/lib/billing/plans";
import { PublicPageShell } from "@/components/shared/public-page-shell";
import { PricingHero } from "@/components/pricing/pricing-hero";
import { PricingCards } from "@/components/pricing/pricing-cards";
import { PricingFeatures } from "@/components/pricing/pricing-features";
import { PricingFaq } from "@/components/pricing/pricing-faq";
import { PricingCta } from "@/components/pricing/pricing-cta";
import { PRICING_MODEL_FAQ } from "./pricing-model-faq";

// Generate pricing page plans from centralized config
function getRetentionLabel(planId: string): string {
  const retention =
    BILLING_HISTORY_RETENTION[planId as keyof typeof BILLING_HISTORY_RETENTION];
  if (retention === -1) return "Unlimited scan history";
  return `${retention}-day scan history`;
}

const PLANS = LIB_PLANS.map((libPlan) => {
  const scanLimit =
    BILLING_PLAN_LIMITS[libPlan.id as keyof typeof BILLING_PLAN_LIMITS] ||
    libPlan.limits.dailyScans;

  // Scan limit and retention come from the billing config rather than the
  // catalog copy, so a self-hosted deployment that raises a quota does not
  // end up advertising the old number.
  const features: string[] = [
    `${scanLimit} scans per day`,
    getRetentionLabel(libPlan.id),
    ...libPlan.features.filter((f) => !/scan history/i.test(f)),
  ];

  return {
    id: libPlan.id,
    stripeId: libPlan.id === "free" ? null : libPlan.id,
    name: libPlan.name.replace(" Supporter", ""),
    description: libPlan.description,
    price: libPlan.priceInCents / 100,
    interval: "month" as const,
    scansPerDay: scanLimit,
    popular: libPlan.id === "pro_supporter",
    features,
  };
});

export default function PricingPage() {
  const { me, isStaff } = useAuth();
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");

  const currentPlan = me?.plan || "free";
  const isGifted = me?.subscriptionStatus === "gifted";
  const isLoggedIn = !!me?.userId;

  // /auth/me carries the plan id but not the billing interval, and the plan id
  // alone cannot tell a monthly subscriber apart from a yearly one. Without it
  // the yearly toggle rendered a disabled "Current Plan" for a monthly
  // subscriber, so the annual price had no entry point anywhere in the product.
  // Only paying, non-gifted accounts need the extra request (the billing
  // endpoint only reaches Stripe when there is a subscription to read).
  const needsInterval = isLoggedIn && currentPlan !== "free" && !isGifted;
  const [currentInterval, setCurrentInterval] = useState<
    "monthly" | "yearly" | null
  >(null);

  useEffect(() => {
    if (!needsInterval) {
      setCurrentInterval(null);
      return;
    }
    let cancelled = false;
    fetch(API.BILLING)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { subscription?: { priceInterval?: string | null } }) => {
        if (cancelled) return;
        const interval = data?.subscription?.priceInterval;
        // Anything other than a confirmed "year" stays null, which keeps the
        // old plan-id-only behaviour: never offer someone a switch to the
        // billing period they are already paying for.
        setCurrentInterval(
          interval === "year"
            ? "yearly"
            : interval === "month"
              ? "monthly"
              : null,
        );
      })
      .catch(() => {
        /* interval stays unknown, which falls back to the id-only check */
      });
    return () => {
      cancelled = true;
    };
  }, [needsInterval]);

  if (!BILLING_ENABLED) {
    return (
      <PublicPageShell maxWidth="max-w-3xl" padding="py-20 sm:py-28">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-5 text-balance">
          There is nothing to pay for here
        </h1>
        <p className="text-muted-foreground leading-relaxed mb-4">
          Billing is switched off on this {APP_NAME} deployment. Every account
          gets the full check set, the full API, and no daily scan ceiling.
        </p>
        <p className="text-muted-foreground leading-relaxed mb-8">
          If you are running this yourself, the switch is{" "}
          <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted border border-border/60 text-foreground">
            CONFIG_BILLING_ENABLED
          </code>{" "}
          in the deployment config.
        </p>
        <Button asChild size="lg" className="h-11 px-6 gap-2">
          {/* "Get Started" named no action, the same generic-SaaS copy
                already replaced in the landing nav and the pricing cards.
                This link goes to /signup, so say that. */}
          <Link href={me ? ROUTES.DASHBOARD : ROUTES.SIGNUP}>
            {me ? "Go to Scanner" : "Create an account"}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>

        <section className="mt-16 pt-10 border-t border-border/50">
          <h2 className="text-2xl font-semibold tracking-tight mb-3">
            How {APP_NAME} is priced
          </h2>
          <p className="text-muted-foreground leading-relaxed mb-6 max-w-2xl">
            For reference, the hosted {APP_NAME} service is priced by scan
            volume rather than per target. Vulnerability assessment pricing
            stays simple: a free tier, then paid plans that raise daily scan
            quotas and history retention. The same detection engine runs on
            every plan.
          </p>
          <ul className="divide-y divide-border/50 border-y border-border/50 mb-10">
            {PLANS.map((plan) => (
              <li
                key={plan.id}
                className="flex items-baseline justify-between gap-4 py-3"
              >
                <span className="font-medium text-foreground">{plan.name}</span>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {plan.price === 0 ? "Free" : `$${plan.price}/mo`} ·{" "}
                  {plan.scansPerDay} scans/day
                </span>
              </li>
            ))}
          </ul>

          <h2 className="text-2xl font-semibold tracking-tight mb-6">
            Pricing questions
          </h2>
          <dl className="divide-y divide-border/50 border-t border-border/50">
            {PRICING_MODEL_FAQ.map((faq) => (
              <div key={faq.question} className="py-6">
                <dt className="font-medium text-foreground mb-2 text-balance">
                  {faq.question}
                </dt>
                <dd className="text-sm text-muted-foreground leading-relaxed">
                  {faq.answer}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </PublicPageShell>
    );
  }

  return (
    <PublicPageShell fullBleed>
      <PricingHero billing={billing} onBillingChange={setBilling} />

      <PricingCards
        plans={PLANS}
        billing={billing}
        currentPlan={currentPlan}
        currentInterval={currentInterval}
        isGifted={isGifted}
        isLoggedIn={isLoggedIn}
        isStaff={isStaff}
      />

      <PricingFeatures />
      <PricingFaq />
      <PricingCta isLoggedIn={isLoggedIn} />
    </PublicPageShell>
  );
}
