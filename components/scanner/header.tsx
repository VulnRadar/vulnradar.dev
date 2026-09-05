"use client";

import { LogOut, Menu } from "lucide-react";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useMemo, useState } from "react";
import { cn } from "@/lib/ui/utils";
import { APP_NAME, ROUTES, API } from "@/lib/config/client-constants";
import { backdrops, transitions } from "@/lib/ui/animations";
import { ThemedLogo } from "@/components/shared/themed-logo";
import { NotificationBell } from "@/components/shared/notification-center";
import { useAuth, clearAuthCache } from "@/components/providers/auth-provider";
import { useClientConfig } from "@/lib/hooks/use-client-config";
import {
  visibleSurfaces,
  type FeatureSurface,
} from "@/lib/config/feature-surfaces";
import { tourAnchor, type TourAnchor } from "@/lib/tour/anchors";

// Deep-links straight to the Developer tab of the profile page. Scheduled
// scans, Webhooks, Domains, and API keys all live there as sub-tabs
// Badge is a top-level entry; Developer deliberately is not. An earlier
// change added a Developer link (deep-linking to /profile?tab=developer) and
// dropped Badge to make room. The owner wanted the opposite: Badge back, and
// no Developer entry. Scheduled scans, webhooks and API keys stay where they
// live, under Profile. Removing that entry also removed the query-string
// state and soft-navigation handling it needed, which is why this nav no
// longer reads window.location at all.
// `tour` is the product tour's anchor name for the link, declared here rather
// than in the render because both the desktop row and the mobile sheet map over
// this list and the tour has to be able to find whichever one is on screen.
// Only the destinations the tour actually walks through carry one; see
// lib/tour/anchors.ts.
const NAV_LINKS: {
  href: string;
  label: string;
  tour?: TourAnchor;
  /** Client feature flag this destination depends on, if any. */
  feature?: FeatureSurface;
}[] = [
  { href: ROUTES.DASHBOARD, label: "Scanner" },
  { href: ROUTES.HISTORY, label: "History", tour: "navHistory" },
  { href: ROUTES.REPOS, label: "Repos" },
  { href: ROUTES.COMPARE, label: "Compare", tour: "navCompare" },
  { href: ROUTES.SHARES, label: "Shared", tour: "navShares" },
  { href: ROUTES.TEAMS, label: "Teams", tour: "navTeams", feature: "teams" },
  { href: ROUTES.BADGE, label: "Badge" },
  { href: ROUTES.PROFILE, label: "Profile", tour: "navProfile" },
];

export function Header() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isStaff } = useAuth();
  // FEATURE_TEAMS is enforced on every /api/v3/teams route, so with it off the
  // Teams page loaded and then 403'd on its first request: the user found out
  // the deployment has no teams from an error, having already navigated. The
  // flag reads its compiled build-time default until the live config lands, so
  // a deployment that sets flags at build time never changes this row after
  // paint; only an admin-panel override corrects it, once.
  const flags = useClientConfig();
  const navLinks = useMemo(() => visibleSurfaces(NAV_LINKS, flags), [flags]);

  function isNavActive(href: string): boolean {
    const base = href.split("?")[0].split("#")[0];
    return (
      pathname === base ||
      pathname.startsWith(base) ||
      // Public Scans, Assets and Attack Surface are all tabs under History
      // (components/history/history-view-tabs.tsx), not their own
      // top-level section -- the History nav link should read as active
      // there too. Attack Surface was missing from this list, so a
      // top-level destination reachable from the History tab strip lit
      // nothing in the header and read as being outside the app.
      (href === ROUTES.HISTORY &&
        (pathname === ROUTES.PUBLIC_SCANS ||
          pathname === ROUTES.ASSETS ||
          pathname === ROUTES.ATTACK_SURFACE))
    );
  }

  async function handleLogout() {
    clearAuthCache();
    await fetch(API.AUTH.LOGOUT, { method: "POST" });
    // Full page reload instead of soft navigation: ensures all React state
    // (SWR caches, component memory) is wiped before the next user logs in.
    window.location.href = ROUTES.LOGIN;
  }

  return (
    <>
      {/* Spacer so page content isn't hidden under the fixed header. Grows
          by --vr-banner-h (site-notifications.tsx) and --vr-imp-banner-h
          (impersonation-banner.tsx) when either is showing, since the
          header itself shifts down to stay below both rather than
          covering them. */}
      <div
        className="h-[calc(4rem+var(--vr-banner-h,0px)+var(--vr-imp-banner-h,0px))] shrink-0"
        aria-hidden="true"
      />
      <header
        className={`fixed top-[calc(var(--vr-banner-h,0px)+var(--vr-imp-banner-h,0px))] left-0 right-0 z-50 border-b border-border/50 transition-[top] duration-300 ${backdrops.header}`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 relative flex items-center justify-between">
          {/* Logo - left */}
          <Link
            href={ROUTES.DASHBOARD}
            className={`flex items-center gap-2.5 hover:opacity-80 shrink-0 z-10 ${transitions.opacity}`}
            aria-label="Go to scanner"
            onClick={(e) => {
              // If already on dashboard with a ?scan= param (viewing scan results),
              // clear the param and dispatch popstate so the dashboard can reset
              if (pathname === ROUTES.DASHBOARD) {
                const params = new URLSearchParams(window.location.search);
                if (params.has("scan")) {
                  e.preventDefault();
                  window.history.pushState(null, "", ROUTES.DASHBOARD);
                  window.dispatchEvent(new PopStateEvent("popstate"));
                }
              }
            }}
          >
            <ThemedLogo
              width={24}
              height={24}
              className="h-6 w-6"
              alt={`${APP_NAME} logo`}
            />
            <span className="text-lg font-mono font-semibold text-foreground tracking-tight hidden sm:inline">
              {APP_NAME}
            </span>
          </Link>

          {/* Desktop nav - absolutely centered */}
          {/* aria-current is the only machine-readable "you are here" signal:
              the active state was expressed purely as a colour swap, which a
              screen reader cannot see and which fails on its own for anyone
              who cannot distinguish the two greys. */}
          <nav
            aria-label="Main"
            className="hidden lg:flex items-center gap-0.5 absolute left-1/2 -translate-x-1/2"
          >
            {navLinks.map(({ href, label, tour }) => {
              const active = isNavActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  {...(tour ? tourAnchor(tour) : {})}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm transition-colors",
                    active
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted",
                  )}
                >
                  {label}
                </Link>
              );
            })}
            {isStaff && (
              <Link
                href={ROUTES.ADMIN}
                aria-current={pathname === ROUTES.ADMIN ? "page" : undefined}
                className={cn(
                  "px-2 py-1.5 rounded-md text-sm transition-colors",
                  pathname === ROUTES.ADMIN
                    ? "bg-destructive/10 text-destructive font-medium"
                    : "text-destructive/70 hover:text-destructive hover:bg-muted",
                )}
              >
                Admin
              </Link>
            )}
          </nav>

          {/* Right side - pushed to end */}
          <div className="flex items-center gap-1 ml-auto z-10">
            <NotificationBell />
            <ThemeToggle />
            <div className="hidden lg:block w-px h-5 bg-border mx-1" />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="hidden lg:inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground px-2.5"
            >
              <LogOut className="h-4 w-4" />
              <span>Log out</span>
            </Button>
            {/* Mobile hamburger */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileOpen(true)}
              // a11y (SC 4.1.2): the Sheet is opened from local state rather
              // than SheetTrigger, so Radix contributes no aria-expanded and
              // the button reported nothing about the menu it controls. The
              // name also said "Toggle" for a control that only ever opens.
              aria-expanded={mobileOpen}
              aria-haspopup="dialog"
              aria-label="Open menu"
              // 44px below lg. size="icon" is 40px, and this button only
              // exists below lg, where it is the only route to the nav.
              className="lg:hidden h-11 w-11 text-muted-foreground hover:text-foreground"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Mobile overlay menu */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="right" className="w-64">
            <SheetTitle className="sr-only">Navigation menu</SheetTitle>
            {/* The one deliberate override on this band: h-16 lines the sheet's
                header up with the site header bar it slid out from, so the logo
                does not jump when the panel opens. */}
            <SheetHeader className="h-16 flex-row items-center gap-2.5 space-y-0">
              <ThemedLogo
                width={22}
                height={22}
                className="h-5.5 w-5.5"
                alt={`${APP_NAME} logo`}
              />
              <span className="font-mono font-semibold text-foreground tracking-tight">
                {APP_NAME}
              </span>
            </SheetHeader>
            {/* Links */}
            <SheetBody className="p-3">
              <nav aria-label="Mobile" className="flex flex-col gap-0.5">
                {navLinks.map(({ href, label, tour }) => {
                  const active = isNavActive(href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      aria-current={active ? "page" : undefined}
                      {...(tour ? tourAnchor(tour) : {})}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors",
                        active
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted",
                      )}
                    >
                      {label}
                    </Link>
                  );
                })}
                {isStaff && (
                  <Link
                    href={ROUTES.ADMIN}
                    aria-current={
                      pathname === ROUTES.ADMIN ? "page" : undefined
                    }
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center px-3 py-2 rounded-md text-sm transition-colors",
                      pathname === ROUTES.ADMIN
                        ? "bg-destructive/10 text-destructive font-medium"
                        : "text-destructive/70 hover:text-destructive hover:bg-muted",
                    )}
                  >
                    Admin
                  </Link>
                )}
              </nav>
            </SheetBody>
            <SheetFooter className="p-3">
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <LogOut className="h-4 w-4" />
                Log out
              </button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </header>
    </>
  );
}
