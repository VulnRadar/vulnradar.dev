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
import { Footer } from "@/components/scanner/footer"
import { LandingNav } from "@/components/landing/landing-nav"
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

  const isLoggedIn = !!me?.userId

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Static navigation - same for logged in or not */}
      <LandingNav />

      <main className="flex-1">
        {/* Stripe Checkout Modal */}
        {checkoutPlan && (() => {
          const selectedPlan = LIB_PLANS.find(p => p.id === checkoutPlan)
          const planName = checkoutPlan.includes('elite') ? 'Elite' : checkoutPlan.includes('pro') ? 'Pro' : 'Core'
          const planPrice = selectedPlan ? selectedPlan.priceInCents / 100 : 0
          const planFeatures = selectedPlan?.features || []
          const planBadgeColor = selectedPlan?.badge?.color || '#10b981'
          
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
              {/* Backdrop */}
              <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={() => setCheckoutPlan(null)} />
              
              {/* Modal */}
              <div className="relative bg-background border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-scale-in">

                {/* Header - plan identity strip */}
                <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-border/60">
                  <div className="flex items-center gap-3">
                    <div
                      className="h-9 w-9 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: `${planBadgeColor}18` }}
                    >
                      <Sparkles className="h-4 w-4" style={{ color: planBadgeColor }} />
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span className="font-semibold text-base">{planName} Supporter</span>
                      <span className="text-muted-foreground text-sm">·</span>
                      <span className="font-bold text-base">
                        ${billing === "yearly" ? Math.round(planPrice * 0.8) : planPrice}
                        <span className="text-sm font-normal text-muted-foreground">/{billing === "yearly" ? "mo" : "mo"}</span>
                      </span>
                      {billing === "yearly" && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0" style={{ borderColor: `${planBadgeColor}50`, color: planBadgeColor }}>
                          20% off
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-muted flex-shrink-0" onClick={() => setCheckoutPlan(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                {/* Stripe Checkout Form - scrollable */}
                <div className="flex-1 overflow-y-auto bg-white">
                  <div className="p-5">
                    {me?.userId && <StripeCheckout productId={checkoutPlan} userId={me.userId} onSuccess={() => setCheckoutPlan(null)} />}
                  </div>
                </div>

                {/* Footer */}
                <div className="flex-shrink-0 flex items-center justify-between gap-4 px-5 py-3 border-t border-border bg-muted/20">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Shield className="h-3.5 w-3.5" />
                    <span>256-bit SSL encryption</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    All purchases are final. <Link href="/legal/terms" className="underline hover:text-foreground transition-colors">Terms</Link>.
                  </p>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Hero Section */}
        <section className="relative">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 pb-12 sm:pt-20">
            <div className="text-center max-w-2xl mx-auto">
              <Badge variant="outline" className="mb-5 gap-1.5 py-1 px-3 border-primary/30 bg-primary/5 text-xs">
                <Sparkles className="h-3 w-3 text-primary" />
                Simple, transparent pricing
              </Badge>
              
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-5 text-balance">
                Plans that scale{" "}
                <span className="text-muted-foreground">with you</span>
              </h1>
              
              <p className="text-base sm:text-lg text-muted-foreground max-w-xl mx-auto mb-8 text-pretty">
                Start free, upgrade when you need more. All plans include our full vulnerability detection suite.
              </p>

              {/* Billing Toggle */}
              <div className="inline-flex items-center gap-0.5 p-1 rounded-lg bg-muted/50 border border-border/50">
                <button
                  onClick={() => setBilling("monthly")}
                  className={cn(
                    "px-4 py-2 rounded-md text-sm font-medium transition-all",
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
                    "px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2",
                    billing === "yearly" 
                      ? "bg-background text-foreground shadow-sm" 
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Yearly
                  <span className="text-[10px] bg-primary/10 text-primary font-semibold px-1.5 py-0.5 rounded">-20%</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing Cards */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-20">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {PLANS.map((plan) => {
              const price = getPrice(plan.price)
              const isCurrentPlan = currentPlan === plan.id

              return (
                <div
                  key={plan.id}
                  className={cn(
                    "relative flex flex-col rounded-xl border p-5 lg:p-6 transition-all",
                    plan.popular 
                      ? "border-primary bg-card shadow-lg shadow-primary/10 ring-1 ring-primary" 
                      : "border-border/50 bg-card/50 hover:bg-card hover:border-border/60"
                  )}
                >
                  {plan.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <Badge className="bg-primary text-primary-foreground shadow-md px-3 py-0.5 text-xs">
                        Popular
                      </Badge>
                    </div>
                  )}

                  <div className="mb-5">
                    <h3 className="text-lg font-semibold mb-1">{plan.name}</h3>
                    <p className="text-xs text-muted-foreground">{plan.description}</p>
                  </div>

                  <div className="mb-6">
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-bold tracking-tight">${price}</span>
                      {plan.price > 0 && (
                        <span className="text-muted-foreground text-sm">/{billing === "yearly" ? "yr" : "mo"}</span>
                      )}
                    </div>
                    {plan.price === 0 && (
                      <p className="text-xs text-muted-foreground mt-1">Free forever</p>
                    )}
                    {plan.price > 0 && billing === "yearly" && (
                      <p className="text-xs text-primary mt-1 font-medium">
                        ${Math.round(price / 12)}/mo billed annually
                      </p>
                    )}
                  </div>

                  <div className="flex-1 mb-6">
                    <ul className="space-y-3">
                      {plan.features.map((feature, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <div className="mt-0.5 w-4 h-4 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <Check className="h-2.5 w-2.5 text-primary" />
                          </div>
                          <span className="text-sm">{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {isCurrentPlan ? (
                    <Button variant="outline" className={cn("w-full h-10", isGifted && "border-amber-500/50 text-amber-500")} disabled>
                      {isGifted ? "Gifted Plan" : "Current Plan"}
                    </Button>
                  ) : plan.price === 0 ? (
                    <Button variant={plan.popular ? "default" : "outline"} className="w-full h-10" asChild>
                      <Link href={me ? ROUTES.DASHBOARD : ROUTES.SIGNUP}>
                        {me ? "Go to Scanner" : "Start Free"}
                      </Link>
                    </Button>
                  ) : me ? (
                    <Button
                      variant={plan.popular ? "default" : "outline"}
                      className={cn("w-full h-10", plan.popular && "shadow-md shadow-primary/20")}
                      onClick={() => setCheckoutPlan(getStripeProductId(plan.stripeId!))}
                    >
                      Upgrade to {plan.name}
                    </Button>
                  ) : (
                    <Button variant={plan.popular ? "default" : "outline"} className={cn("w-full h-10", plan.popular && "shadow-md shadow-primary/20")} asChild>
                      <Link href={ROUTES.SIGNUP}>Get Started</Link>
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* Features Grid */}
        <section className="border-y border-border/50 bg-muted/20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
            <div className="text-center mb-12">
              <p className="text-xs font-medium text-primary uppercase tracking-wider mb-2">Features</p>
              <h2 className="text-2xl sm:text-3xl font-bold mb-3 tracking-tight">
                Everything you need for web security
              </h2>
              <p className="text-muted-foreground max-w-xl mx-auto">
                All plans include our core security scanning features.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {FEATURES.map((feature) => (
                <div key={feature.title} className="flex gap-4 p-5 rounded-xl border border-border/50 bg-card/30 hover:bg-card/50 transition-colors">
                  <div className="shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <feature.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1 text-sm">{feature.title}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">{feature.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <div className="text-center mb-10">
            <p className="text-xs font-medium text-primary uppercase tracking-wider mb-2">FAQ</p>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Frequently asked questions</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {[
              { q: "Can I cancel my subscription anytime?", a: "Yes, you can cancel at any time. You'll have access until the end of your billing period." },
              { q: "What payment methods do you accept?", a: "We accept all major credit cards through Stripe, including Visa, Mastercard, and American Express." },
              { q: "Is there a free trial for paid plans?", a: "We offer a generous free tier instead of a trial. Start with 25 scans/day free, then upgrade when you need more." },
              { q: "Can I switch plans later?", a: "Absolutely. You can upgrade or downgrade your plan at any time. Changes take effect immediately." },
              { q: "Do you offer refunds?", a: "All purchases are final. Please review your plan carefully before subscribing." },
              { q: "Is my data secure?", a: "Yes. We use industry-standard encryption and never store sensitive scan data longer than necessary." },
            ].map((faq, i) => (
              <div key={i} className="p-4 rounded-xl border border-border/50 bg-card/30">
                <h3 className="font-medium text-sm mb-1.5">{faq.q}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section className="border-t border-border/50 bg-muted/20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 text-center">
            <h2 className="text-2xl sm:text-3xl font-bold mb-4 tracking-tight">Ready to secure your applications?</h2>
            <p className="text-muted-foreground mb-8 max-w-lg mx-auto">Start scanning for free today. No credit card required.</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link href={me ? ROUTES.DASHBOARD : ROUTES.SIGNUP}>
                <Button size="lg" className="h-11 px-6 gap-2">
                  {me ? "Go to Scanner" : "Get Started Free"}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href={ROUTES.DOCS}>
                <Button size="lg" variant="outline" className="h-11 px-6">
                  Documentation
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
