import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROUTES, BILLING_PLAN_LIMITS } from "@/lib/config/constants";
import { PLANS } from "@/lib/billing/plans";
import Link from "next/link";

interface PricingCtaProps {
  isLoggedIn: boolean;
}

const CHEAPEST_PAID = PLANS.find((p) => p.priceInCents > 0);

export function PricingCta({ isLoggedIn }: PricingCtaProps) {
  return (
    <section className="border-t border-border/50 bg-muted/30">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-8 items-center">
          <div>
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3 text-balance">
              Paste a URL. Get a report. Decide later.
            </h2>
            <p className="text-muted-foreground max-w-xl leading-relaxed">
              {BILLING_PLAN_LIMITS.free} scans a day on the free tier, no card,
              no agent to install.
              {CHEAPEST_PAID
                ? ` ${CHEAPEST_PAID.name.replace(" Supporter", "")} starts at $${CHEAPEST_PAID.priceInCents / 100} a month when you need more.`
                : ""}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row lg:flex-col gap-3 shrink-0">
            <Link href={isLoggedIn ? ROUTES.DASHBOARD : ROUTES.SIGNUP}>
              <Button size="lg" className="h-11 px-6 gap-2 w-full">
                {isLoggedIn ? "Go to Scanner" : "Start scanning free"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href={ROUTES.DOCS}>
              <Button size="lg" variant="outline" className="h-11 px-6 w-full">
                Read the docs
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
