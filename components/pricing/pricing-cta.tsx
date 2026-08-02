import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/config/constants";
import Link from "next/link";

interface PricingCtaProps {
  isLoggedIn: boolean;
}

export function PricingCta({ isLoggedIn }: PricingCtaProps) {
  return (
    <section className="border-t border-border/50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="grid lg:grid-cols-[1fr_auto] gap-8 items-center">
          <div>
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3">
              Paste a URL. Get a report. No setup required.
            </h2>
            <p className="text-muted-foreground max-w-xl leading-relaxed">
              25 scans per day on the free tier. No credit card, no agent to
              install. When you need more, Core starts at $5/month.
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
