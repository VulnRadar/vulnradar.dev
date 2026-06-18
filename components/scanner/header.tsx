"use client"

import { LogOut, Menu } from "lucide-react"
import { ThemeToggle } from "@/components/shared/theme-toggle"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { useRouter, usePathname } from "next/navigation"
import Link from "next/link"
import { useState } from "react"
import { cn } from "@/lib/ui/utils"
import { APP_NAME, ROUTES, API } from "@/lib/config/constants"
import { backdrops, transitions } from "@/lib/ui/animations"
import { ThemedLogo } from "@/components/shared/themed-logo"
import { NotificationBell } from "@/components/shared/notification-center"
import { useAuth, clearAuthCache } from "@/components/providers/auth-provider"

const NAV_LINKS = [
  { href: ROUTES.DASHBOARD, label: "Scanner" },
  { href: ROUTES.HISTORY, label: "History" },
  { href: ROUTES.COMPARE, label: "Compare" },
  { href: ROUTES.SHARES, label: "Shared" },
  { href: ROUTES.TEAMS, label: "Teams" },
  { href: ROUTES.BADGE, label: "Badge" },
  { href: ROUTES.PROFILE, label: "Profile" },
]

export function Header() {
  const router = useRouter()
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { isStaff } = useAuth()

  async function handleLogout() {
    clearAuthCache()
    await fetch(API.AUTH.LOGOUT, { method: "POST" })
    router.push(ROUTES.LOGIN)
    router.refresh()
  }

  return (
    <>
      {/* Spacer so page content isn't hidden under the fixed header */}
      <div className="h-16 shrink-0" aria-hidden="true" />
      <header className={`fixed top-0 left-0 right-0 z-50 border-b border-border/50 ${backdrops.header}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 relative flex items-center justify-between">
          {/* Logo - left */}
          <Link
              href={ROUTES.DASHBOARD}
              className={`flex items-center gap-2.5 hover:opacity-80 shrink-0 z-10 ${transitions.opacity}`}
              aria-label="Go to scanner"
              onClick={(e) => {
                // If already on dashboard with a hash (viewing scan results), 
                // clear the hash and dispatch hashchange event to reset state
                if (pathname === ROUTES.DASHBOARD && window.location.hash) {
                  e.preventDefault()
                  // Clear hash first, then dispatch event
                  const prevHash = window.location.hash
                  window.history.pushState(null, "", ROUTES.DASHBOARD)
                  // Dispatch hashchange so the dashboard component can reset
                  window.dispatchEvent(new HashChangeEvent("hashchange", {
                    oldURL: window.location.href.replace(ROUTES.DASHBOARD, ROUTES.DASHBOARD + prevHash),
                    newURL: window.location.href
                  }))
                }
              }}
          >
            <ThemedLogo width={24} height={24} className="h-6 w-6" alt={`${APP_NAME} logo`} />
            <span className="text-lg font-semibold text-foreground tracking-tight hidden sm:inline">
              {APP_NAME}
            </span>
          </Link>

          {/* Desktop nav - absolutely centered */}
          <nav className="hidden lg:flex items-center gap-0.5 absolute left-1/2 -translate-x-1/2">
            {NAV_LINKS.map(({ href, label }) => {
              const active = pathname === href || pathname.startsWith(href.split("#")[0])
              return (
                  <Link
                      key={href}
                      href={href}
                      className={cn(
                          "px-2.5 py-1.5 rounded-md text-sm transition-colors",
                          active
                              ? "bg-primary/10 text-primary font-medium"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted",
                      )}
                  >
                    {label}
                  </Link>
              )
            })}
            <Link
                href={ROUTES.ADMIN}
                className={cn(
                    "vr-staff-only px-2.5 py-1.5 rounded-md text-sm transition-colors",
                    isStaff && "!inline-flex",
                    pathname === ROUTES.ADMIN
                        ? "bg-destructive/10 text-destructive font-medium"
                        : "text-destructive/70 hover:text-destructive hover:bg-muted",
                )}
            >
              Admin
            </Link>
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
          <SheetContent side="right" className="w-64 bg-background p-0 border-l border-border flex flex-col">
            <SheetTitle className="sr-only">Navigation menu</SheetTitle>
            {/* Sheet header */}
            <div className="flex items-center gap-2.5 px-4 h-16 border-b border-border shrink-0">
              <ThemedLogo width={22} height={22} className="h-5.5 w-5.5" alt={`${APP_NAME} logo`} />
              <span className="font-semibold text-foreground tracking-tight">{APP_NAME}</span>
            </div>
            {/* Links */}
            <nav className="flex flex-col gap-0.5 p-3 flex-1 overflow-y-auto">
              {NAV_LINKS.map(({ href, label }) => {
                const active = pathname === href || pathname.startsWith(href.split("#")[0])
                return (
                    <Link
                        key={href}
                        href={href}
                        onClick={() => setMobileOpen(false)}
                        className={cn(
                            "flex items-center px-3 py-2 rounded-md text-sm transition-colors",
                            active
                                ? "bg-primary/10 text-primary font-medium"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted",
                        )}
                    >
                      {label}
                    </Link>
                )
              })}
              <Link
                  href={ROUTES.ADMIN}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                      "vr-staff-only px-3 py-2 rounded-md text-sm transition-colors",
                      isStaff && "!flex",
                      pathname === ROUTES.ADMIN
                          ? "bg-destructive/10 text-destructive font-medium"
                          : "text-destructive/70 hover:text-destructive hover:bg-muted",
                  )}
              >
                Admin
              </Link>
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
  )
}
