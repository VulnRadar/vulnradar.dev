"use client"

import { useState } from "react"
import { Check, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { APP_NAME, ROUTES, BILLING_ENABLED, BILLING_PLAN_LIMITS, BILLING_HISTORY_RETENTION } from "@/lib/config/constants"
import Link from "next/link"
import { useAuth } from "@/components/providers/auth-provider"
import { PLANS as LIB_PLANS } from "@/lib/billing/plans"
import { Footer } from "@/components/scanner/footer"
import { LandingNav } from "@/components/landing/landing-nav"
import { PricingHero } from "@/components/pricing/pricing-hero"
import { PricingCards } from "@/components/pricing/pricing-cards"
import { PricingFeatures } from "@/components/pricing/pricing-features"
import { PricingFaq } from "@/components/pricing/pricing-faq"
import { PricingCta } from "@/components/pricing/pricing-cta"
import { CheckoutModal } from "@/components/pricing/checkout-modal"

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
    features.push("Everything in Free", getRetentionLabel("core_supporter"), "Email support", "Early access features", "Premium badge")
  } else if (libPlan.id === "pro_supporter") {
    features.push("Everything in Core", getRetentionLabel("pro_supporter"), "Priority support", "5,000 API requests/day", "Premium badge")
  } else if (libPlan.id === "elite_supporter") {
    features.push("Everything in Pro", "Unlimited API access", "Dedicated support", "Beta features access", "Premium badge")
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

export default function PricingPage() {
  const { me } = useAuth()
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly")
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null)

  const currentPlan = me?.plan || "free"
  const isGifted = me?.subscriptionStatus === "gifted"
  const isLoggedIn = !!me?.userId

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
      <LandingNav />

      <main className="flex-1">
        {/* Checkout Modal */}
        {checkoutPlan && me?.userId && (
          <CheckoutModal
            planId={checkoutPlan}
            userId={me.userId}
            billing={billing}
            onClose={() => setCheckoutPlan(null)}
            onSuccess={() => setCheckoutPlan(null)}
          />
        )}

        <PricingHero billing={billing} onBillingChange={setBilling} />
        
        <PricingCards
          plans={PLANS}
          billing={billing}
          currentPlan={currentPlan}
          isGifted={isGifted}
          isLoggedIn={isLoggedIn}
          onSelectPlan={setCheckoutPlan}
        />
        
        <PricingFeatures />
        <PricingFaq />
        <PricingCta isLoggedIn={isLoggedIn} />
      </main>

      <Footer />
    </div>
  )
}
