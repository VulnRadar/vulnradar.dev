"use client";

import Link from "next/link";
import { ArrowRight, Globe, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/config/constants";
import { useAuth } from "@/components/providers/auth-provider";

export function LandingHero() {
  const { me } = useAuth();
  const isLoggedIn = !!me?.userId;

  return (
    <section className="bg-background pt-12 pb-16 sm:pt-16 sm:pb-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid lg:grid-cols-[1fr_400px] gap-12 lg:gap-20 items-center">
          {/* Left: headline + stats + copy + buttons */}
          <div>
            <h1 className="text-4xl sm:text-5xl lg:text-[3.5rem] font-semibold tracking-tight leading-[1.08] mb-4 text-balance">
              Scan any website
              <br />
              for security issues.
            </h1>

            {/* Inline stats strip — not 4 equal cards */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-6 text-sm">
              <span className="font-mono font-semibold tabular-nums">739</span>
              <span className="text-muted-foreground">checks</span>
              <span className="text-border/60 select-none">·</span>
              <span className="font-mono font-semibold tabular-nums">12</span>
              <span className="text-muted-foreground">categories</span>
              <span className="text-border/60 select-none">·</span>
              <span className="font-mono font-semibold tabular-nums">
                &lt;3s
              </span>
              <span className="text-muted-foreground">per scan</span>
              <span className="text-border/60 select-none">·</span>
              <span className="font-mono font-semibold text-muted-foreground">
                GPL-3.0
              </span>
            </div>

            <p className="text-base sm:text-lg text-muted-foreground leading-relaxed mb-8 max-w-xl">
              Deterministic checks across headers, TLS, cookies, DNS, secrets,
              and more. Runs from our servers, not yours. No agent to install.
            </p>

            <div className="flex flex-wrap gap-3">
              {isLoggedIn ? (
                <Link href={ROUTES.DASHBOARD}>
                  <Button size="lg" className="h-11 px-6 gap-2">
                    <LayoutDashboard className="h-4 w-4" />
                    Go to Dashboard
                  </Button>
                </Link>
              ) : (
                <Link href={ROUTES.SIGNUP}>
                  <Button size="lg" className="h-11 px-6 gap-2">
                    Start scanning free
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              )}
              <Link href={ROUTES.DEMO}>
                <Button size="lg" variant="outline" className="h-11 px-6">
                  Try the demo
                </Button>
              </Link>
            </div>
          </div>

          {/* Right: URL scanner mockup */}
          <Link href={ROUTES.DEMO} className="block group">
            <div className="rounded-lg border border-border bg-card p-4 group-hover:border-primary/50 transition-colors">
              <p className="text-[11px] font-mono font-medium text-muted-foreground/60 uppercase tracking-wider mb-2.5">
                Enter any URL
              </p>
              <div className="flex items-center gap-2.5 h-10 px-3 rounded-md border border-border/60 bg-background group-hover:border-primary/30 transition-colors">
                <Globe className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                <span className="flex-1 text-sm text-muted-foreground/40 font-mono">
                  https://your-site.com
                </span>
                <span className="text-xs font-medium text-primary shrink-0">
                  Scan →
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground/50 mt-2.5">
                No account needed for the demo
              </p>
            </div>
          </Link>
        </div>
      </div>
    </section>
  );
}
