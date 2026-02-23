"use client"

import React from "react"
import Image from "next/image"
import Link from "next/link"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { useAuth } from "@/components/auth-provider"
import { APP_NAME, ROUTES } from "@/lib/constants"

interface PublicPageShellProps {
  children: React.ReactNode
  /** Label shown next to the logo for guests, e.g. "Demo", "Staff" */
  badge?: string
  /** Max-width class for the main content area. Defaults to "max-w-5xl" */
  maxWidth?: string
  /** Extra padding class for main. Defaults to "py-8" */
  padding?: string
}

export function PublicPageShell({
  children,
  badge,
  maxWidth = "max-w-5xl",
  padding = "py-8",
}: PublicPageShellProps) {
  const { me } = useAuth()
  const isLoggedIn = !!me?.name

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {isLoggedIn ? (
        <Header />
      ) : (
        <header className="sticky top-0 z-50 h-14 flex items-center justify-between px-4 sm:px-6 border-b border-border bg-card/95 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
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
            {badge && (
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-md font-medium">
                {badge}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Button asChild variant="outline" size="sm" className="bg-transparent text-xs">
              <Link href={ROUTES.LOGIN}>Sign In</Link>
            </Button>
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
