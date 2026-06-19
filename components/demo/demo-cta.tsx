"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, LayoutDashboard } from "lucide-react";
import { ROUTES } from "@/lib/config/constants";
import { useAuth } from "@/components/providers/auth-provider";

export function DemoCTA() {
  const { me } = useAuth();
  const isLoggedIn = !!me?.userId;

  return (
    <section className="py-16 sm:py-20 border-t border-border/50 bg-muted/30">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center max-w-xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-4">
            {isLoggedIn ? "Scan your own sites" : "Ready for more?"}
          </h2>
          <p className="text-base text-muted-foreground mb-8">
            {isLoggedIn
              ? "Head to your dashboard to scan your own sites, track history, and access the full API."
              : "Create a free account to scan your own sites, track history, and access the full API."}
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            {isLoggedIn ? (
              <Link href={ROUTES.DASHBOARD}>
                <Button size="lg" className="h-11 px-6 gap-2">
                  <LayoutDashboard className="h-4 w-4" />
                  Go to Dashboard
                </Button>
              </Link>
            ) : (
              <>
                <Link href={ROUTES.SIGNUP}>
                  <Button size="lg" className="h-11 px-6 gap-2">
                    Get Started Free
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link href={ROUTES.PRICING}>
                  <Button size="lg" variant="outline" className="h-11 px-6">
                    View Pricing
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
