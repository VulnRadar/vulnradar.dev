"use client";

import { LogOut, Menu } from "lucide-react";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useState, useEffect, type MouseEvent } from "react";
import { setQueryParams, QUERY_CHANGE_EVENT } from "@/lib/ui/url-state";
import { cn } from "@/lib/ui/utils";
import { APP_NAME, ROUTES, API } from "@/lib/config/constants";
import { backdrops, transitions } from "@/lib/ui/animations";
import { ThemedLogo } from "@/components/shared/themed-logo";
import { NotificationBell } from "@/components/shared/notification-center";
import { useAuth, clearAuthCache } from "@/components/providers/auth-provider";

// Deep-links straight to the Developer tab of the profile page. Scheduled
// scans, Webhooks, Domains, and API keys all live there as sub-tabs
// (components/profile/tabs/profile-developer-tab.tsx) but had no top-level
// entry, so recurring monitoring -- the whole point of a scheduled scan --
// was two clicks deep under Profile and effectively undiscoverable.
const DEVELOPER_HREF = `${ROUTES.PROFILE}?tab=developer`;

const NAV_LINKS = [
  { href: ROUTES.DASHBOARD, label: "Scanner" },
  { href: ROUTES.HISTORY, label: "History" },
  { href: ROUTES.REPOS, label: "Repos" },
  { href: ROUTES.COMPARE, label: "Compare" },
  { href: ROUTES.SHARES, label: "Shared" },
  { href: ROUTES.TEAMS, label: "Teams" },
  { href: ROUTES.BADGE, label: "Badge" },
  { href: ROUTES.PROFILE, label: "Profile" },
];

export function Header() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isStaff } = useAuth();

  // The Developer and Profile links both point under /profile, told apart
  // only by the ?tab=developer query. usePathname() drops the query, so the
  // active state reads it off the URL directly. Seeded empty (matches SSR)
  // and synced on mount / navigation to avoid a hydration mismatch.
  const [locationSearch, setLocationSearch] = useState("");
  useEffect(() => {
    const sync = () => setLocationSearch(window.location.search);
    sync();
    // popstate covers back/forward; QUERY_CHANGE_EVENT covers the profile
    // page's own tab switches (and the Developer nav click below), both of
    // which move the tab via history.pushState without a popstate.
    window.addEventListener("popstate", sync);
    window.addEventListener(QUERY_CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(QUERY_CHANGE_EVENT, sync);
    };
  }, [pathname]);
  const onDeveloperTab =
    pathname === ROUTES.PROFILE && locationSearch.includes("tab=developer");

  // The Developer entry deep-links to /profile?tab=developer. Arriving from
  // another page, a normal navigation mounts the profile page fresh and it
  // reads the tab from the URL. But when the user is already on /profile,
  // the tab is driven by useQueryParam (window.location + QUERY_CHANGE_EVENT,
  // see lib/ui/url-state.ts), which a soft <Link> navigation does not feed --
  // so switch the tab the same way the profile sidebar does, via
  // setQueryParams, rather than letting the URL change with the tab stuck.
  function handleNavClick(href: string, e: MouseEvent) {
    if (href !== DEVELOPER_HREF) return;
    // Let modified clicks (open in new tab, etc.) behave normally.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
      return;
    }
    if (pathname !== ROUTES.PROFILE) return;
    e.preventDefault();
    setQueryParams({ tab: "developer", dtab: null });
    setLocationSearch(window.location.search);
  }

  function isNavActive(href: string): boolean {
    if (href === DEVELOPER_HREF) return onDeveloperTab;
    const base = href.split("?")[0].split("#")[0];
    // Profile stays lit for the rest of /profile.
    if (href === ROUTES.PROFILE) {
      return pathname.startsWith(base);
    }
    return (
      pathname === base ||
      pathname.startsWith(base) ||
      // Public Scans and Assets are both tabs under History
      // (components/history/history-view-tabs.tsx), not their own
      // top-level section -- the History nav link should read as active
      // there too.
      (href === ROUTES.HISTORY &&
        (pathname === ROUTES.PUBLIC_SCANS || pathname === ROUTES.ASSETS))
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
          <nav className="hidden lg:flex items-center gap-0.5 absolute left-1/2 -translate-x-1/2">
            {NAV_LINKS.map(({ href, label }) => {
              const active = isNavActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={(e) => handleNavClick(href, e)}
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
                className={cn(
                  "px-2.5 py-1.5 rounded-md text-sm transition-colors",
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
              aria-label="Toggle menu"
              className="lg:hidden text-muted-foreground hover:text-foreground"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Mobile overlay menu */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            side="right"
            className="w-64 bg-background p-0 border-l border-border flex flex-col"
          >
            <SheetTitle className="sr-only">Navigation menu</SheetTitle>
            {/* Sheet header */}
            <div className="flex items-center gap-2.5 px-4 h-16 border-b border-border shrink-0">
              <ThemedLogo
                width={22}
                height={22}
                className="h-5.5 w-5.5"
                alt={`${APP_NAME} logo`}
              />
              <span className="font-mono font-semibold text-foreground tracking-tight">
                {APP_NAME}
              </span>
            </div>
            {/* Links */}
            <nav className="flex flex-col gap-0.5 p-3 flex-1 overflow-y-auto">
              {NAV_LINKS.map(({ href, label }) => {
                const active = isNavActive(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={(e) => {
                      handleNavClick(href, e);
                      setMobileOpen(false);
                    }}
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
            {/* Footer */}
            <div className="p-3 border-t border-border shrink-0">
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Log out
              </button>
            </div>
          </SheetContent>
        </Sheet>
      </header>
    </>
  );
}
