import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROUTES, BILLING_PLAN_LIMITS } from "@/lib/config/client-constants";
import { PLANS } from "@/lib/billing/plans";
import Link from "next/link";

interface PricingCtaProps {
  isLoggedIn: boolean;
}

const CHEAPEST_PAID = PLANS.find((p) => p.priceInCents > 0);

export function PricingCta({ isLoggedIn }: PricingCtaProps) {
  return (
    // The page's one strong surface step, and the conversion point, so it is
    // the band that should stop someone. It was a border-t over a bg-muted/30
    // wash, which is not a step on the tile ladder and so did not re-pitch the
    // way tile-contrast does between the themes.
    <section className="tile-contrast">
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
            <Button
              asChild
              size="lg"
              shape="pill"
              className="h-11 px-6 gap-2 w-full"
            >
              <Link href={isLoggedIn ? ROUTES.DASHBOARD : ROUTES.SIGNUP}>
                {isLoggedIn ? "Go to Scanner" : "Start scanning free"}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              shape="pill"
              variant="outline"
              className="h-11 px-6 w-full"
            >
              <Link href={ROUTES.DOCS}>Read the docs</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
