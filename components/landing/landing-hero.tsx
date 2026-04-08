"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ArrowRight, Terminal, CheckCircle, Activity, LayoutDashboard } from "lucide-react"
import { TOTAL_CHECKS_LABEL, ROUTES } from "@/lib/config/constants"
import { useAuth } from "@/components/providers/auth-provider"

export function LandingHero() {
  const { me } = useAuth()
  const isLoggedIn = !!me?.userId

  return (
    <section className="relative">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 pb-20 sm:pt-24 sm:pb-28">
        <div className="max-w-3xl mx-auto text-center">
          <Badge variant="outline" className="mb-5 gap-1.5 py-1 px-3 border-primary/30 bg-primary/5 text-xs">
            <Activity className="h-3 w-3 text-primary" />
            {TOTAL_CHECKS_LABEL} vulnerability checks
          </Badge>

          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-5 text-balance">
            The complete platform for{" "}
            <span className="text-muted-foreground">web security</span>
          </h1>

          <p className="text-base sm:text-lg text-muted-foreground max-w-xl mx-auto mb-8 text-pretty">
            Detect vulnerabilities in seconds. Get actionable insights. Ship secure code with confidence.
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
                  Start Scanning Free
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            )}
            <Link href="/demo">
              <Button size="lg" variant="outline" className="h-11 px-6 gap-2">
                <Terminal className="h-4 w-4" />
                Live Demo
              </Button>
            </Link>
          </div>

          {!isLoggedIn && (
            <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
              {["No credit card required", "Free forever tier", "Open source"].map((item, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <CheckCircle className="h-3.5 w-3.5 text-primary" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
