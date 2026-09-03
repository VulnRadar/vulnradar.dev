"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";
import { ROUTES } from "@/lib/config/client-constants";
import Link from "next/link";
import { PRICING_RAIL_SECTION } from "./pricing-sections";

/** One row of the spec block. Every plan carries the SAME labels in the SAME
 *  order, which is the whole point: the reader compares across a row instead
 *  of reading four unrelated lists. */
export interface PlanSpec {
  label: string;
  value: string;
}

export interface Plan {
  id: string;
  stripeId: string | null;
  name: string;
  /** Who the tier is for. Deliberately NOT the quota, which has its own row. */
  positioning: string;
  price: number;
  interval: "month";
  scansPerDay: number;
  popular: boolean;
  specs: PlanSpec[];
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
  /** What is true on every tier, as one sentence. It belongs under the whole
   *  rail rather than being repeated inside all four columns. */
  universal: string;
}

/**
 * Four plans as ONE panel of aligned columns, not four bordered cards.
 *
 * The cards this replaces were the exact shape CLAUDE.md tells us to avoid:
 * four identical boxes, each with its own ragged tick list of a different
 * length, so the columns ended up different heights with nothing lining up
 * and the differences between tiers unfindable. The free column also said
 * "25 scans a day" three times (subtitle, first bullet, second bullet).
 *
 * A pricing table exists so someone can find the DIFFERENCES, and the
 * differences here are purely quantitative: the detection engine is identical
 * on every plan, which is the page's own headline claim. So the layout says
 * that too. Each column carries the same five labelled rows in the same
 * order, right-aligned and tabular, and everything true on every tier moved
 * out to the strip along the bottom. Subgrid keeps the price, the positioning
 * line, the button and the spec block on shared baselines even when one
 * column has an extra line (the annual "billed annually" note, a two-line
 * positioning sentence), which is what makes reading across a row work.
 */
export function PricingCards({
  plans,
  billing,
  currentPlan,
  currentInterval = null,
  isGifted,
  isLoggedIn,
  isStaff,
  universal,
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
    <section className={PRICING_RAIL_SECTION} aria-label="Plans">
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card/40">
        {/* One row of four at lg, a single stack below it. No 2-up
            breakpoint on purpose: two columns cannot be compared across a
            row any better than one can, and it is the only arrangement
            where per-column borders stay predictable. */}
        <div className="grid grid-cols-1 lg:grid-cols-4 lg:grid-rows-[auto_auto_auto_auto_1fr]">
          {plans.map((plan, i) => {
            const price = getPrice(plan.price);
            // A matching plan id is not enough on its own: someone paying
            // monthly who flips the toggle to yearly is looking at a product
            // they are not on, and rendering a disabled "Current Plan" there
            // left the annual price with no entry point anywhere in the
            // product. When the interval is unknown (free, gifted, staff
            // floor, or the lookup failed) this falls back to the old
            // id-only check, so we never offer a switch to the billing
            // period already being paid for.
            const isSamePlanId = currentPlan === plan.id;
            const isCurrentPlan =
              isSamePlanId &&
              (currentInterval === null || currentInterval === billing);
            const isIntervalSwitch = isSamePlanId && !isCurrentPlan;
            const isDowngrade = (planRank.get(plan.id) ?? 0) < currentRank;
            const headingId = `plan-${plan.id}`;

            return (
              <div
                key={plan.id}
                className={cn(
                  "flex flex-col gap-5 p-5 lg:gap-0 lg:row-span-5 lg:grid lg:grid-rows-subgrid lg:p-6",
                  // Borders per column rather than divide-x/divide-y: in a
                  // grid those two draw the wrong edges as soon as the
                  // column count changes at a breakpoint.
                  i > 0 &&
                    "border-t border-border/60 lg:border-t-0 lg:border-l",
                  // The popular column used to be a card with shadow-lg, a
                  // coloured glow and a 6px lift. Nothing else in the product
                  // is elevated-and-offset, and hover-lift-plus-shadow is the
                  // single most recognisable marketing-template gesture on a
                  // page whose whole job is to read as honest. A tint and the
                  // pill say it twice, which is already once more than needed.
                  plan.popular && "bg-primary/5",
                )}
              >
                <div className="flex items-center gap-2 lg:pb-4">
                  <h3
                    id={headingId}
                    className={cn(
                      "text-base font-semibold",
                      plan.popular ? "text-primary" : "text-foreground",
                    )}
                  >
                    {plan.name}
                  </h3>
                  {plan.popular && (
                    <span className="inline-flex items-center rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
                      Most picked
                    </span>
                  )}
                </div>

                <div className="lg:pb-4">
                  <p className="flex items-baseline gap-1">
                    <span className="text-4xl font-semibold tracking-tight tabular-nums text-foreground">
                      ${price}
                    </span>
                    {plan.price > 0 && (
                      <span className="text-sm text-muted-foreground">
                        /{billing === "yearly" ? "yr" : "mo"}
                      </span>
                    )}
                  </p>
                  {plan.price === 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Free forever
                    </p>
                  )}
                  {plan.price > 0 && billing === "yearly" && (
                    <p className="mt-1 text-xs font-medium tabular-nums text-primary">
                      ${Math.round(price / 12)}/mo billed annually
                    </p>
                  )}
                </div>

                <p className="text-sm leading-relaxed text-muted-foreground lg:pb-5">
                  {plan.positioning}
                </p>

                {/* The action sits above the spec block, not under it: a
                    column that ends in five rows of numbers buries the one
                    control the page exists for. */}
                <div className="lg:pb-6">
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
                      <Link
                        href={isLoggedIn ? ROUTES.DASHBOARD : ROUTES.SIGNUP}
                      >
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
                          sentence-case page. This button goes to /signup, not
                          to checkout, so say what actually happens. */}
                      <Link href={ROUTES.SIGNUP}>
                        Start free, upgrade later
                      </Link>
                    </Button>
                  )}
                </div>

                <dl
                  aria-labelledby={headingId}
                  className="border-t border-border/50 text-sm"
                >
                  {plan.specs.map((spec) => (
                    <div
                      key={spec.label}
                      className="flex items-baseline justify-between gap-3 border-b border-border/40 py-2 last:border-b-0"
                    >
                      <dt className="text-muted-foreground">{spec.label}</dt>
                      {/* "Unlimited" takes the accent and "None" recedes to
                          the secondary tone, matching how the comparison
                          table below styles the same two values. Full-strength
                          --muted-foreground rather than an opacity variant:
                          the token only clears AA at full strength, and these
                          are values, not decoration. */}
                      <dd
                        className={cn(
                          "shrink-0 font-medium tabular-nums",
                          spec.value === "Unlimited"
                            ? "text-primary"
                            : spec.value === "None"
                              ? "font-normal text-muted-foreground"
                              : "text-foreground",
                        )}
                      >
                        {spec.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            );
          })}
        </div>

        {/* Everything that does not change between tiers, stated once as
            prose. It used to be spread across all four tick lists, which is
            what made them ragged and the real differences hard to find.
            Deliberately a sentence and not a fifth list: after a rail of
            numbers, the one thing left to say is that none of the numbers
            are about detection. */}
        <div className="grid gap-2 border-t border-border/60 bg-muted/30 px-5 py-4 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:gap-6 sm:px-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground sm:pt-0.5">
            On every plan, free included
          </h3>
          <p className="max-w-3xl text-sm leading-relaxed text-foreground/90">
            {universal}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <p className="text-sm text-muted-foreground">
          Prices are in USD. Cancel whenever you like: access runs to the end of
          the period you already paid for.
        </p>
        <a
          href="#compare"
          className="rounded-sm text-sm font-medium text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          Every limit, line by line
        </a>
      </div>
    </section>
  );
}
