"use client"

import { LogOut, User, Clock, Book, Menu, GitCompareArrows, ShieldAlert, Users, Radar, BadgeCheck, Link2 } from "lucide-react"
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
  { href: ROUTES.DASHBOARD, label: "Scanner", icon: Radar },
  { href: ROUTES.HISTORY, label: "History", icon: Clock },
  { href: ROUTES.COMPARE, label: "Compare", icon: GitCompareArrows },
  { href: ROUTES.SHARES, label: "Shared", icon: Link2 },
  { href: ROUTES.TEAMS, label: "Teams", icon: Users },
  { href: ROUTES.BADGE, label: "Badge", icon: BadgeCheck },
  { href: ROUTES.DOCS, label: "Docs", icon: Book },
  { href: ROUTES.PROFILE, label: "Profile", icon: User },
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
        <div className="max-w-7xl mx-auto flex items-center justify-between px-4 sm:px-6 h-16">
          {/* Logo */}
          <Link
              href={ROUTES.DASHBOARD}
              className="flex items-center gap-2.5 hover:opacity-80 transition-opacity shrink-0"
              aria-label="Go to scanner"
          >
            <ThemedLogo width={24} height={24} className="h-6 w-6" alt={`${APP_NAME} logo`} />
            <span className="text-lg font-semibold text-foreground tracking-tight">
              {APP_NAME}
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-1">
            {NAV_LINKS.map(({ href, label }) => {
              const active = href === ROUTES.DOCS ? pathname.startsWith(ROUTES.DOCS) : pathname === href || pathname.startsWith(href.split("#")[0])
              return (
                  <Link
                      key={href}
                      href={href}
                      className={cn(
                          "px-3 py-2 rounded-md text-sm transition-colors",
                          active
                              ? "bg-primary/10 text-primary font-medium"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted",
                      )}
                  >
                    {label}
                  </Link>
              )
            })}
            {/* Admin link */}
            <Link
                href={ROUTES.ADMIN}
                className={cn(
                    "vr-staff-only px-3 py-2 rounded-md text-sm transition-colors",
                    isStaff && "!inline-flex",
                    pathname === ROUTES.ADMIN
                        ? "text-destructive font-medium"
                        : "text-destructive/70 hover:text-destructive",
                )}
            >
              Admin
            </Link>
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-2">
            <NotificationBell />
            <ThemeToggle />
            <div className="hidden md:block w-px h-5 bg-border mx-1" />
            <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="hidden md:inline-flex text-muted-foreground hover:text-foreground gap-2"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden lg:inline">Log out</span>
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
          <SheetContent side="right" className="w-72 bg-background p-0 border-l border-border">
            <SheetTitle className="sr-only">Navigation menu</SheetTitle>
            <nav className="flex flex-col px-4 pt-14 pb-6">
              <div className="flex flex-col gap-1">
                {NAV_LINKS.map(({ href, label, icon: Icon }) => {
                  const active = href === ROUTES.DOCS ? pathname.startsWith(ROUTES.DOCS) : pathname === href || pathname.startsWith(href.split("#")[0])
                  return (
                      <Link
                          key={href}
                          href={href}
                          onClick={() => setMobileOpen(false)}
                          className={cn(
                              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
                              active
                                  ? "bg-primary/10 text-primary font-medium"
                                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
                          )}
                      >
                        <Icon className="h-4 w-4" />
                        {label}
                      </Link>
                  )
                })}
                <Link
                    href={ROUTES.ADMIN}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                        "vr-staff-only items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
                        isStaff && "!flex",
                        pathname === ROUTES.ADMIN
                            ? "bg-destructive/10 text-destructive font-medium"
                            : "text-destructive/70 hover:text-destructive hover:bg-destructive/10",
                    )}
                >
                  <ShieldAlert className="h-4 w-4" />
                  Admin
                </Link>
              </div>
              <div className="my-4 border-t border-border" />
              <button
                  onClick={handleLogout}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-destructive hover:bg-destructive/10 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Log out
              </button>
            </nav>
          </SheetContent>
        </Sheet>
      </header>
  )
}
