"use client";

import Link from "next/link";
import { ArrowRight, LayoutDashboard, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TOTAL_CHECKS_LABEL, ROUTES } from "@/lib/config/constants";
import { useAuth } from "@/components/providers/auth-provider";

export function LandingHero() {
  const { me } = useAuth();
  const isLoggedIn = !!me?.userId;

  return (
    <section className="bg-background">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 pb-20 sm:pt-24 sm:pb-28">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6 text-balance">
            The complete platform for{" "}
            <span className="text-primary">web security</span>
          </h1>

          <p className="text-base sm:text-lg text-muted-foreground max-w-xl mx-auto mb-10 text-pretty">
            {TOTAL_CHECKS_LABEL} deterministic checks across 12 categories.
            Run a single-page scan in seconds, drop the engine into your CI,
            and stream findings to a webhook.
          </p>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 w-full sm:w-auto">
            {isLoggedIn ? (
              <Link href={ROUTES.DASHBOARD} className="w-full sm:w-auto">
                <Button size="lg" className="h-11 px-6 gap-2 w-full sm:w-auto">
                  <LayoutDashboard className="h-4 w-4" />
                  Go to Dashboard
                </Button>
              </Link>
            ) : (
              <Link href={ROUTES.SIGNUP} className="w-full sm:w-auto">
                <Button size="lg" className="h-11 px-6 gap-2 w-full sm:w-auto">
                  Start Scanning Free
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            )}
            <Link href={ROUTES.DEMO} className="w-full sm:w-auto">
              <Button
                size="lg"
                variant="outline"
                className="h-11 px-6 gap-2 w-full sm:w-auto"
              >
                <Terminal className="h-4 w-4" />
                Live Demo
              </Button>
            </Link>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span>No credit card required</span>
            <span
              aria-hidden
              className="text-muted-foreground/50 select-none"
            >
              ·
            </span>
            <span>Free forever tier</span>
            <span
              aria-hidden
              className="text-muted-foreground/50 select-none"
            >
              ·
            </span>
            <span>Open source · GPL-3.0</span>
          </div>
        </div>
      </div>
    </section>
  );
}
