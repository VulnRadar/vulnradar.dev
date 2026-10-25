"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, LayoutDashboard } from "lucide-react";
import { BILLING_ENABLED, ROUTES } from "@/lib/config/client-constants";
import { useAuth } from "@/components/providers/auth-provider";

export function DemoCTA() {
  const { me } = useAuth();
  const isLoggedIn = !!me?.userId;

  return (
    // The same closing band /pricing ends on. It was a border-t over a
    // bg-muted/30 wash with square buttons, so the one block on each page that
    // asks for the signup looked like two different designs.
    <section className="tile-contrast">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-8 items-center">
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
              <Button
                asChild
                size="lg"
                shape="pill"
                className="h-11 px-6 gap-2 w-full"
              >
                <Link href={ROUTES.DASHBOARD}>
                  <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                  Go to Dashboard
                </Link>
              </Button>
            ) : (
              <>
                <Button
                  asChild
                  size="lg"
                  shape="pill"
                  className="h-11 px-6 gap-2 w-full"
                >
                  <Link href={ROUTES.SIGNUP}>
                    Create a free account
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
                {BILLING_ENABLED && (
                  <Button
                    asChild
                    size="lg"
                    shape="pill"
                    variant="outline"
                    className="h-11 px-6 w-full"
                  >
                    <Link href={ROUTES.PRICING}>See the limits</Link>
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
