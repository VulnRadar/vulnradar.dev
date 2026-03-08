"use client"

import { useState } from "react"
import { Check, X, Zap, Shield, Radar, ArrowRight, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { APP_NAME, ROUTES } from "@/lib/constants"
import Link from "next/link"
import { useAuth } from "@/components/auth-provider"

const PLANS = [
  {
    id: "free",
    name: "Free",
    description: "For individuals getting started with security scanning",
    price: 0,
    interval: "forever",
    scansPerDay: 10,
    popular: false,
    features: [
      { text: "10 scans per day", included: true },
      { text: "Basic vulnerability detection", included: true },
      { text: "Security headers analysis", included: true },
      { text: "SSL/TLS certificate checks", included: true },
      { text: "Community support", included: true },
      { text: "API access", included: false },
      { text: "Scan history (7 days)", included: true },
      { text: "PDF reports", included: false },
      { text: "Scheduled scans", included: false },
      { text: "Priority support", included: false },
    ],
  },
  {
    id: "core_supporter",
    name: "Core Supporter",
    description: "For developers who need more scanning power",
    price: 5,
    interval: "month",
    scansPerDay: 50,
    popular: false,
    features: [
      { text: "50 scans per day", included: true },
      { text: "Advanced vulnerability detection", included: true },
      { text: "Security headers analysis", included: true },
      { text: "SSL/TLS certificate checks", included: true },
      { text: "Email support", included: true },
      { text: "API access (1,000 req/day)", included: true },
      { text: "Scan history (30 days)", included: true },
      { text: "PDF reports", included: true },
      { text: "Scheduled scans", included: false },
      { text: "Priority support", included: false },
    ],
  },
  {
    id: "pro_supporter",
    name: "Pro Supporter",
    description: "For teams and power users with demanding needs",
    price: 15,
    interval: "month",
    scansPerDay: 150,
    popular: true,
    features: [
      { text: "150 scans per day", included: true },
      { text: "Full vulnerability detection suite", included: true },
      { text: "Security headers analysis", included: true },
      { text: "SSL/TLS certificate checks", included: true },
      { text: "Priority email support", included: true },
      { text: "API access (5,000 req/day)", included: true },
      { text: "Scan history (90 days)", included: true },
      { text: "PDF reports", included: true },
      { text: "Scheduled scans (weekly)", included: true },
      { text: "Slack notifications", included: true },
    ],
  },
  {
    id: "elite_supporter",
    name: "Elite Supporter",
    description: "For organizations requiring enterprise-grade security",
    price: 35,
    interval: "month",
    scansPerDay: 500,
    popular: false,
    features: [
      { text: "500 scans per day", included: true },
      { text: "Full vulnerability detection suite", included: true },
      { text: "Security headers analysis", included: true },
      { text: "SSL/TLS certificate checks", included: true },
      { text: "Dedicated support channel", included: true },
      { text: "API access (unlimited)", included: true },
      { text: "Scan history (unlimited)", included: true },
      { text: "PDF & CSV reports", included: true },
      { text: "Scheduled scans (daily)", included: true },
      { text: "Webhooks & integrations", included: true },
    ],
  },
]

export default function PricingPage() {
  const { me } = useAuth()
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly")

  const currentPlan = me?.plan || "free"

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/50">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <Link href={ROUTES.HOME} className="flex items-center gap-2">
              <Radar className="h-6 w-6 text-primary" />
              <span className="font-semibold text-lg">{APP_NAME}</span>
            </Link>
            {me ? (
              <Link href={ROUTES.PROFILE}>
                <Button variant="outline" size="sm">Back to Profile</Button>
              </Link>
            ) : (
              <Link href={ROUTES.LOGIN}>
                <Button variant="outline" size="sm">Sign In</Button>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Hero */}
      <div className="container mx-auto px-4 py-16 text-center">
        <Badge variant="secondary" className="mb-4">
          <Sparkles className="h-3 w-3 mr-1" /> Simple, transparent pricing
        </Badge>
        <h1 className="text-4xl font-bold tracking-tight mb-4">
          Choose your plan
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
          Start free and scale as you grow. All plans include core security scanning features.
          Upgrade anytime to unlock more scans and advanced features.
        </p>

        {/* Billing toggle */}
        <div className="inline-flex items-center gap-2 p-1 rounded-lg bg-muted/50 border border-border mb-12">
          <button
            onClick={() => setBilling("monthly")}
            className={cn(
              "px-4 py-2 rounded-md text-sm font-medium transition-all",
              billing === "monthly" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Monthly
          </button>
          <button
            onClick={() => setBilling("yearly")}
            className={cn(
              "px-4 py-2 rounded-md text-sm font-medium transition-all",
              billing === "yearly" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Yearly <span className="text-emerald-500 text-xs ml-1">Save 20%</span>
          </button>
        </div>
      </div>

      {/* Plans grid */}
      <div className="container mx-auto px-4 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto">
          {PLANS.map((plan) => {
            const price = billing === "yearly" ? Math.round(plan.price * 0.8 * 12) : plan.price
            const isCurrentPlan = currentPlan === plan.id

            return (
              <Card
                key={plan.id}
                className={cn(
                  "relative flex flex-col",
                  plan.popular && "border-primary shadow-lg shadow-primary/10"
                )}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground">Most Popular</Badge>
                  </div>
                )}
                <CardHeader className="pb-4">
                  <CardTitle className="text-xl">{plan.name}</CardTitle>
                  <CardDescription className="text-sm min-h-[40px]">{plan.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex-1">
                  <div className="mb-6">
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-bold">${price}</span>
                      {plan.price > 0 && (
                        <span className="text-muted-foreground">/{billing === "yearly" ? "year" : "mo"}</span>
                      )}
                    </div>
                    {plan.price === 0 && (
                      <p className="text-sm text-muted-foreground mt-1">Free forever</p>
                    )}
                    {plan.price > 0 && billing === "yearly" && (
                      <p className="text-xs text-emerald-500 mt-1">
                        ${Math.round(price / 12)}/mo billed annually
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 mb-4 p-2 rounded-lg bg-primary/5 border border-primary/10">
                    <Zap className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">{plan.scansPerDay} scans/day</span>
                  </div>

                  <ul className="space-y-2.5">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        {feature.included ? (
                          <Check className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                        ) : (
                          <X className="h-4 w-4 text-muted-foreground/50 shrink-0 mt-0.5" />
                        )}
                        <span className={cn(!feature.included && "text-muted-foreground/50")}>
                          {feature.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter className="pt-4">
                  {isCurrentPlan ? (
                    <Button variant="outline" className="w-full" disabled>
                      Current Plan
                    </Button>
                  ) : plan.price === 0 ? (
                    <Link href={me ? ROUTES.SCANNER : ROUTES.SIGNUP} className="w-full">
                      <Button variant="outline" className="w-full">
                        {me ? "Go to Scanner" : "Get Started"}
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </Button>
                    </Link>
                  ) : (
                    <Button
                      className={cn("w-full", plan.popular && "bg-primary hover:bg-primary/90")}
                      variant={plan.popular ? "default" : "outline"}
                    >
                      {me ? "Upgrade" : "Get Started"}
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  )}
                </CardFooter>
              </Card>
            )
          })}
        </div>
      </div>

      {/* FAQ or features section */}
      <div className="border-t border-border bg-muted/30">
        <div className="container mx-auto px-4 py-16">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold mb-2">All plans include</h2>
            <p className="text-muted-foreground">Core security features available to everyone</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Shield className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Vulnerability Detection</h3>
              <p className="text-sm text-muted-foreground">
                Comprehensive scanning for common security vulnerabilities and misconfigurations.
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Zap className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Instant Results</h3>
              <p className="text-sm text-muted-foreground">
                Get detailed security reports in seconds, not hours. Fast and reliable scanning.
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Radar className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">Continuous Updates</h3>
              <p className="text-sm text-muted-foreground">
                Our scanner is constantly updated with new checks for the latest vulnerabilities.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="container mx-auto px-4 py-16 text-center">
        <h2 className="text-2xl font-bold mb-4">Ready to secure your applications?</h2>
        <p className="text-muted-foreground mb-6">Start scanning for free today. No credit card required.</p>
        <Link href={me ? ROUTES.SCANNER : ROUTES.SIGNUP}>
          <Button size="lg">
            {me ? "Go to Scanner" : "Get Started Free"}
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </Link>
      </div>
    </div>
  )
}
