"use client";

import Link from "next/link";
import { ArrowRight, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BILLING_ENABLED, ROUTES } from "@/lib/config/client-constants";
import { useAuth } from "@/components/providers/auth-provider";

interface LandingCtaProps {
  freeScansPerDay: number;
}

export function LandingCta({ freeScansPerDay }: LandingCtaProps) {
  const { me } = useAuth();
  const isLoggedIn = !!me?.userId;

  return (
    <section className="border-t border-border/50 bg-muted/30">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-8 lg:gap-12 items-center">
          {isLoggedIn ? (
            <>
              <div>
                <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3">
                  Back to the scanner
                </h2>
                <p className="text-muted-foreground leading-relaxed max-w-xl">
                  Your history, saved scans, API keys, and scheduled runs are
                  all one click away.
                </p>
              </div>
              <Link href={ROUTES.DASHBOARD} className="shrink-0">
                <Button size="lg" className="h-11 px-6 gap-2 w-full">
                  <LayoutDashboard className="h-4 w-4" />
                  Go to Dashboard
                </Button>
              </Link>
            </>
          ) : (
            <>
              <div>
                <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3 text-balance">
                  Paste a URL and see what comes back
                </h2>
                <p className="text-muted-foreground leading-relaxed max-w-xl">
                  {BILLING_ENABLED
                    ? `${freeScansPerDay} scans a day on the free tier, no card. The demo needs no account at all.`
                    : "No card, no limit on this deployment. The demo needs no account at all."}
                </p>
              </div>
              <div className="flex flex-col sm:flex-row lg:flex-col gap-3 shrink-0">
                <Link href={ROUTES.SIGNUP}>
                  <Button size="lg" className="h-11 px-6 gap-2 w-full">
                    Create a free account
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link href={ROUTES.DEMO}>
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-11 px-6 w-full"
                  >
                    Try the demo first
                  </Button>
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
