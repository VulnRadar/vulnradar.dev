"use client"

import { useEffect } from "react"

const STRIPE_DONATE_URL = "https://buy.stripe.com/eVq5kEciX75B9y3eIG2Ji04"

export default function DonatePage() {
  useEffect(() => {
    window.location.href = STRIPE_DONATE_URL
  }, [])

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin h-8 w-8 border-4 border-violet-500 border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-muted-foreground">Redirecting to Stripe...</p>
      </div>
    </div>
  )
}

