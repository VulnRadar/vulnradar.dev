"use client"

import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/ui/utils"
import { ROUTES } from "@/lib/config/constants"
import Link from "next/link"

interface Plan {
  id: string
  stripeId: string | null
  name: string
  description: string
  price: number
  interval: "month"
  scansPerDay: number
  popular: boolean
  features: string[]
}

interface PricingCardsProps {
  plans: Plan[]
  billing: "monthly" | "yearly"
  currentPlan: string
  isGifted: boolean
  isLoggedIn: boolean
  onSelectPlan?: (planId: string) => void
}

export function PricingCards({ plans, billing, currentPlan, isGifted, isLoggedIn, onSelectPlan }: PricingCardsProps) {
  const getPrice = (basePrice: number) => {
    if (basePrice === 0) return 0
    return billing === "yearly" ? Math.round(basePrice * 0.8 * 12) : basePrice
  }

  const getStripeProductId = (planId: string) => `${planId}_${billing === "yearly" ? "yearly" : "monthly"}`

  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-20">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {plans.map((plan) => {
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
                  <Link href={isLoggedIn ? ROUTES.DASHBOARD : ROUTES.SIGNUP}>
                    {isLoggedIn ? "Go to Scanner" : "Start Free"}
                  </Link>
                </Button>
              ) : isLoggedIn ? (
                <Button
                  variant={plan.popular ? "default" : "outline"}
                  className={cn("w-full h-10", plan.popular && "shadow-md shadow-primary/20")}
                  asChild
                >
                  <Link href={`/checkout/${getStripeProductId(plan.stripeId!)}`}>
                    Upgrade to {plan.name}
                  </Link>
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
  )
}
