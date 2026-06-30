"use client";

import Link from "next/link";
import { ArrowRight, Globe, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROUTES, TOTAL_CHECKS_LABEL } from "@/lib/config/constants";
import { useAuth } from "@/components/providers/auth-provider";

export function LandingHero() {
  const { me } = useAuth();
  const isLoggedIn = !!me?.userId;

  return (
    <section className="bg-background pt-12 pb-16 sm:pt-16 sm:pb-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid lg:grid-cols-[1fr_420px] gap-12 lg:gap-20 items-center">
          {/* Left: headline + copy + buttons */}
          <div>
            <h1 className="text-4xl sm:text-5xl lg:text-[3.5rem] font-bold tracking-tight leading-[1.08] mb-6 text-balance">
              Scan any website
              <br />
              for security issues.
            </h1>

            <p className="text-base sm:text-lg text-muted-foreground leading-relaxed mb-8 max-w-xl">
              {TOTAL_CHECKS_LABEL} deterministic checks across headers, TLS,
              cookies, DNS, secrets, and more. Runs from our servers, not yours.
              Results in under 3 seconds, no agent to install.
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
                <Button
                  size="lg"
                  variant="outline"
                  className="h-11 px-6"
                >
                  Try the demo
                </Button>
              </Link>
            </div>
          </div>

          {/* Right: URL scanner + quick facts */}
          <div className="space-y-5">
            {/* URL input mockup - links to demo */}
            <Link href={ROUTES.DEMO} className="block group">
              <div className="rounded-lg border border-border bg-card p-4 group-hover:border-primary/50 transition-colors">
                <p className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider mb-2.5">
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

            {/* Quick facts */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { n: "739", label: "checks" },
                { n: "12", label: "categories" },
                { n: "<3s", label: "per scan" },
                { n: "GPL-3.0", label: "license" },
              ].map((f) => (
                <div
                  key={f.label}
                  className="px-3.5 py-3 rounded-lg border border-border/50 bg-card/50"
                >
                  <span className="block text-lg font-bold tabular-nums leading-none mb-0.5">
                    {f.n}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {f.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
