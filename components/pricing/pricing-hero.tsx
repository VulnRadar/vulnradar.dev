"use client";

import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/ui/utils";

interface PricingHeroProps {
  billing: "monthly" | "yearly";
  onBillingChange: (billing: "monthly" | "yearly") => void;
}

export function PricingHero({ billing, onBillingChange }: PricingHeroProps) {
  return (
    <section className="relative">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 pb-12 sm:pt-20">
        <div className="text-center max-w-2xl mx-auto">
          <Badge
            variant="outline"
            className="mb-5 gap-1.5 py-1 px-3 border-primary/30 bg-primary/5 text-xs"
          >
            <Sparkles className="h-3 w-3 text-primary" />
            Simple, transparent pricing
          </Badge>

          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-5 text-balance">
            Plans that scale{" "}
            <span className="text-muted-foreground">with you</span>
          </h1>

          <p className="text-base sm:text-lg text-muted-foreground max-w-xl mx-auto mb-8 text-pretty">
            Start free, upgrade when you need more. All plans include our full
            vulnerability detection suite.
          </p>

          {/* Billing Toggle */}
          <div className="inline-flex items-center gap-0.5 p-1 rounded-lg bg-muted/50 border border-border/50">
            <button
              onClick={() => onBillingChange("monthly")}
              className={cn(
                "px-4 py-2 rounded-md text-sm font-medium transition-all",
                billing === "monthly"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Monthly
            </button>
            <button
              onClick={() => onBillingChange("yearly")}
              className={cn(
                "px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2",
                billing === "yearly"
                  ? "bg-background text-foreground shadow-sm"
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
