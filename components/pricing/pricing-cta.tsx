import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/config/constants";
import Link from "next/link";

interface PricingCtaProps {
  isLoggedIn: boolean;
}

export function PricingCta({ isLoggedIn }: PricingCtaProps) {
  return (
    <section className="border-t border-border/50 bg-muted/20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 text-center">
        <h2 className="text-2xl sm:text-3xl font-bold mb-4 tracking-tight">
          Ready to secure your applications?
        </h2>
        <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
          Start scanning for free today. No credit card required.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link href={isLoggedIn ? ROUTES.DASHBOARD : ROUTES.SIGNUP}>
            <Button size="lg" className="h-11 px-6 gap-2">
              {isLoggedIn ? "Go to Scanner" : "Get Started Free"}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link href={ROUTES.DOCS}>
            <Button size="lg" variant="outline" className="h-11 px-6">
              Documentation
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
