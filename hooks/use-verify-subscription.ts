"use client"

import { useState, useEffect, useCallback } from "react"
import { PLANS } from "@/lib/billing/plans"

interface VerifySubscriptionOptions {
  sessionId?: string | null
  expectedPlanId?: string
  autoStart?: boolean
}

interface VerifySubscriptionResult {
  verifying: boolean
  verified: boolean
  planName: string | null
  planId: string | null
  startVerification: () => void
}

export function useVerifySubscription(
  options: VerifySubscriptionOptions = {}
): VerifySubscriptionResult {
  const { sessionId, expectedPlanId, autoStart = true } = options
  const [verifying, setVerifying] = useState(autoStart)
  const [verified, setVerified] = useState(false)
  const [planName, setPlanName] = useState<string | null>(null)
  const [planId, setPlanId] = useState<string | null>(null)

  const verify = useCallback(async () => {
    setVerifying(true)
    let isCancelled = false

    // Poll to verify subscription is active
    const pollIntervals = [
      ...Array(5).fill(500),
      ...Array(5).fill(1000),
      ...Array(5).fill(2000),
    ]

    const url = sessionId
      ? `/api/v2/checkout/verify-subscription?session_id=${encodeURIComponent(sessionId)}`
      : "/api/v2/checkout/verify-subscription"

    for (let i = 0; i < pollIntervals.length; i++) {
      if (isCancelled) return

      try {
        const response = await fetch(url)
        if (response.ok) {
          const data = await response.json()
          const currentPlan = data.data?.plan || "free"

          // Check if subscription is active
          const isActive = currentPlan !== "free"
          
          // If expecting a specific plan, check for that
          const matchesExpected = expectedPlanId 
            ? currentPlan === expectedPlanId 
            : isActive

          if (matchesExpected) {
            const plan = PLANS.find((p) => p.id === currentPlan)
            if (!isCancelled) {
              setPlanId(currentPlan)
              setPlanName(plan?.name || currentPlan)
              setVerified(true)
              setVerifying(false)
            }
            return
          }
        }
      } catch {
        // Ignore fetch errors, will retry
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervals[i]))
    }

    // Assume success after polling (webhook may be slow)
    if (!isCancelled) {
      setVerified(true)
      setVerifying(false)
    }

    return () => {
      isCancelled = true
    }
  }, [sessionId, expectedPlanId])

  const startVerification = useCallback(() => {
    verify()
  }, [verify])

  useEffect(() => {
    if (autoStart) {
      verify()
    }
  }, [autoStart, verify])

  return {
    verifying,
    verified,
    planName,
    planId,
    startVerification,
  }
}
