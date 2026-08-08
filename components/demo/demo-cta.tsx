"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, LayoutDashboard } from "lucide-react";
import { BILLING_ENABLED, ROUTES } from "@/lib/config/constants";
import { useAuth } from "@/components/providers/auth-provider";

export function DemoCTA() {
  const { me } = useAuth();
  const isLoggedIn = !!me?.userId;

  return (
    <section className="border-t border-border/50 bg-muted/30">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_auto] gap-8 items-center">
          <div>
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3 text-balance">
              {isLoggedIn
                ? "Now point it at something you own"
                : "That was our site. Try yours."}
            </h2>
            <p className="text-muted-foreground leading-relaxed max-w-xl">
              {isLoggedIn
                ? "The dashboard scans any URL you control, keeps the history, and hands the same results to the API."
                : "An account gets you your own URLs, saved history you can diff against later, and an API token for CI."}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row lg:flex-col gap-3 shrink-0">
            {isLoggedIn ? (
              <Link href={ROUTES.DASHBOARD}>
                <Button size="lg" className="h-11 px-6 gap-2 w-full">
                  <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                  Go to Dashboard
                </Button>
              </Link>
            ) : (
              <>
                <Link href={ROUTES.SIGNUP}>
                  <Button size="lg" className="h-11 px-6 gap-2 w-full">
                    Create a free account
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </Link>
                {BILLING_ENABLED && (
                  <Link href={ROUTES.PRICING}>
                    <Button
                      size="lg"
                      variant="outline"
                      className="h-11 px-6 w-full"
                    >
                      See the limits
                    </Button>
                  </Link>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
