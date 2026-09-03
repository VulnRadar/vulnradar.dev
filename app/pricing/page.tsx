"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  APP_NAME,
  ROUTES,
  BILLING_ENABLED,
  BILLING_HISTORY_RETENTION,
  TOTAL_CHECKS_LABEL,
  API,
} from "@/lib/config/client-constants";
import Link from "next/link";
import { useAuth } from "@/components/providers/auth-provider";
import { PLANS as LIB_PLANS } from "@/lib/billing/plans";
import { usePlanLimits, type AllPlanLimits } from "@/lib/hooks/use-plan-limits";
import { PublicPageShell } from "@/components/shared/public-page-shell";
import { PricingHero } from "@/components/pricing/pricing-hero";
import { PricingCards } from "@/components/pricing/pricing-cards";
import { PricingFeatures } from "@/components/pricing/pricing-features";
import { PricingFaq } from "@/components/pricing/pricing-faq";
import { PricingCta } from "@/components/pricing/pricing-cta";
import { PRICING_MODEL_FAQ } from "./pricing-model-faq";

// Generate pricing page plans from centralized config.

/** Spec-block value. -1 is the unlimited sentinel, 0 means the tier does not
 *  get the thing at all, which is a real answer in a comparison and not a
 *  reason to hide the row. Matches the `quota()` helper the comparison table
 *  below the cards uses, so a value never reads one way in the cards and
 *  another way in the table. */
function specValue(n: number): string {
  if (n === -1) return "Unlimited";
  if (n === 0) return "None";
  return n.toLocaleString();
}

// The catalog description for every tier opens by restating that tier's daily
// scan number, which now has its own labelled row in the spec block directly
// underneath it. The free column was the worst of it: the subtitle said "25
// scans a day", the first bullet said "25 scans per day", and a later bullet
// said "25 scans a day, one at a time". These lines say who the tier is FOR,
// which is the one thing the numbers cannot say. Keyed by id with a fallback
// to the catalog copy so an added tier still renders something.
const POSITIONING: Record<string, string> = {
  free: "Enough to watch everything you ship.",
  core_supporter: "For more than one property. Also what pays the hosting.",
  pro_supporter: "Enough to gate a pipeline, with a team reading the output.",
  elite_supporter: "For an agency, or the portfolio nobody has counted lately.",
};

// Retention is a per-plan config value that happens to be -1 (unlimited) on
// every tier here. Claimed only while that is actually true: the card copy
// this replaced hard-coded "30-day" and "90-day" retention that had not been
// real for months (AUDIT-014#mkt-08).
const EVERY_PLAN_KEEPS_HISTORY = LIB_PLANS.every(
  (p) =>
    BILLING_HISTORY_RETENTION[
      p.id as keyof typeof BILLING_HISTORY_RETENTION
    ] === -1,
);

// Everything that is identical on all four tiers, stated once here so the
// comparison table below can be nothing but differences. Rows whose cells were
// all ticks (AI chat, the REST API, the whole "Included on every plan"
// section) used to sit in that table saying nothing sixteen cells at a time;
// they are covered by this sentence instead.
const UNIVERSAL = [
  `Every plan runs the same engine: all ${TOTAL_CHECKS_LABEL} checks, every category, the same severities and the same finding IDs.`,
  "AI chat and AI scan summaries, the REST API and bearer tokens, PDF, JSON, SARIF and Markdown export, diffing any two runs of a URL, and unlimited verified domains are on the free tier too.",
  EVERY_PLAN_KEEPS_HISTORY
    ? "Scan history is kept forever on all four, and the whole thing is self-hostable under GPL-3.0 with no plan limits at all."
    : "The whole thing is self-hostable under GPL-3.0 with no plan limits at all.",
  "Paying raises quotas, it does not unlock findings.",
].join(" ");

/**
 * The plan cards, built from `limits` rather than the catalog copy in
 * lib/billing/catalog.ts. Those are resolved from the admin-editable BILLING_*
 * settings the API enforces against (lib/hooks/use-plan-limits.ts), so a
 * deployment that raises a quota in /admin does not keep advertising the old
 * number, and the cards cannot disagree with the comparison table below them
 * on the same page (AUDIT-011#drift-10).
 */
function buildPlans(limits: AllPlanLimits) {
  return LIB_PLANS.map((libPlan) => {
    const planLimits = limits[libPlan.id];
    const scanLimit = planLimits.dailyScans;

    return {
      id: libPlan.id,
      stripeId: libPlan.id === "free" ? null : libPlan.id,
      name: libPlan.name.replace(" Supporter", ""),
      positioning: POSITIONING[libPlan.id] ?? libPlan.description,
      price: libPlan.priceInCents / 100,
      interval: "month" as const,
      scansPerDay: scanLimit,
      popular: libPlan.id === "pro_supporter",
      // The same five labels in the same order on every plan. Chosen because
      // each one actually differs between tiers and is something a buyer
      // decides on; everything that is equal across tiers moved to the strip
      // under the rail, and the exhaustive list is the table below.
      specs: [
        { label: "Scans a day", value: specValue(scanLimit) },
        {
          label: "Running at once",
          value: specValue(planLimits.concurrentScans),
        },
        {
          label: "API requests a day",
          value: specValue(planLimits.apiRequestsPerDay),
        },
        {
          label: "Team members",
          value: specValue(planLimits.teamMembers),
        },
        { label: "Profile badge", value: libPlan.badge?.text ?? "None" },
      ],
    };
  });
}

export default function PricingPage() {
  const { me, isStaff } = useAuth();
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
  const PLANS = buildPlans(usePlanLimits());

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
        universal={UNIVERSAL}
      />

      <PricingFeatures />
      <PricingFaq />
      <PricingCta isLoggedIn={isLoggedIn} />
    </PublicPageShell>
  );
}
