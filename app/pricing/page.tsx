"use client"

import { useState } from "react"
import { Check, ArrowRight, Sparkles, Shield, Zap, Clock, Globe, Lock, Users, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { APP_NAME, ROUTES, BILLING_ENABLED, BILLING_PLAN_LIMITS, BILLING_HISTORY_RETENTION } from "@/lib/constants"
import Link from "next/link"
import { useAuth } from "@/components/auth-provider"
import { PLANS as LIB_PLANS } from "@/lib/plans"
import { ThemedLogo } from "@/components/themed-logo"
import { Footer } from "@/components/scanner/footer"
import { StripeCheckout } from "@/components/stripe-checkout"

// Generate pricing page plans from centralized config
function getRetentionLabel(planId: string): string {
  const retention = BILLING_HISTORY_RETENTION[planId as keyof typeof BILLING_HISTORY_RETENTION]
  if (retention === -1) return "Unlimited scan history"
  return `${retention}-day scan history`
}

const PLANS = LIB_PLANS.map((libPlan) => {
  const scanLimit = BILLING_PLAN_LIMITS[libPlan.id as keyof typeof BILLING_PLAN_LIMITS] || libPlan.limits.dailyScans
  const features: string[] = [`${scanLimit} scans per day`]
  
  if (libPlan.id === "free") {
    features.push("Full vulnerability detection", "Security headers analysis", "SSL/TLS checks", "API access", getRetentionLabel("free"))
  } else if (libPlan.id === "core_supporter") {
    features.push("Everything in Free", getRetentionLabel("core_supporter"), "Email support", "Early access features", "Supporter badge")
  } else if (libPlan.id === "pro_supporter") {
    features.push("Everything in Core", getRetentionLabel("pro_supporter"), "Priority support", "5,000 API requests/day", "Pro badge")
  } else if (libPlan.id === "elite_supporter") {
    features.push("Everything in Pro", "Unlimited API access", "Dedicated support", "Beta features access", "Elite badge")
  }
  
  return {
    id: libPlan.id,
    stripeId: libPlan.id === "free" ? null : libPlan.id,
    name: libPlan.name.replace(" Supporter", ""),
    description: libPlan.description,
    price: libPlan.priceInCents / 100,
    interval: "month" as const,
    scansPerDay: scanLimit,
    popular: libPlan.id === "pro_supporter",
    features,
  }
})

const FEATURES = [
  { icon: Shield, title: "Comprehensive Scanning", description: "Detect vulnerabilities, misconfigurations, and security issues across your entire web application." },
  { icon: Zap, title: "Instant Results", description: "Get detailed security reports in seconds. No waiting, no queues, just fast and reliable scanning." },
  { icon: Clock, title: "Scheduled Scans", description: "Set up automated scans to run on your schedule. Stay on top of security without manual effort." },
  { icon: Globe, title: "API Access", description: "Integrate security scanning into your CI/CD pipeline with our powerful REST API." },
  { icon: Lock, title: "SSL/TLS Analysis", description: "Deep analysis of your SSL/TLS configuration, certificate validity, and cipher suites." },
  { icon: Users, title: "Team Collaboration", description: "Share scan results, collaborate on fixes, and track security improvements together." },
]

export default function PricingPage() {
  const { me } = useAuth()
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly")
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null)

  const currentPlan = me?.plan || "free"
  const isGifted = me?.subscriptionStatus === "gifted"

  const getStripeProductId = (planId: string) => `${planId}_${billing === "yearly" ? "yearly" : "monthly"}`
  const getPrice = (basePrice: number) => {
    if (basePrice === 0) return 0
    return billing === "yearly" ? Math.round(basePrice * 0.8 * 12) : basePrice
  }

  if (!BILLING_ENABLED) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center max-w-lg px-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <Check className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold mb-3">Unlimited Access</h1>
          <p className="text-muted-foreground mb-6">
            This {APP_NAME} instance has billing disabled. All users have unlimited access to all features.
          </p>
          <Button asChild>
            <Link href={me ? ROUTES.DASHBOARD : ROUTES.SIGNUP}>
              {me ? "Go to Scanner" : "Get Started"}
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 border-b border-border/50 bg-background/95 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 relative flex items-center">
          <Link href="/" className="flex items-center gap-2.5 z-10 group">
            <ThemedLogo width={28} height={28} className="h-7 w-7 transition-transform group-hover:scale-105" alt={`${APP_NAME} logo`} />
            <span className="font-bold text-lg tracking-tight">{APP_NAME}</span>
          </Link>
          
          <div className="hidden md:flex items-center gap-8 absolute left-1/2 -translate-x-1/2">
            <Link href={ROUTES.PRICING} className="text-sm text-foreground font-medium">Pricing</Link>
            <Link href={ROUTES.DOCS} className="text-sm text-muted-foreground hover:text-foreground transition-colors">Docs</Link>
            <Link href="/demo" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Demo</Link>
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

      <main className="flex-1">
        {/* Stripe Checkout Modal */}
        {checkoutPlan && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setCheckoutPlan(null)} />
            <div className="relative bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <div className="sticky top-0 z-10 flex items-center justify-between p-4 border-b border-border bg-card">
                <h3 className="font-semibold">Complete your subscription</h3>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCheckoutPlan(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="p-4 min-h-[400px]">
                {me?.userId && <StripeCheckout productId={checkoutPlan} userId={me.userId} />}
              </div>
            </div>
          </div>
        )}

        {/* Hero Section with Glowing Orb */}
        <section className="relative overflow-hidden">
          {/* Glowing orb background - matches landing page */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] bg-primary/5 rounded-full blur-3xl" />
          </div>
          
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-12">
            <div className="text-center max-w-3xl mx-auto">
              <Badge variant="outline" className="mb-6 gap-2 py-1.5 px-4 border-primary/30 bg-primary/5">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span className="text-sm">Simple, transparent pricing</span>
              </Badge>
              
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6 text-balance leading-[1.1]">
                Plans that scale{" "}
                <span className="text-muted-foreground">with you</span>
              </h1>
              
              <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed text-pretty">
                Start free, upgrade when you need more. All plans include our full vulnerability detection suite.
              </p>

              {/* Billing Toggle */}
              <div className="inline-flex items-center gap-1 p-1.5 rounded-full bg-muted/50 border border-border">
                <button
                  onClick={() => setBilling("monthly")}
                  className={cn(
                    "px-5 py-2.5 rounded-full text-sm font-medium transition-all",
                    billing === "monthly" 
                      ? "bg-background text-foreground shadow-sm" 
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Monthly
                </button>
                <button
                  onClick={() => setBilling("yearly")}
                  className={cn(
                    "px-5 py-2.5 rounded-full text-sm font-medium transition-all flex items-center gap-2",
                    billing === "yearly" 
                      ? "bg-background text-foreground shadow-sm" 
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Yearly
                  <span className="text-xs bg-primary/10 text-primary font-semibold px-2 py-0.5 rounded-full">Save 20%</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing Cards */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-24">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {PLANS.map((plan) => {
              const price = getPrice(plan.price)
              const isCurrentPlan = currentPlan === plan.id

              return (
                <div
                  key={plan.id}
                  className={cn(
                    "relative flex flex-col rounded-2xl border p-6 lg:p-8 transition-all duration-300",
                    plan.popular 
                      ? "border-primary bg-card shadow-xl shadow-primary/10 ring-1 ring-primary scale-[1.02]" 
                      : "border-border bg-card/50 hover:bg-card hover:border-border/80"
                  )}
                >
                  {plan.popular && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                      <Badge className="bg-primary text-primary-foreground shadow-lg px-4 py-1">
                        Most Popular
                      </Badge>
                    </div>
                  )}

                  <div className="mb-6">
                    <h3 className="text-xl font-bold mb-2">{plan.name}</h3>
                    <p className="text-sm text-muted-foreground">{plan.description}</p>
                  </div>

                  <div className="mb-8">
                    <div className="flex items-baseline gap-1">
                      <span className="text-5xl font-bold tracking-tight">${price}</span>
                      {plan.price > 0 && (
                        <span className="text-muted-foreground text-lg">/{billing === "yearly" ? "yr" : "mo"}</span>
                      )}
                    </div>
                    {plan.price === 0 && (
                      <p className="text-sm text-muted-foreground mt-2">Free forever</p>
                    )}
                    {plan.price > 0 && billing === "yearly" && (
                      <p className="text-sm text-primary mt-2 font-medium">
                        ${Math.round(price / 12)}/mo billed annually
                      </p>
                    )}
                  </div>

                  <div className="flex-1 mb-8">
                    <ul className="space-y-4">
                      {plan.features.map((feature, i) => (
                        <li key={i} className="flex items-start gap-3 text-sm">
                          <div className="mt-0.5 w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <Check className="h-3 w-3 text-primary" />
                          </div>
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {isCurrentPlan ? (
                    <Button variant="outline" className={cn("w-full h-12", isGifted && "border-amber-500/50 text-amber-500")} disabled>
                      {isGifted ? "Gifted Plan" : "Current Plan"}
                    </Button>
                  ) : plan.price === 0 ? (
                    <Button variant={plan.popular ? "default" : "outline"} className="w-full h-12" asChild>
                      <Link href={me ? ROUTES.DASHBOARD : ROUTES.SIGNUP}>
                        {me ? "Go to Scanner" : "Start Free"}
                      </Link>
                    </Button>
                  ) : me ? (
                    <Button
                      variant={plan.popular ? "default" : "outline"}
                      className={cn("w-full h-12", plan.popular && "shadow-lg shadow-primary/25")}
                      onClick={() => setCheckoutPlan(getStripeProductId(plan.stripeId!))}
                    >
                      Upgrade to {plan.name}
                    </Button>
                  ) : (
                    <Button variant={plan.popular ? "default" : "outline"} className={cn("w-full h-12", plan.popular && "shadow-lg shadow-primary/25")} asChild>
                      <Link href={ROUTES.SIGNUP}>Get Started</Link>
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* Features Grid */}
        <section className="border-y border-border bg-muted/30">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-20 sm:py-28">
            <div className="text-center mb-16">
              <Badge variant="secondary" className="mb-4">Features</Badge>
              <h2 className="text-3xl sm:text-4xl font-bold mb-4 tracking-tight">
                Everything you need for web security
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                All plans include our core security scanning features. Upgrade for more capacity and support.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {FEATURES.map((feature) => (
                <div key={feature.title} className="flex gap-4 p-6 rounded-xl border border-border/50 bg-card/30 hover:bg-card transition-colors">
                  <div className="shrink-0 w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    <feature.icon className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-2">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="max-w-4xl mx-auto px-4 sm:px-6 py-20 sm:py-28">
          <div className="text-center mb-12">
            <Badge variant="secondary" className="mb-4">FAQ</Badge>
            <h2 className="text-3xl font-bold tracking-tight">Frequently asked questions</h2>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {[
              { q: "Can I cancel my subscription anytime?", a: "Yes, you can cancel your subscription at any time. You'll continue to have access until the end of your billing period." },
              { q: "What payment methods do you accept?", a: "We accept all major credit cards through Stripe, including Visa, Mastercard, and American Express." },
              { q: "Is there a free trial for paid plans?", a: "We offer a generous free tier instead of a trial. Start with 25 scans/day free, then upgrade when you need more." },
              { q: "Can I switch plans later?", a: "Absolutely. You can upgrade or downgrade your plan at any time. Changes take effect immediately." },
              { q: "Do you offer refunds?", a: "All purchases are final. Once a subscription is activated, we do not offer refunds. Please review your plan carefully before subscribing." },
              { q: "Is my data secure?", a: "Yes. We use industry-standard encryption and never store sensitive scan data longer than necessary." },
            ].map((faq, i) => (
              <div key={i} className="p-6 rounded-xl border border-border bg-card/50">
                <h3 className="font-semibold mb-2">{faq.q}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section className="relative overflow-hidden border-t border-border">
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-[600px] h-[400px] bg-primary/5 rounded-full blur-3xl" />
          </div>
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-20 sm:py-28 text-center">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 tracking-tight">Ready to secure your applications?</h2>
            <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto">Start scanning for free today. No credit card required.</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href={me ? ROUTES.DASHBOARD : ROUTES.SIGNUP}>
                <Button size="lg" className="h-12 px-8 text-base gap-2 shadow-lg shadow-primary/25">
                  {me ? "Go to Scanner" : "Get Started Free"}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href={ROUTES.DOCS}>
                <Button size="lg" variant="outline" className="h-12 px-8 text-base">
                  Read Documentation
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}
