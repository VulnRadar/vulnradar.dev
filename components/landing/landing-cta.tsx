"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowRight, LayoutDashboard } from "lucide-react"
import { APP_NAME, BILLING_ENABLED, ROUTES } from "@/lib/config/constants"
import { useAuth } from "@/components/providers/auth-provider"

export function LandingCta() {
  const { me } = useAuth()
  const isLoggedIn = !!me?.userId

  return (
    <section className="border-t border-border/50 bg-muted/20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4 tracking-tight">
            {isLoggedIn ? "Continue securing your applications" : "Ready to secure your applications?"}
          </h2>
          <p className="text-muted-foreground mb-8">
            {isLoggedIn 
              ? `Head to your dashboard to start scanning with ${APP_NAME}.`
              : `Join thousands of developers shipping secure code with ${APP_NAME}.`
            }
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            {isLoggedIn ? (
              <Link href={ROUTES.DASHBOARD}>
                <Button size="lg" className="h-11 px-6 gap-2">
                  <LayoutDashboard className="h-4 w-4" />
                  Go to Dashboard
                </Button>
              </Link>
            ) : (
              <Link href={ROUTES.SIGNUP}>
                <Button size="lg" className="h-11 px-6 gap-2">
                  Get Started Free
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            )}
            {BILLING_ENABLED && !isLoggedIn && (
              <Link href={ROUTES.PRICING}>
                <Button size="lg" variant="outline" className="h-11 px-6">
                  View Pricing
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
