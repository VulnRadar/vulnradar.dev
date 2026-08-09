"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";
import { ROUTES } from "@/lib/config/constants";
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
  isGifted: boolean;
  isLoggedIn: boolean;
  isStaff: boolean;
  onSelectPlan?: (planId: string) => void;
}

export function PricingCards({
  plans,
  billing,
  currentPlan,
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

  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {plans.map((plan) => {
          const price = getPrice(plan.price);
          const isCurrentPlan = currentPlan === plan.id;
          const isDowngrade = (planRank.get(plan.id) ?? 0) < currentRank;

          return (
            <div
              key={plan.id}
              className={cn(
                "relative flex flex-col rounded-xl border p-5 lg:p-6",
                plan.popular
                  ? "border-primary bg-card shadow-lg shadow-primary/10 lg:-translate-y-1.5"
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
              ) : isStaff && plan.price > 0 ? (
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
                    {isDowngrade ? "Downgrade to" : "Upgrade to"} {plan.name}
                  </Link>
                </Button>
              ) : (
                <Button
                  variant={plan.popular ? "default" : "outline"}
                  className="w-full h-10"
                  asChild
                >
                  <Link href={ROUTES.SIGNUP}>Get Started</Link>
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
