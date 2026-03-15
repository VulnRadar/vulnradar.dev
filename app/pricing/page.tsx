"use client"

import { useState } from "react"
import { Check, ArrowRight, Sparkles, Shield, Zap, Clock, Globe, Lock, Users, Headphones } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { APP_NAME, ROUTES, BILLING_ENABLED, ENTERPRISE_EMAIL, SUPPORT_EMAIL } from "@/lib/constants"
import Link from "next/link"
import { useAuth } from "@/components/auth-provider"
import { ThemedLogo } from "@/components/themed-logo"
import { PublicPageShell } from "@/components/public-page-shell"
import { StripeCheckout } from "@/components/stripe-checkout"
import { X } from "lucide-react"

const PLANS = [
  {
    id: "free",
    stripeId: null,
    name: "Free",
    description: "For individuals exploring security scanning.",
    price: 0,
    interval: "month",
    scansPerDay: 50,
    popular: false,
    features: [
      "50 scans per day",
      "Full vulnerability detection",
      "Security headers analysis",
      "SSL/TLS checks",
      "API access",
      "30-day scan history",
    ],
  },
  {
    id: "core_supporter",
    stripeId: "core_supporter",
    name: "Core",
    description: "For developers who scan regularly.",
    price: 5,
    interval: "month",
    scansPerDay: 100,
    popular: false,
    features: [
      "100 scans per day",
      "Everything in Free",
      "90-day scan history",
      "Email support",
      "Early access features",
      "Supporter badge",
    ],
  },
  {
    id: "pro_supporter",
    stripeId: "pro_supporter",
    name: "Pro",
    description: "For power users and small teams.",
    price: 10,
    interval: "month",
    scansPerDay: 150,
    popular: true,
    features: [
      "150 scans per day",
      "Everything in Core",
      "Unlimited scan history",
      "Priority support",
      "5,000 API requests/day",
      "Pro badge",
    ],
  },
  {
    id: "elite_supporter",
    stripeId: "elite_supporter",
    name: "Elite",
    description: "For teams and organizations.",
    price: 20,
    interval: "month",
    scansPerDay: 500,
    popular: false,
    features: [
      "500 scans per day",
      "Everything in Pro",
      "Unlimited API access",
      "Dedicated support",
      "Beta features access",
      "Elite badge",
    ],
  },
]

const FEATURES = [
  {
    icon: Shield,
    title: "Comprehensive Scanning",
    description: "Detect vulnerabilities, misconfigurations, and security issues across your entire web application.",
  },
  {
    icon: Zap,
    title: "Instant Results",
    description: "Get detailed security reports in seconds. No waiting, no queues, just fast and reliable scanning.",
  },
  {
    icon: Clock,
    title: "Scheduled Scans",
    description: "Set up automated scans to run on your schedule. Stay on top of security without manual effort.",
  },
  {
    icon: Globe,
    title: "API Access",
    description: "Integrate security scanning into your CI/CD pipeline with our powerful REST API.",
  },
  {
    icon: Lock,
    title: "SSL/TLS Analysis",
    description: "Deep analysis of your SSL/TLS configuration, certificate validity, and cipher suites.",
  },
  {
    icon: Users,
    title: "Team Collaboration",
    description: "Share scan results, collaborate on fixes, and track security improvements together.",
  },
]

export default function PricingPage() {
  const { me } = useAuth()
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly")
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null)

  const currentPlan = me?.plan || "free"
  const isGifted = me?.subscriptionStatus === "gifted"

  const getStripeProductId = (planId: string) => {
    return `${planId}_${billing === "yearly" ? "yearly" : "monthly"}`
  }

  const getPrice = (basePrice: number) => {
    if (basePrice === 0) return 0
    return billing === "yearly" ? Math.round(basePrice * 0.8 * 12) : basePrice
  }

  // When billing is disabled, show a simple message
  if (!BILLING_ENABLED) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center max-w-lg px-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <Check className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold mb-3">Unlimited Access</h1>
          <p className="text-muted-foreground mb-6">
            This {APP_NAME} instance has billing disabled. All users have unlimited access to all features - no payment required.
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
    <PublicPageShell maxWidth="max-w-7xl" padding="py-0">
      <div>

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

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Subtle grid background */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--border))_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border))_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_110%)] opacity-40" />
        
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
          <div className="text-center max-w-3xl mx-auto">
            <Badge variant="secondary" className="mb-4 gap-1.5">
              <Sparkles className="h-3 w-3" />
              Simple, transparent pricing
            </Badge>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4 text-balance">
              Plans and Pricing
            </h1>
            <p className="text-lg text-muted-foreground mb-8 text-pretty">
              Get started immediately for free. Upgrade for more scans, longer history, and priority support.
            </p>

            {/* Billing Toggle */}
            <div className="inline-flex items-center gap-1 p-1 rounded-full bg-muted/50 border border-border">
              <button
                onClick={() => setBilling("monthly")}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium transition-all",
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
                  "px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-1.5",
                  billing === "yearly" 
                    ? "bg-background text-foreground shadow-sm" 
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Yearly
                <span className="text-xs text-primary font-semibold">-20%</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
          {PLANS.map((plan) => {
            const price = getPrice(plan.price)
            const isCurrentPlan = currentPlan === plan.id

            return (
              <div
                key={plan.id}
                className={cn(
                  "relative flex flex-col rounded-2xl border bg-card p-6 transition-all",
                  plan.popular 
                    ? "border-primary shadow-lg shadow-primary/10 ring-1 ring-primary" 
                    : "border-border hover:border-border/80"
                )}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground shadow-lg">
                      Recommended
                    </Badge>
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="text-lg font-semibold mb-1">{plan.name}</h3>
                  <p className="text-sm text-muted-foreground">{plan.description}</p>
                </div>

                <div className="mb-6">
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold">${price}</span>
                    {plan.price > 0 && (
                      <span className="text-muted-foreground">/{billing === "yearly" ? "year" : "month"}</span>
                    )}
                  </div>
                  {plan.price === 0 && (
                    <p className="text-sm text-muted-foreground mt-1">Free forever</p>
                  )}
                  {plan.price > 0 && billing === "yearly" && (
                    <p className="text-xs text-primary mt-1">
                      ${Math.round(price / 12)}/mo billed annually
                    </p>
                  )}
                </div>

                <div className="flex-1 mb-6">
                  <ul className="space-y-3">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm">
                        <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {isCurrentPlan ? (
                  <Button variant="outline" className={cn("w-full", isGifted && "border-amber-500/50 text-amber-500")} disabled>
                    {isGifted ? "Gifted Plan" : "Current Plan"}
                  </Button>
                ) : plan.price === 0 ? (
                  <Button variant={plan.popular ? "default" : "outline"} className="w-full" asChild>
                    <Link href={me ? ROUTES.DASHBOARD : ROUTES.SIGNUP}>
                      {me ? "Go to Scanner" : "Start Building"}
                    </Link>
                  </Button>
                ) : me ? (
                  <Button
                    variant={plan.popular ? "default" : "outline"}
                    className="w-full"
                    onClick={() => setCheckoutPlan(getStripeProductId(plan.stripeId!))}
                  >
                    Upgrade to {plan.name}
                  </Button>
                ) : (
                  <Button variant={plan.popular ? "default" : "outline"} className="w-full" asChild>
                    <Link href={ROUTES.SIGNUP}>Get Started</Link>
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* Enterprise CTA */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-20">
        <div className="rounded-2xl border border-border bg-card p-8 sm:p-12">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-bold mb-2">Enterprise</h2>
              <p className="text-muted-foreground">
                For large companies that require additional security, custom integrations, and dedicated support. 
                Contact us for custom pricing and SLA agreements.
              </p>
            </div>
            <Button size="lg" variant="outline" className="shrink-0" asChild>
              <a href={`mailto:${ENTERPRISE_EMAIL}`}>Contact Us</a>
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mt-8 pt-8 border-t border-border">
            {[
              "Unlimited scans",
              "Custom integrations",
              "SSO/SAML support",
              "Dedicated support",
              "SLA guarantee",
            ].map((feature) => (
              <div key={feature} className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-primary" />
                <span>{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="border-t border-border bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-20">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold mb-3">Everything you need for web security</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              All plans include our core security scanning features. Upgrade for more capacity and support.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="flex gap-4">
                <div className="shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <feature.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-20">
        <h2 className="text-2xl font-bold text-center mb-12">Frequently asked questions</h2>
        <div className="space-y-6">
          {[
            {
              q: "Can I cancel my subscription anytime?",
              a: "Yes, you can cancel your subscription at any time. You'll continue to have access until the end of your billing period.",
            },
            {
              q: "What payment methods do you accept?",
              a: "We accept all major credit cards through Stripe, including Visa, Mastercard, and American Express.",
            },
            {
              q: "Is there a free trial for paid plans?",
              a: "We offer a generous free tier instead of a trial. Start with 50 scans/day free, then upgrade when you need more.",
            },
            {
              q: "Can I switch plans later?",
              a: "Absolutely. You can upgrade or downgrade your plan at any time. Changes take effect immediately.",
            },
            {
              q: "Do you offer refunds?",
              a: "We offer a 14-day money-back guarantee on all paid plans. Contact support if you're not satisfied.",
            },
          ].map((faq, i) => (
            <div key={i} className="border-b border-border pb-6 last:border-0">
              <h3 className="font-medium mb-2">{faq.q}</h3>
              <p className="text-sm text-muted-foreground">{faq.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-border bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16 text-center">
          <h2 className="text-2xl font-bold mb-3">Ready to secure your applications?</h2>
          <p className="text-muted-foreground mb-6">Start scanning for free today. No credit card required.</p>
          <Button size="lg" asChild>
            <Link href={me ? ROUTES.DASHBOARD : ROUTES.SIGNUP}>
              {me ? "Go to Scanner" : "Get Started Free"}
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <ThemedLogo width={20} height={20} className="h-5 w-5" alt={APP_NAME} />
              <span>{APP_NAME}</span>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/docs" className="hover:text-foreground transition-colors">Docs</Link>
              <Link href="/changelog" className="hover:text-foreground transition-colors">Changelog</Link>
              <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-foreground transition-colors">Support</a>
            </div>
          </div>
        </div>
      </footer>
      </div>
    </PublicPageShell>
  )
}
