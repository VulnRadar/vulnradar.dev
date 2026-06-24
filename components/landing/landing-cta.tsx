"use client";

import Link from "next/link";
import { ArrowRight, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_NAME, BILLING_ENABLED, ROUTES } from "@/lib/config/constants";
import { useAuth } from "@/components/providers/auth-provider";

export function LandingCta() {
  const { me } = useAuth();
  const isLoggedIn = !!me?.userId;

  return (
    <section className="border-t border-border/50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 min-w-0">
        <div className="rounded-2xl border border-border/50 bg-card p-6 sm:p-12 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4 tracking-tight text-balance">
            {isLoggedIn
              ? "Continue securing your applications"
              : "Ready to secure your applications?"}
          </h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto text-pretty">
            {isLoggedIn
              ? `Head to your dashboard to start scanning with ${APP_NAME}.`
              : `${APP_NAME} is open source, self-hostable, and free to try. No credit card, no agent to install. Just paste a URL.`}
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
                  Get Started Free
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            )}
            {BILLING_ENABLED && !isLoggedIn && (
              <Link href={ROUTES.PRICING} className="w-full sm:w-auto">
                <Button
                  size="lg"
                  variant="outline"
                  className="h-11 px-6 w-full sm:w-auto"
                >
                  View Pricing
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
