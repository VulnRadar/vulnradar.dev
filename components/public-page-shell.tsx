"use client"

import React, { useState, useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { useAuth } from "@/components/auth-provider"
import { APP_NAME, ROUTES, BILLING_ENABLED } from "@/lib/constants"
import { ThemedLogo } from "@/components/themed-logo"

interface PublicPageShellProps {
  children: React.ReactNode
  /** Label shown next to the logo for guests, e.g. "Demo", "Staff" */
  badge?: string
  /** Max-width class for the main content area. Defaults to "max-w-5xl" */
  maxWidth?: string
  /** Extra padding class for main. Defaults to "py-8" */
  padding?: string
}

// Check localStorage cache immediately to prevent header flash
function getInitialAuthState(): boolean | null {
  if (typeof window === "undefined") return null
  try {
    const cached = localStorage.getItem("vr_auth_cache")
    if (cached) {
      const parsed = JSON.parse(cached)
      return !!parsed?.userId
    }
  } catch {}
  return null
}

export function PublicPageShell({
  children,
  badge,
  maxWidth = "max-w-5xl",
  padding = "py-8",
}: PublicPageShellProps) {
  const { me, isLoading } = useAuth()
  // Use localStorage cache for instant render, then sync with actual auth state
  const [cachedAuth, setCachedAuth] = useState<boolean | null>(() => getInitialAuthState())
  
  // Once auth loads, use the real value
  useEffect(() => {
    if (!isLoading) {
      setCachedAuth(!!me?.userId)
    }
  }, [me, isLoading])
  
  // Show logged-in UI if either cache says yes OR real auth says yes
  // This prevents flash: cache loads instantly, real auth confirms later
  const isLoggedIn = cachedAuth === true || !!me?.userId

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {isLoggedIn ? (
        <Header />
      ) : (
        <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-lg">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 relative flex items-center">
            {/* Logo - left */}
            <Link href="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity z-10">
              <ThemedLogo width={24} height={24} className="h-6 w-6" alt={`${APP_NAME} logo`} />
              <span className="font-semibold text-lg tracking-tight">{APP_NAME}</span>
            </Link>

            {/* Center nav links - absolutely centered */}
            <nav className="hidden md:flex items-center gap-6 absolute left-1/2 -translate-x-1/2">
              {BILLING_ENABLED && (
                <Link href={ROUTES.PRICING} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  Pricing
                </Link>
              )}
              <Link href="/docs" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Docs
              </Link>
              <Link href="/demo" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Demo
              </Link>
            </nav>

            {/* CTA buttons - pushed to end */}
            <div className="flex items-center gap-3 ml-auto z-10">
              <Link href={ROUTES.LOGIN}>
                <Button variant="ghost" size="sm">Log in</Button>
              </Link>
              <Link href={ROUTES.SIGNUP} className="hidden sm:block">
                <Button size="sm">Get Started</Button>
              </Link>
            </div>
          </div>
        </header>
      )}

      <main className={`flex-1 ${maxWidth} w-full mx-auto px-4 ${padding}`}>
        {children}
      </main>

      {isLoggedIn ? (
        <Footer />
      ) : (
        <footer className="border-t border-border bg-card/50">
          <div className="max-w-4xl mx-auto px-4 py-4 flex flex-col items-center gap-2">
            <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
              {BILLING_ENABLED && (
                <>
                  <Link href={ROUTES.PRICING} className="hover:text-foreground transition-colors">
                    Pricing
                  </Link>
                  <span className="text-border">|</span>
                </>
              )}
              <Link href={ROUTES.LEGAL_TERMS} className="hover:text-foreground transition-colors">
                Terms of Service
              </Link>
              <span className="text-border">|</span>
              <Link href={ROUTES.LEGAL_PRIVACY} className="hover:text-foreground transition-colors">
                Privacy Policy
              </Link>
              <span className="text-border">|</span>
              <Link href={ROUTES.LEGAL_DISCLAIMER} className="hover:text-foreground transition-colors">
                Disclaimer
              </Link>
              <span className="text-border">|</span>
              <Link href={ROUTES.GDPR_REQUEST} className="hover:text-foreground transition-colors">
                GDPR / Data Request
              </Link>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {"\u00A9"} {new Date().getFullYear()} {APP_NAME}
            </p>
          </div>
        </footer>
      )}
    </div>
  )
}
