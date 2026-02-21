"use client"

import { LogOut, User, Clock, Book, Menu, GitCompareArrows, ShieldAlert, Users, Radar, BadgeCheck, Link2 } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { useRouter, usePathname } from "next/navigation"
import { useState } from "react"
import { cn } from "@/lib/utils"
import Image from "next/image"
import { APP_NAME } from "@/lib/constants"
import { NotificationBell } from "@/components/notification-center"
import { useAuth } from "@/components/auth-provider"

const STAFF_ROLES = ["admin", "moderator", "support"]

const NAV_LINKS = [
  { href: "/dashboard", label: "Scanner", icon: Radar },
  { href: "/history", label: "History", icon: Clock },
  { href: "/compare", label: "Compare", icon: GitCompareArrows },
  { href: "/shares", label: "Shared", icon: Link2 },
  { href: "/teams", label: "Teams", icon: Users },
  { href: "/badge", label: "Badge", icon: BadgeCheck },
  { href: "/docs", label: "Docs", icon: Book },
  { href: "/profile", label: "Profile", icon: User },
]

export function Header() {
  const router = useRouter()
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { me } = useAuth()

  const isStaff = STAFF_ROLES.includes(me?.role || "")

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" })
    router.push("/login")
    router.refresh()
  }

  return (
      <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-lg">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 h-14">
          {/* Logo */}
          <button
              onClick={() => router.push("/dashboard")}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0"
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
          </button>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-0.5">
            {NAV_LINKS.map(({ href, label, icon: Icon }) => {
              const active = href === "/docs" ? pathname.startsWith("/docs") : pathname === href
              return (
                  <button
                      key={href}
                      onClick={() => router.push(href)}
                      className={cn(
                          "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                          active
                              ? "bg-primary/10 text-primary"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted",
                      )}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
              )
            })}
            {isStaff && (
                <button
                    onClick={() => router.push("/admin")}
                    className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                        pathname === "/admin"
                            ? "bg-destructive/10 text-destructive"
                            : "text-destructive/70 hover:text-destructive hover:bg-destructive/10",
                    )}
                >
                  <ShieldAlert className="h-4 w-4" />
                  Admin
                </button>
            )}
            {!isStaff && (
                <div className="h-8 w-16" />
            )}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-1">
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
                const active = href === "/docs" ? pathname.startsWith("/docs") : pathname === href
                return (
                    <button
                        key={href}
                        onClick={() => {
                          router.push(href)
                          setMobileOpen(false)
                        }}
                        className={cn(
                            "flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                            active
                                ? "bg-primary/10 text-primary"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted",
                        )}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </button>
                )
              })}
              {isStaff && (
                  <button
                      onClick={() => { router.push("/admin"); setMobileOpen(false) }}
                      className={cn(
                          "flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                          pathname === "/admin"
                              ? "bg-destructive/10 text-destructive"
                              : "text-destructive/70 hover:text-destructive hover:bg-destructive/10",
                      )}
                  >
                    <ShieldAlert className="h-4 w-4" />
                    Admin
                  </button>
              )}
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
