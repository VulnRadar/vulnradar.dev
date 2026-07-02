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
    <section className="py-16 sm:py-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 text-center">
        {isLoggedIn ? (
          <>
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3">
              Back to the scanner
            </h2>
            <p className="text-muted-foreground mb-7 max-w-lg mx-auto leading-relaxed">
              Your dashboard is one click away.
            </p>
            <Link href={ROUTES.DASHBOARD}>
              <Button size="lg" className="h-11 px-6 gap-2">
                <LayoutDashboard className="h-4 w-4" />
                Go to Dashboard
              </Button>
            </Link>
          </>
        ) : (
          <>
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3">
              Start scanning
            </h2>
            <p className="text-muted-foreground mb-7 max-w-lg mx-auto leading-relaxed">
              {APP_NAME} is free to use, open source, and self-hostable. Paste a
              URL in the demo to see a real report without creating an account,
              or sign up to save results and connect the API.
            </p>
            <div className="flex flex-wrap gap-3 items-center justify-center">
              <Link href={ROUTES.SIGNUP}>
                <Button size="lg" className="h-11 px-6 gap-2">
                  Create a free account
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href={ROUTES.DEMO}>
                <Button size="lg" variant="outline" className="h-11 px-6">
                  Try the demo first
                </Button>
              </Link>
              {BILLING_ENABLED && (
                <Link href={ROUTES.PRICING}>
                  <Button size="lg" variant="ghost" className="h-11 px-5">
                    View pricing
                  </Button>
                </Link>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
