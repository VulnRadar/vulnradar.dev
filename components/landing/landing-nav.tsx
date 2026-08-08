"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, LayoutDashboard, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_NAME, BILLING_ENABLED, ROUTES } from "@/lib/config/constants";
import { ThemedLogo } from "@/components/shared/themed-logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { backdrops, focus, transitions } from "@/lib/ui/animations";
import { cn } from "@/lib/ui/utils";
import { useAuth } from "@/components/providers/auth-provider";

interface LandingNavProps {
  /** Short label rendered beside the wordmark, e.g. "Staff", "Shared report". */
  badge?: string;
}

function navLinks() {
  return [
    ...(BILLING_ENABLED ? [{ href: ROUTES.PRICING, label: "Pricing" }] : []),
    { href: ROUTES.DOCS, label: "Docs" },
    { href: ROUTES.DEMO, label: "Demo" },
    { href: ROUTES.CHANGELOG, label: "Changelog" },
  ];
}

export function LandingNav({ badge }: LandingNavProps) {
  const { me, isLoading } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isLoggedIn = !!me?.userId;
  const links = navLinks();

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <>
      <nav
        className={cn(
          // top offset matches the fixed site-banner's real height (0 when
          // no banner is showing) via --vr-banner-h, set in
          // site-notifications.tsx -- otherwise a banner overlaps this nav
          // instead of sitting above it.
          "sticky top-[var(--vr-banner-h,0px)] z-50 border-b border-border/50 transition-[top] duration-300",
          backdrops.header,
        )}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-6">
          <Link
            href={ROUTES.HOME}
            className={cn(
              "flex items-center gap-2.5 shrink-0 rounded-sm",
              focus.ring,
            )}
          >
            <ThemedLogo
              width={26}
              height={26}
              className="h-6 w-6"
              alt={`${APP_NAME} logo`}
            />
            <span className="font-mono font-semibold text-base tracking-tight">
              {APP_NAME}
            </span>
            {badge && (
              <span className="hidden sm:inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                {badge}
              </span>
            )}
          </Link>

          <div className="hidden md:flex items-center gap-6">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive(link.href) ? "page" : undefined}
                className={cn(
                  "text-sm rounded-sm",
                  transitions.colors,
                  focus.ring,
                  isActive(link.href)
                    ? "text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <div className="hidden sm:block">
              <ThemeToggle />
            </div>

            {isLoading ? (
              <div className="h-8 w-24 rounded bg-muted/50 animate-pulse" />
            ) : isLoggedIn ? (
              <Link href={ROUTES.DASHBOARD}>
                <Button size="sm" className="h-8 gap-1.5">
                  <LayoutDashboard className="h-3.5 w-3.5" />
                  Dashboard
                </Button>
              </Link>
            ) : (
              <>
                <Link href={ROUTES.LOGIN}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="hidden sm:inline-flex h-8"
                  >
                    Log in
                  </Button>
                </Link>
                <Link href={ROUTES.SIGNUP}>
                  <Button size="sm" className="h-8 gap-1.5">
                    Get Started
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              </>
            )}

            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="landing-nav-mobile"
              aria-label={open ? "Close menu" : "Open menu"}
              className={cn(
                "md:hidden inline-flex items-center justify-center h-8 w-8 rounded-md border border-border text-muted-foreground hover:text-foreground",
                transitions.colors,
                focus.ring,
              )}
            >
              {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {open && (
          <div
            id="landing-nav-mobile"
            className="md:hidden border-t border-border/50 bg-background"
          >
            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex flex-col">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive(link.href) ? "page" : undefined}
                  className={cn(
                    "py-2.5 text-sm rounded-sm",
                    transitions.colors,
                    focus.ring,
                    isActive(link.href)
                      ? "text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {link.label}
                </Link>
              ))}
              <div className="flex items-center justify-between gap-3 pt-3 mt-1 border-t border-border/50">
                <ThemeToggle />
                {!isLoading && !isLoggedIn && (
                  <Link href={ROUTES.LOGIN} onClick={() => setOpen(false)}>
                    <Button variant="outline" size="sm" className="h-8">
                      Log in
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          </div>
        )}
      </nav>
      {/* position: sticky reserves flow space at the nav's UNSHIFTED height
          only -- the extra top-[var(--vr-banner-h)] offset that pushes the
          nav down below a banner is a paint-only shift, so without this the
          nav visually overlaps whatever comes right after it in the page. */}
      <div
        className="h-[var(--vr-banner-h,0px)] transition-[height] duration-300"
        aria-hidden="true"
      />
    </>
  );
}
