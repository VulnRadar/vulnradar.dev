"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";
import { ROUTES } from "@/lib/config/client-constants";
import Link from "next/link";

interface Plan {
  id: string;
  stripeId: string | null;
  name: string;
  description: string;
  price: number;
  interval: "month";
  scansPerDay: number;
  popular: boolean;
  features: string[];
}

interface PricingCardsProps {
  plans: Plan[];
  billing: "monthly" | "yearly";
  currentPlan: string;
  /** The interval the signed-in account is actually billed on, or null when it
   *  is not known (free, gifted, staff floor, or the lookup failed). */
  currentInterval?: "monthly" | "yearly" | null;
  isGifted: boolean;
  isLoggedIn: boolean;
  isStaff: boolean;
  onSelectPlan?: (planId: string) => void;
}

export function PricingCards({
  plans,
  billing,
  currentPlan,
  currentInterval = null,
  isGifted,
  isLoggedIn,
  isStaff,
  onSelectPlan: _onSelectPlan,
}: PricingCardsProps) {
  const getPrice = (basePrice: number) => {
    if (basePrice === 0) return 0;
    return billing === "yearly" ? Math.round(basePrice * 0.8 * 12) : basePrice;
  };

  const getStripeProductId = (planId: string) =>
    `${planId}_${billing === "yearly" ? "yearly" : "monthly"}`;

  // Plans are already ordered lowest-to-highest tier (free, core, pro,
  // elite), so a plan's index in this list doubles as its tier rank.
  const planRank = new Map(plans.map((p, i) => [p.id, i]));
  const currentRank = planRank.get(currentPlan) ?? 0;
  // billing: staff (lib/billing/staff-plan.ts) already hold a real, granted
  // pro_supporter floor and cannot self-downgrade below it, but CAN pay for
  // Elite on top of it -- so the "already included" block below only
  // applies to plans ranked below Pro, not Pro or Elite themselves.
  const proSupporterRank = planRank.get("pro_supporter") ?? 0;

  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {plans.map((plan) => {
          const price = getPrice(plan.price);
          // A matching plan id is not enough on its own: someone paying
          // monthly who flips the toggle to yearly is looking at a product
          // they are not on, and rendering a disabled "Current Plan" there
          // left the annual price with no entry point anywhere in the product.
          // When the interval is unknown (free, gifted, staff floor, or the
          // lookup failed) this falls back to the old id-only check, so we
          // never offer a switch to the billing period already being paid for.
          const isSamePlanId = currentPlan === plan.id;
          const isCurrentPlan =
            isSamePlanId &&
            (currentInterval === null || currentInterval === billing);
          const isIntervalSwitch = isSamePlanId && !isCurrentPlan;
          const isDowngrade = (planRank.get(plan.id) ?? 0) < currentRank;

          return (
            <div
              key={plan.id}
              className={cn(
                "relative flex flex-col rounded-xl border p-5 lg:p-6",
                // The popular plan used to add shadow-lg, a coloured glow and a
                // 6px lift. Nothing else in the product is elevated-and-offset,
                // and hover-lift-plus-shadow is the single most recognisable
                // marketing-template gesture on a page whose whole job is to
                // read as honest. The full-opacity border and background
                // against the /50 siblings, plus the "Most picked" pill, say it
                // three times already.
                plan.popular
                  ? "border-primary bg-card"
                  : "border-border/50 bg-card/50",
              )}
            >
              {plan.popular && (
                <span className="absolute -top-2.5 left-5 lg:left-6 inline-flex items-center rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
                  Most picked
                </span>
              )}

              <h3 className="text-base font-semibold mb-1">{plan.name}</h3>
              <p className="text-xs text-muted-foreground mb-5 leading-relaxed">
                {plan.description}
              </p>

              <div className="mb-6">
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-semibold tracking-tight tabular-nums">
                    ${price}
                  </span>
                  {plan.price > 0 && (
                    <span className="text-muted-foreground text-sm">
                      /{billing === "yearly" ? "yr" : "mo"}
                    </span>
                  )}
                </div>
                {plan.price === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Free forever
                  </p>
                )}
                {plan.price > 0 && billing === "yearly" && (
                  <p className="text-xs text-primary mt-1 font-medium tabular-nums">
                    ${Math.round(price / 12)}/mo billed annually
                  </p>
                )}
              </div>

              <ul className="flex-1 mb-6 space-y-2.5">
                {plan.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Check
                      className="h-3.5 w-3.5 mt-1 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    <span className="text-muted-foreground leading-relaxed">
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>

              {isCurrentPlan ? (
                <Button
                  variant="outline"
                  className={cn(
                    "w-full h-10",
                    isGifted &&
                      "border-[hsl(var(--warning))]/50 text-[hsl(var(--warning))]",
                  )}
                  disabled
                >
                  {isGifted ? "Gifted Plan" : "Current Plan"}
                </Button>
              ) : isStaff &&
                plan.price > 0 &&
                (planRank.get(plan.id) ?? 0) < proSupporterRank ? (
                <Button variant="outline" className="w-full h-10" disabled>
                  Included in staff access
                </Button>
              ) : plan.price === 0 ? (
                <Button
                  variant={plan.popular ? "default" : "outline"}
                  className="w-full h-10"
                  asChild
                >
                  <Link href={isLoggedIn ? ROUTES.DASHBOARD : ROUTES.SIGNUP}>
                    {isLoggedIn ? "Go to Scanner" : "Start Free"}
                  </Link>
                </Button>
              ) : isLoggedIn ? (
                <Button
                  variant={plan.popular ? "default" : "outline"}
                  className="w-full h-10"
                  asChild
                >
                  <Link
                    href={`/checkout/${getStripeProductId(plan.stripeId!)}`}
                  >
                    {isIntervalSwitch
                      ? billing === "yearly"
                        ? "Switch to yearly billing"
                        : "Switch to monthly billing"
                      : `${isDowngrade ? "Downgrade to" : "Upgrade to"} ${plan.name}`}
                  </Link>
                </Button>
              ) : (
                <Button
                  variant={plan.popular ? "default" : "outline"}
                  className="w-full h-10"
                  asChild
                >
                  {/* "Get Started" named no action and was title case on a
                      sentence-case page. This button goes to /signup, not to
                      checkout, so say what actually happens. */}
                  <Link href={ROUTES.SIGNUP}>Start free, upgrade later</Link>
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-sm text-muted-foreground">
        Prices are in USD. Cancel whenever you like: access runs to the end of
        the period you already paid for.
      </p>
    </section>
  );
}
