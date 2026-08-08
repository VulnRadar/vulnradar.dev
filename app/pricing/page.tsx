"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  APP_NAME,
  ROUTES,
  BILLING_ENABLED,
  BILLING_PLAN_LIMITS,
  BILLING_HISTORY_RETENTION,
} from "@/lib/config/constants";
import Link from "next/link";
import { useAuth } from "@/components/providers/auth-provider";
import { PLANS as LIB_PLANS } from "@/lib/billing/plans";
import { Footer } from "@/components/scanner/footer";
import { LandingNav } from "@/components/landing/landing-nav";
import { PricingHero } from "@/components/pricing/pricing-hero";
import { PricingCards } from "@/components/pricing/pricing-cards";
import { PricingFeatures } from "@/components/pricing/pricing-features";
import { PricingFaq } from "@/components/pricing/pricing-faq";
import { PricingCta } from "@/components/pricing/pricing-cta";

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
  const { me } = useAuth();
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");

  const currentPlan = me?.plan || "free";
  const isGifted = me?.subscriptionStatus === "gifted";
  const isLoggedIn = !!me?.userId;

  if (!BILLING_ENABLED) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <LandingNav />
        <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-20 sm:py-28">
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
            <Link href={me ? ROUTES.DASHBOARD : ROUTES.SIGNUP}>
              {me ? "Go to Scanner" : "Get Started"}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <LandingNav />

      <main className="flex-1">
        <PricingHero billing={billing} onBillingChange={setBilling} />

        <PricingCards
          plans={PLANS}
          billing={billing}
          currentPlan={currentPlan}
          isGifted={isGifted}
          isLoggedIn={isLoggedIn}
        />

        <PricingFeatures />
        <PricingFaq />
        <PricingCta isLoggedIn={isLoggedIn} />
      </main>

      <Footer />
    </div>
  );
}
