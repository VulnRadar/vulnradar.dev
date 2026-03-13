"use client"

import { LogOut, Menu, ShieldAlert } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { useRouter, usePathname } from "next/navigation"
import Link from "next/link"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { APP_NAME, ROUTES, API } from "@/lib/constants"
import { ThemedLogo } from "@/components/themed-logo"
import { NotificationBell } from "@/components/notification-center"
import { useAuth, clearAuthCache } from "@/components/auth-provider"

const NAV_LINKS = [
  { href: ROUTES.DASHBOARD, label: "Scanner" },
  { href: ROUTES.HISTORY, label: "History" },
  { href: ROUTES.COMPARE, label: "Compare" },
  { href: ROUTES.SHARES, label: "Shared" },
  { href: ROUTES.TEAMS, label: "Teams" },
  { href: ROUTES.BADGE, label: "Badge" },
  { href: ROUTES.DOCS, label: "Docs" },
  { href: ROUTES.PROFILE, label: "Profile" },
]

export function Header() {
  const router = useRouter()
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { me, isStaff } = useAuth()

  async function handleLogout() {
    clearAuthCache()
    await fetch(API.AUTH.LOGOUT, { method: "POST" })
    router.push(ROUTES.LOGIN)
    router.refresh()
  }

  return (
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 relative flex items-center">
          {/* Logo - left */}
          <Link
              href={ROUTES.DASHBOARD}
              className="flex items-center gap-2.5 hover:opacity-80 transition-opacity shrink-0 z-10"
              aria-label="Go to scanner"
          >
            <ThemedLogo width={24} height={24} className="h-6 w-6" alt={`${APP_NAME} logo`} />
            <span className="text-lg font-semibold text-foreground tracking-tight hidden sm:inline">
              {APP_NAME}
            </span>
          </Link>

          {/* Desktop nav - absolutely centered */}
          <nav className="hidden lg:flex items-center gap-0.5 absolute left-1/2 -translate-x-1/2">
            {NAV_LINKS.map(({ href, label }) => {
              const active = href === ROUTES.DOCS
                  ? pathname.startsWith(ROUTES.DOCS)
                  : pathname === href || pathname.startsWith(href.split("#")[0])
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
                const active = href === ROUTES.DOCS ? pathname.startsWith(ROUTES.DOCS) : pathname === href || pathname.startsWith(href.split("#")[0])
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
  )
}
