"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ThemedLogo } from "@/components/shared/themed-logo"
import { APP_NAME, ROUTES, BILLING_ENABLED } from "@/lib/config/constants"
import { backdrops, transitions } from "@/lib/ui/animations"

export function DocsHeader() {
  return (
    <header className={`sticky top-0 z-50 border-b border-border/50 ${backdrops.header}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 relative flex items-center">
        <Link href="/" className={`flex items-center gap-2.5 z-10 group ${transitions.default}`}>
          <ThemedLogo
            width={28}
            height={28}
            className="h-7 w-7 transition-transform group-hover:scale-105"
            alt={`${APP_NAME} logo`}
          />
          <span className="font-bold text-lg tracking-tight">{APP_NAME}</span>
        </Link>
        <nav className="hidden md:flex items-center gap-8 absolute left-1/2 -translate-x-1/2">
          {BILLING_ENABLED && (
            <Link
              href={ROUTES.PRICING}
              className={`text-sm text-muted-foreground hover:text-foreground ${transitions.colors}`}
            >
              Pricing
            </Link>
          )}
          <Link href="/docs" className={`text-sm text-foreground font-medium ${transitions.colors}`}>
            Docs
          </Link>
          <Link
            href="/demo"
            className={`text-sm text-muted-foreground hover:text-foreground ${transitions.colors}`}
          >
            Demo
          </Link>
        </nav>
        <div className="flex items-center gap-3 ml-auto z-10">
          <Link href={ROUTES.LOGIN}>
            <Button variant="ghost" size="sm" className="hidden sm:inline-flex">
              Log in
            </Button>
          </Link>
          <Link href={ROUTES.SIGNUP}>
            <Button size="sm" className="gap-1.5">
              Get Started
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Button>
          </Link>
        </div>
      </div>
    </header>
  )
}
