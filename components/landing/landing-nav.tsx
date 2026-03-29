"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowRight, LayoutDashboard } from "lucide-react"
import { APP_NAME, BILLING_ENABLED, ROUTES } from "@/lib/config/constants"
import { ThemedLogo } from "@/components/shared/themed-logo"
import { backdrops } from "@/lib/ui/animations"
import { cn } from "@/lib/ui/utils"
import { useAuth } from "@/components/providers/auth-provider"

export function LandingNav() {
  const { me, isLoading } = useAuth()
  const isLoggedIn = !!me?.userId

  return (
    <nav className={cn("sticky top-0 z-50 border-b border-border/50", backdrops.header)}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <ThemedLogo width={26} height={26} className="h-6 w-6 transition-transform group-hover:scale-105" alt={`${APP_NAME} logo`} />
          <span className="font-semibold text-base tracking-tight">{APP_NAME}</span>
        </Link>

        <div className="hidden md:flex items-center gap-6">
          {BILLING_ENABLED && (
            <Link href={ROUTES.PRICING} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Pricing
            </Link>
          )}
          <Link href={ROUTES.DOCS} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Docs
          </Link>
          <Link href="/demo" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Demo
          </Link>
        </div>

        <div className="flex items-center gap-2">
          {isLoading ? (
            <div className="h-8 w-24 bg-muted/50 rounded animate-pulse" />
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
                <Button variant="ghost" size="sm" className="hidden sm:inline-flex h-8">Log in</Button>
              </Link>
              <Link href={ROUTES.SIGNUP}>
                <Button size="sm" className="h-8 gap-1.5">
                  Get Started
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}
