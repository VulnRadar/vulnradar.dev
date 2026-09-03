"use client";

import { cn } from "@/lib/ui/utils";
import { focus } from "@/lib/ui/animations";
import { PRICING_HERO_SECTION } from "./pricing-sections";

interface PricingHeroProps {
  billing: "monthly" | "yearly";
  onBillingChange: (billing: "monthly" | "yearly") => void;
}

export function PricingHero({ billing, onBillingChange }: PricingHeroProps) {
  return (
    <section className="border-b border-border/50">
      <div className={PRICING_HERO_SECTION}>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-8 lg:gap-12 lg:items-end">
          <div className="max-w-2xl">
            {/* Tier A exactly (CLAUDE.md typography, which names /pricing as
                the Tier A reference). The lg:text-5xl this carried was a third
                H1 size, and it made this title bigger than the one on /demo,
                /security and every /checks page. Same fix demo-hero already
                had. */}
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-5 text-balance">
              Free until the free tier runs out.
            </h1>
            <p className="text-base sm:text-lg text-muted-foreground text-pretty leading-relaxed">
              Every plan runs the same detection engine on the same checks. Pay
              only when you want more scans per day or a longer history. Nothing
              is held back behind a tier.
            </p>
          </div>

          {/* Compact pill, same natural width on every breakpoint -- a
              full-width mobile toggle was tried and looked worse: stretching
              "Monthly"/"Yearly -20%" edge to edge reads as a much bigger
              control than it needs to be. Desktop still gets the grid's
              right-aligned placement via lg:self-end. */}
          <div
            role="group"
            aria-label="Billing period"
            className="inline-flex items-center gap-0.5 p-1 rounded-lg bg-muted/50 border border-border/50 mx-auto lg:mx-0 lg:self-end lg:shrink-0"
          >
            <button
              type="button"
              aria-pressed={billing === "monthly"}
              onClick={() => onBillingChange("monthly")}
              className={cn(
                "px-4 py-2.5 lg:py-2 rounded-md text-sm font-medium transition-colors",
                focus.ring,
                billing === "monthly"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Monthly
            </button>
            <button
              type="button"
              aria-pressed={billing === "yearly"}
              onClick={() => onBillingChange("yearly")}
              className={cn(
                "px-4 py-2.5 lg:py-2 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2",
                focus.ring,
                billing === "yearly"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Yearly
              <span className="text-[10px] bg-primary/10 text-primary font-semibold px-1.5 py-0.5 rounded">
                -20%
              </span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
