"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Check } from "lucide-react"
import { SUBSCRIPTION_PLAN_DETAILS, SUBSCRIPTION_PLANS } from "@/lib/constants"

interface UserData {
  subscriptionPlan: string
  subscriptionTier: number
}

export default function PricingPage() {
  const [user, setUser] = useState<UserData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const res = await fetch("/api/auth/me")
        if (res.ok) {
          const data = await res.json()
          setUser(data.data)
        }
      } catch (error) {
        console.error("Failed to fetch user:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchUser()
  }, [])

  const plans = [
    {
      key: SUBSCRIPTION_PLANS.FREE,
      name: SUBSCRIPTION_PLAN_DETAILS.FREE.label,
      price: SUBSCRIPTION_PLAN_DETAILS.FREE.price,
      description: "Perfect for getting started",
      features: SUBSCRIPTION_PLAN_DETAILS.FREE.features,
      highlighted: false,
    },
    {
      key: SUBSCRIPTION_PLANS.PRO,
      name: SUBSCRIPTION_PLAN_DETAILS.PRO.label,
      price: SUBSCRIPTION_PLAN_DETAILS.PRO.price,
      description: "Best for professionals",
      features: SUBSCRIPTION_PLAN_DETAILS.PRO.features,
      highlighted: true,
    },
    {
      key: SUBSCRIPTION_PLANS.ELITE,
      name: SUBSCRIPTION_PLAN_DETAILS.ELITE.label,
      price: SUBSCRIPTION_PLAN_DETAILS.ELITE.price,
      description: "For power users",
      features: SUBSCRIPTION_PLAN_DETAILS.ELITE.features,
      highlighted: false,
    },
  ]

  return (
    <main className="min-h-screen bg-background py-12 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4">Simple, Transparent Pricing</h1>
          <p className="text-xl text-muted-foreground">Choose the plan that works best for you</p>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Loading your plan...</p>
          </div>
        )}

        {/* Pricing Cards */}
        {!loading && (
          <div className="grid md:grid-cols-3 gap-6 mb-12">
            {plans.map((plan) => {
              const isCurrentPlan = user?.subscriptionPlan === plan.key
              return (
                <Card
                  key={plan.key}
                  className={`relative overflow-hidden transition-all ${
                    plan.highlighted ? "border-primary shadow-lg md:scale-105" : ""
                  } ${isCurrentPlan ? "ring-2 ring-primary" : ""}`}
                >
                  {/* Badge for current plan */}
                  {isCurrentPlan && (
                    <div className="absolute top-0 right-0 bg-primary text-primary-foreground px-3 py-1 text-sm font-semibold rounded-bl-lg">
                      Current Plan
                    </div>
                  )}

                  {/* Popular Badge */}
                  {plan.highlighted && (
                    <div className="absolute top-0 left-0 right-0 bg-primary text-primary-foreground py-2 text-center text-sm font-semibold">
                      Most Popular
                    </div>
                  )}

                  <div className={`p-6 ${plan.highlighted ? "pt-14" : ""}`}>
                    {/* Plan Name */}
                    <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
                    <p className="text-sm text-muted-foreground mb-6">{plan.description}</p>

                    {/* Pricing */}
                    <div className="mb-6">
                      <span className="text-4xl font-bold">${plan.price}</span>
                      {plan.price > 0 && <span className="text-muted-foreground ml-2">/month</span>}
                      {plan.price === 0 && <span className="text-muted-foreground ml-2">Forever free</span>}
                    </div>

                    {/* CTA Button */}
                    <Button
                      className="w-full mb-6"
                      variant={isCurrentPlan ? "outline" : plan.highlighted ? "default" : "outline"}
                      disabled={isCurrentPlan}
                    >
                      {isCurrentPlan ? "Current Plan" : "Upgrade to " + plan.name}
                    </Button>

                    {/* Features */}
                    <div className="space-y-3">
                      {plan.features.map((feature, idx) => (
                        <div key={idx} className="flex items-start gap-3">
                          <Check className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                          <span className="text-sm">{feature}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}

        {/* FAQ or additional info */}
        <div className="max-w-2xl mx-auto bg-muted/50 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">FAQ</h2>
          <div className="space-y-4 text-sm">
            <div>
              <h4 className="font-medium mb-2">Can I switch plans?</h4>
              <p className="text-muted-foreground">Yes, you can upgrade or downgrade your plan at any time.</p>
            </div>
            <div>
              <h4 className="font-medium mb-2">Is there a free trial?</h4>
              <p className="text-muted-foreground">Start with our Free plan and upgrade whenever you're ready.</p>
            </div>
            <div>
              <h4 className="font-medium mb-2">Need help choosing?</h4>
              <p className="text-muted-foreground">Contact our support team at support@vulnradar.dev</p>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
