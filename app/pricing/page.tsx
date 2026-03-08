"use client"

import { useState } from "react"
import { Check, X, Zap, Shield, Radar, ArrowRight, Sparkles, Crown, Rocket, Star, Heart } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { APP_NAME, ROUTES } from "@/lib/constants"
import Link from "next/link"
import Image from "next/image"
import { useAuth } from "@/components/auth-provider"
import { Header } from "@/components/scanner/header"
import { StripeCheckout } from "@/components/stripe-checkout"

const PLANS = [
  {
    id: "free",
    stripeId: null,
    name: "Free",
    description: "Full-featured security scanning for everyone",
    price: 0,
    interval: "forever",
    scansPerDay: 50,
    popular: false,
    icon: Shield,
    color: "text-muted-foreground",
    features: [
      { text: "50 scans per day", included: true, highlight: false },
      { text: "Full vulnerability detection", included: true, highlight: false },
      { text: "Security headers analysis", included: true, highlight: false },
      { text: "SSL/TLS certificate checks", included: true, highlight: false },
      { text: "API access", included: true, highlight: false },
      { text: "PDF reports", included: true, highlight: false },
      { text: "Scheduled scans", included: true, highlight: false },
      { text: "30-day scan history", included: true, highlight: false },
      { text: "Community support", included: true, highlight: false },
      { text: "Early access features", included: false, highlight: false },
      { text: "Supporter badge", included: false, highlight: false },
    ],
  },
  {
    id: "core_supporter",
    stripeId: "core_supporter",
    name: "Core Supporter",
    description: "Double your scans + support VulnRadar development",
    price: 5,
    interval: "month",
    scansPerDay: 100,
    popular: false,
    icon: Heart,
    color: "text-rose-500",
    features: [
      { text: "100 scans per day", included: true, highlight: true },
      { text: "Full vulnerability detection", included: true, highlight: false },
      { text: "Security headers analysis", included: true, highlight: false },
      { text: "SSL/TLS certificate checks", included: true, highlight: false },
      { text: "API access (2,000 req/day)", included: true, highlight: false },
      { text: "PDF reports", included: true, highlight: false },
      { text: "Scheduled scans", included: true, highlight: false },
      { text: "90-day scan history", included: true, highlight: true },
      { text: "Email support", included: true, highlight: true },
      { text: "Early access features", included: true, highlight: true },
      { text: "Supporter badge", included: true, highlight: true },
    ],
  },
  {
    id: "pro_supporter",
    stripeId: "pro_supporter",
    name: "Pro Supporter",
    description: "For power users who scan frequently",
    price: 10,
    interval: "month",
    scansPerDay: 150,
    popular: true,
    icon: Rocket,
    color: "text-primary",
    features: [
      { text: "150 scans per day", included: true, highlight: true },
      { text: "Full vulnerability detection", included: true, highlight: false },
      { text: "Security headers analysis", included: true, highlight: false },
      { text: "SSL/TLS certificate checks", included: true, highlight: false },
      { text: "API access (5,000 req/day)", included: true, highlight: true },
      { text: "PDF reports", included: true, highlight: false },
      { text: "Scheduled scans", included: true, highlight: false },
      { text: "Unlimited scan history", included: true, highlight: true },
      { text: "Priority support", included: true, highlight: true },
      { text: "Early access features", included: true, highlight: false },
      { text: "Pro supporter badge", included: true, highlight: true },
    ],
  },
  {
    id: "elite_supporter",
    stripeId: "elite_supporter",
    name: "Elite Supporter",
    description: "Maximum power for teams & organizations",
    price: 20,
    interval: "month",
    scansPerDay: 500,
    popular: false,
    icon: Crown,
    color: "text-amber-500",
    features: [
      { text: "500 scans per day", included: true, highlight: true },
      { text: "Full vulnerability detection", included: true, highlight: false },
      { text: "Security headers analysis", included: true, highlight: false },
      { text: "SSL/TLS certificate checks", included: true, highlight: false },
      { text: "Unlimited API access", included: true, highlight: true },
      { text: "PDF & CSV reports", included: true, highlight: true },
      { text: "Scheduled scans", included: true, highlight: false },
      { text: "Unlimited scan history", included: true, highlight: false },
      { text: "Dedicated support", included: true, highlight: true },
      { text: "Early access + beta features", included: true, highlight: true },
      { text: "Elite supporter badge", included: true, highlight: true },
    ],
  },
]

export default function PricingPage() {
  const { me } = useAuth()
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly")
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null)

  const currentPlan = me?.plan || "free"

  // Get the Stripe product ID based on plan and billing
  const getStripeProductId = (planId: string) => {
    return `${planId}_${billing === "yearly" ? "yearly" : "monthly"}`
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Use the proper header - shows logged in state */}
      {me ? (
        <Header />
      ) : (
        <div className="border-b border-border bg-card/80 backdrop-blur-lg">
          <div className="max-w-6xl mx-auto flex items-center justify-between px-4 h-14">
            <Link href={ROUTES.HOME} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <Image src="/favicon.svg" alt={`${APP_NAME} logo`} width={28} height={28} className="h-7 w-7" />
              <span className="font-semibold text-lg">{APP_NAME}</span>
            </Link>
            <div className="flex items-center gap-3">
              <Link href={ROUTES.LOGIN}>
                <Button variant="ghost" size="sm">Sign In</Button>
              </Link>
              <Link href={ROUTES.SIGNUP}>
                <Button size="sm">Get Started</Button>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Stripe Checkout Modal */}
      {checkoutPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="font-semibold">Complete your subscription</h3>
              <Button variant="ghost" size="sm" onClick={() => setCheckoutPlan(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-4">
              <StripeCheckout productId={checkoutPlan} />
            </div>
          </div>
        </div>
      )}

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
                  <div className="flex items-center gap-2 mb-2">
                    <plan.icon className={cn("h-5 w-5", plan.color)} />
                    <CardTitle className="text-xl">{plan.name}</CardTitle>
                  </div>
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
                          <Check className={cn("h-4 w-4 shrink-0 mt-0.5", feature.highlight ? "text-primary" : "text-emerald-500")} />
                        ) : (
                          <X className="h-4 w-4 text-muted-foreground/50 shrink-0 mt-0.5" />
                        )}
                        <span className={cn(
                          !feature.included && "text-muted-foreground/50",
                          feature.highlight && feature.included && "font-medium"
                        )}>
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
                    <Link href={me ? ROUTES.DASHBOARD : ROUTES.SIGNUP} className="w-full">
                      <Button variant="outline" className="w-full">
                        {me ? "Go to Scanner" : "Get Started Free"}
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </Button>
                    </Link>
                  ) : me ? (
                    <Button
                      className={cn("w-full", plan.popular && "bg-primary hover:bg-primary/90")}
                      variant={plan.popular ? "default" : "outline"}
                      onClick={() => setCheckoutPlan(getStripeProductId(plan.stripeId!))}
                    >
                      Upgrade Now
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  ) : (
                    <Link href={ROUTES.SIGNUP} className="w-full">
                      <Button
                        className={cn("w-full", plan.popular && "bg-primary hover:bg-primary/90")}
                        variant={plan.popular ? "default" : "outline"}
                      >
                        Get Started
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </Button>
                    </Link>
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
        <Link href={me ? ROUTES.DASHBOARD : ROUTES.SIGNUP}>
          <Button size="lg">
            {me ? "Go to Scanner" : "Get Started Free"}
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </Link>
      </div>
    </div>
  )
}
