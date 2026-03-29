"use client"

import React from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Footer } from "@/components/scanner/footer"
import { Header } from "@/components/scanner/header"
import { useAuth } from "@/components/providers/auth-provider"
import { APP_NAME, ROUTES, BILLING_ENABLED } from "@/lib/constants"
import { ThemedLogo } from "@/components/shared/themed-logo"
import { ArrowRight } from "lucide-react"
import { backdrops, transitions } from "@/lib/animations"

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  const { me } = useAuth()
  const isLoggedIn = !!me?.userId

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {isLoggedIn ? (
        <Header />
      ) : (
        <nav className={`sticky top-0 z-50 border-b border-border/50 ${backdrops.header}`}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 relative flex items-center">
            <Link href="/" className={`flex items-center gap-2.5 z-10 group ${transitions.default}`}>
              <ThemedLogo width={28} height={28} className="h-7 w-7 transition-transform group-hover:scale-105" alt={`${APP_NAME} logo`} />
              <span className="font-bold text-lg tracking-tight">{APP_NAME}</span>
            </Link>
            
            <div className="hidden md:flex items-center gap-8 absolute left-1/2 -translate-x-1/2">
              {BILLING_ENABLED && (
                <Link href={ROUTES.PRICING} className={`text-sm text-muted-foreground hover:text-foreground ${transitions.colors}`}>
                  Pricing
                </Link>
              )}
              <Link href={ROUTES.DOCS} className={`text-sm text-muted-foreground hover:text-foreground ${transitions.colors}`}>
                Docs
              </Link>
              <Link href="/demo" className={`text-sm text-foreground font-medium ${transitions.colors}`}>
                Demo
              </Link>
            </div>
            
            <div className="flex items-center gap-3 ml-auto z-10">
              <Link href={ROUTES.LOGIN}>
                <Button variant="ghost" size="sm" className="hidden sm:inline-flex">Log in</Button>
              </Link>
              <Link href={ROUTES.SIGNUP}>
                <Button size="sm" className="gap-1.5">
                  Get Started
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          </div>
        </nav>
      )}

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-8">
        {children}
      </main>

      <Footer />
    </div>
  )
}
