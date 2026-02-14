"use client"

import { LogOut, User, Clock, Book, Menu, X, GitCompareArrows, ShieldAlert, Users, Radar, BadgeCheck } from "lucide-react"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { useRouter, usePathname } from "next/navigation"
import { useState, useEffect, useRef } from "react"
import useSWR from "swr"
import { cn } from "@/lib/utils"
import Image from "next/image"
import { APP_NAME } from "@/lib/constants"

const STAFF_ROLES = ["admin", "moderator", "support"]

const NAV_LINKS = [
  { href: "/dashboard", label: "Scanner", icon: Radar },
  { href: "/history", label: "History", icon: Clock },
  { href: "/compare", label: "Compare", icon: GitCompareArrows },
  { href: "/teams", label: "Teams", icon: Users },
  { href: "/badge", label: "Badge", icon: BadgeCheck },
  { href: "/docs", label: "Docs", icon: Book },
  { href: "/profile", label: "Profile", icon: User },
]

function getCachedRole(): string | null {
  try { return sessionStorage.getItem("vr_user_role") } catch { return null }
}

export function Header() {
  const router = useRouter()
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const cachedRole = useRef(getCachedRole())
  const { data: me } = useSWR("/api/auth/me", (url: string) => fetch(url).then((r) => r.json()), {
    revalidateOnFocus: false,
    dedupingInterval: 60000,
  })

  // Cache role in sessionStorage when loaded
  useEffect(() => {
    if (me?.role) {
      try { sessionStorage.setItem("vr_user_role", me.role) } catch {}
      cachedRole.current = me.role
    }
  }, [me?.role])

  const effectiveRole = me?.role || cachedRole.current
  const isStaff = STAFF_ROLES.includes(effectiveRole || "")

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" })
    router.push("/login")
    router.refresh()
  }

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-lg">
      <div className="max-w-5xl mx-auto flex items-center justify-between px-4 h-14">
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
        <nav className="hidden md:flex items-center gap-1">
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
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-1">
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
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
            className="md:hidden text-muted-foreground hover:text-foreground h-8 w-8"
          >
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-card px-4 pb-3 pt-2">
          <nav className="flex flex-col gap-1">
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
                    "flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
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
                  "flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                  pathname === "/admin"
                    ? "bg-destructive/10 text-destructive"
                    : "text-destructive/70 hover:text-destructive hover:bg-destructive/10",
                )}
              >
                <ShieldAlert className="h-4 w-4" />
                Admin
              </button>
            )}
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors mt-1"
            >
              <LogOut className="h-4 w-4" />
              Log out
            </button>
          </nav>
        </div>
      )}
    </header>
  )
}
