"use client"

import { LogOut, User, Clock, Book, Menu, GitCompareArrows, ShieldAlert, Users, Radar, BadgeCheck, Link2 } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { useRouter, usePathname } from "next/navigation"
import Link from "next/link"
import { useState } from "react"
import { cn } from "@/lib/utils"
import Image from "next/image"
import { APP_NAME, ROUTES, API } from "@/lib/constants"
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
      <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-lg overflow-x-hidden">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 h-14 min-w-0">
          {/* Logo */}
          <Link
              href={ROUTES.DASHBOARD}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0 min-w-0"
              aria-label="Go to scanner"
          >
            <Image
                src="/favicon.svg"
                alt={`${APP_NAME} logo`}
                width={20}
                height={20}
                className="h-5 w-5"
            />
            <span className="text-base font-semibold text-foreground tracking-tight">
            {APP_NAME}
          </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-0.5 overflow-x-auto scrollbar-none min-w-0 flex-1 justify-center px-2">
            {NAV_LINKS.map(({ href, label, icon: Icon }) => {
              const active = href === ROUTES.DOCS ? pathname.startsWith(ROUTES.DOCS) : pathname === href || pathname.startsWith(href.split("#")[0])
              return (
                  <Link
                      key={href}
                      href={href}
                      className={cn(
                          "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                          active
                              ? "bg-primary/10 text-primary"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted",
                      )}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </Link>
              )
            })}
            {/* Admin link: uses vr-staff-only for instant visibility via localStorage cache, 
                plus isStaff check as fallback once React hydrates */}
            <Link
                href={ROUTES.ADMIN}
                className={cn(
                    "vr-staff-only items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                    isStaff && "!flex", // Force visible once React confirms staff status
                    pathname === ROUTES.ADMIN
                        ? "bg-destructive/10 text-destructive"
                        : "text-destructive/70 hover:text-destructive hover:bg-destructive/10",
                )}
            >
              <ShieldAlert className="h-4 w-4" />
              Admin
            </Link>
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-1 shrink-0">
            <NotificationBell />
            <ThemeToggle />
            <Button
                variant="ghost"
                size="icon"
                onClick={handleLogout}
                aria-label="Log out"
                className="hidden md:inline-flex text-muted-foreground hover:text-foreground h-8 w-8"
            >
              <LogOut className="h-4 w-4" />
            </Button>
            {/* Mobile hamburger */}
            <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileOpen(true)}
                aria-label="Toggle menu"
                className="md:hidden text-muted-foreground hover:text-foreground h-8 w-8"
            >
              <Menu className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Mobile overlay menu */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="right" className="w-64 bg-card p-0">
            <SheetTitle className="sr-only">Navigation menu</SheetTitle>
            <nav className="flex flex-col gap-1 px-3 pt-12 pb-4">
              {NAV_LINKS.map(({ href, label, icon: Icon }) => {
                const active = href === ROUTES.DOCS ? pathname.startsWith(ROUTES.DOCS) : pathname === href || pathname.startsWith(href.split("#")[0])
                return (
                    <Link
                        key={href}
                        href={href}
                        onClick={() => setMobileOpen(false)}
                        className={cn(
                            "flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                            active
                                ? "bg-primary/10 text-primary"
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
                      "vr-staff-only items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                      isStaff && "!flex", // Force visible once React confirms staff status
                      pathname === ROUTES.ADMIN
                          ? "bg-destructive/10 text-destructive"
                          : "text-destructive/70 hover:text-destructive hover:bg-destructive/10",
                  )}
              >
                <ShieldAlert className="h-4 w-4" />
                Admin
              </Link>
              <div className="my-2 border-t border-border" />
              <button
                  onClick={handleLogout}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
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
