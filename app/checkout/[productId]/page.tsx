"use client"

import { useEffect, useState, useCallback, use } from "react"
import { useRouter } from "next/navigation"
import { loadStripe } from "@stripe/stripe-js"
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js"
import { Shield, Check, Loader2, ArrowLeft, Sparkles, Zap, Crown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { PRODUCTS, getPlanFromProductId } from "@/lib/billing/products"
import { PLANS } from "@/lib/billing/plans"
import Link from "next/link"
import { ROUTES } from "@/lib/config/constants"

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

export default function CheckoutPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = use(params)
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [userId, setUserId] = useState<number | null>(null)
  const [checkoutComplete, setCheckoutComplete] = useState(false)
  const [verifying, setVerifying] = useState(false)

  const product = PRODUCTS.find((p) => p.id === productId)
  const planId = product ? getPlanFromProductId(product.id) : null
  const plan = planId ? PLANS.find((p) => p.id === planId) : null

  const monthlyPrice = product ? product.priceInCents / 100 : 0
  const isYearly = product?.interval === "year"
  const effectiveMonthly = isYearly ? monthlyPrice / 12 : monthlyPrice

  useEffect(() => {
    async function checkAuth() {
      try {
        const meRes = await fetch("/api/v2/auth/me")
        if (!meRes.ok) {
          router.push(`/auth?redirect=/checkout/${productId}`)
          return
        }
        const meData = await meRes.json()
        setUserId(meData.data?.id)
      } catch {
        router.push(`/auth?redirect=/checkout/${productId}`)
      } finally {
        setLoading(false)
      }
    }

    if (product) {
      checkAuth()
    } else {
      setError("Invalid product")
      setLoading(false)
    }
  }, [productId, product, router])

  const fetchClientSecret = useCallback(async () => {
    const res = await fetch("/api/v2/checkout/create-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId }),
    })

    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || "Failed to initialize checkout")
    }

    const { clientSecret } = await res.json()
    return clientSecret
  }, [productId])

  // Verify subscription after checkout completes
  const verifySubscription = useCallback(async () => {
    setVerifying(true)
    
    const pollIntervals = [
      ...Array(5).fill(500),
      ...Array(5).fill(1000),
      ...Array(5).fill(2000),
    ]
    
    for (let i = 0; i < pollIntervals.length; i++) {
      try {
        const response = await fetch("/api/v2/auth/me")
        if (response.ok) {
          const data = await response.json()
          const currentPlan = data.data?.plan || "free"
          
          if (currentPlan === planId) {
            setVerifying(false)
            setCheckoutComplete(true)
            return
          }
        }
      } catch {
        // Ignore fetch errors, will retry
      }
      
      await new Promise(resolve => setTimeout(resolve, pollIntervals[i]))
    }
    
    // Assume success after polling
    setVerifying(false)
    setCheckoutComplete(true)
  }, [planId])

  const handleComplete = useCallback(() => {
    verifySubscription()
  }, [verifySubscription])

  if (!product || !plan) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Product not found</h1>
          <p className="text-muted-foreground mb-4">The selected plan doesn&apos;t exist.</p>
          <Button asChild>
            <Link href="/pricing">View Plans</Link>
          </Button>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Preparing checkout...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold mb-2">Checkout Error</h1>
          <p className="text-muted-foreground mb-4">{error}</p>
          <div className="flex gap-3 justify-center">
            <Button variant="outline" asChild>
              <Link href="/pricing">Back to Plans</Link>
            </Button>
            <Button onClick={() => window.location.reload()}>Try Again</Button>
          </div>
        </div>
      </div>
    )
  }

  if (verifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Activating your subscription...</h2>
          <p className="text-muted-foreground mb-4">This will only take a moment</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setVerifying(false)
              setCheckoutComplete(true)
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            Skip and go to Dashboard
          </Button>
        </div>
      </div>
    )
  }

  if (checkoutComplete) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-6">
            <Check className="h-8 w-8 text-emerald-500" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Subscription Active!</h1>
          <p className="text-muted-foreground mb-6">
            Your plan has been upgraded to <span className="font-medium text-foreground">{plan.name}</span>
          </p>
          <Button asChild>
            <Link href={ROUTES.DASHBOARD}>Go to Scanner</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 sticky top-0 z-10">
        <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/pricing" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
            <span className="text-sm">Back to plans</span>
          </Link>
          <div className="w-4" /> {/* Spacer for balance */}
        </div>
      </header>

      {/* Main content */}
      <main className="container max-w-5xl mx-auto px-4 py-8 md:py-12">
        <div className="grid md:grid-cols-2 gap-8 md:gap-12">
          {/* Left column - Order summary */}
          <div className="order-2 md:order-1">
            <div className="sticky top-24">
              <div className="text-center md:text-left mb-6">
                <Badge
                  className="mb-4"
                  style={{
                    backgroundColor: `${plan.badge?.color || "#10b981"}18`,
                    color: plan.badge?.color || "#10b981",
                    borderColor: `${plan.badge?.color || "#10b981"}50`,
                  }}
                >
                  {plan.badge?.text || plan.name}
                </Badge>
                <h1 className="text-2xl md:text-3xl font-bold mb-2">Complete your subscription</h1>
                <p className="text-muted-foreground">You&apos;re subscribing to {product.name}</p>
              </div>

              {/* Order Summary Card */}
              <div className="rounded-xl border border-border bg-card p-5 mb-6">
                <h3 className="text-sm font-medium text-muted-foreground mb-4">Order Summary</h3>
                <div className="flex items-start gap-4 mb-4">
                  <div
                    className="h-12 w-12 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${plan.badge?.color || "#10b981"}18` }}
                  >
                    {plan.id.includes("elite") ? (
                      <Crown className="h-6 w-6" style={{ color: plan.badge?.color }} />
                    ) : plan.id.includes("pro") ? (
                      <Zap className="h-6 w-6" style={{ color: plan.badge?.color }} />
                    ) : (
                      <Sparkles className="h-6 w-6" style={{ color: plan.badge?.color }} />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-lg">{product.name}</p>
                    <p className="text-sm text-muted-foreground">{product.description}</p>
                  </div>
                </div>

                <Separator className="my-4" />

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {isYearly ? "Yearly subscription" : "Monthly subscription"}
                    </span>
                    <span className="font-medium">
                      ${monthlyPrice.toFixed(2)}/{isYearly ? "yr" : "mo"}
                    </span>
                  </div>
                  {isYearly && (
                    <div className="flex justify-between text-emerald-500">
                      <span>Annual discount (20% off)</span>
                      <span>Included</span>
                    </div>
                  )}
                </div>

                <Separator className="my-4" />

                <div className="flex justify-between items-center">
                  <span className="font-semibold">Total today</span>
                  <div className="text-right">
                    <span className="text-2xl font-bold">${monthlyPrice.toFixed(2)}</span>
                    <p className="text-xs text-muted-foreground">
                      {isYearly ? `$${effectiveMonthly.toFixed(2)}/mo effective` : "Billed monthly"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Features */}
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="text-sm font-medium text-muted-foreground mb-3">What&apos;s included</h3>
                <ul className="space-y-2">
                  {plan.features.slice(0, 5).map((feature, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                  <li className="flex items-center gap-2 text-sm">
                    <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span>{plan.limits.dailyScans} scans per day</span>
                  </li>
                </ul>
              </div>

              <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground mt-4">
                <div className="flex items-center gap-1">
                  <Shield className="h-3.5 w-3.5" />
                  <span>256-bit SSL encryption</span>
                </div>
                <span>·</span>
                <span>Cancel anytime</span>
              </div>
            </div>
          </div>

          {/* Right column - Payment form */}
          <div className="order-1 md:order-2">
            <div className="rounded-xl border border-border bg-white overflow-hidden max-h-[600px] overflow-y-auto">
              <EmbeddedCheckoutProvider
                stripe={stripePromise}
                options={{
                  fetchClientSecret,
                  onComplete: handleComplete,
                }}
              >
                <EmbeddedCheckout />
              </EmbeddedCheckoutProvider>
            </div>

            <p className="text-center text-xs text-muted-foreground mt-4">
              By subscribing, you agree to our{" "}
              <Link href="/legal/terms" className="underline hover:text-foreground">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link href="/legal/privacy" className="underline hover:text-foreground">
                Privacy Policy
              </Link>
              .
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
