"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { PLANS } from "@/lib/billing/plans";

interface VerifySubscriptionOptions {
  sessionId?: string | null;
  expectedPlanId?: string;
  autoStart?: boolean;
}

interface VerifySubscriptionResult {
  verifying: boolean;
  verified: boolean;
  planName: string | null;
  planId: string | null;
  startVerification: () => void;
}

export function useVerifySubscription(
  options: VerifySubscriptionOptions = {},
): VerifySubscriptionResult {
  const { sessionId, expectedPlanId, autoStart = true } = options;
  const [verifying, setVerifying] = useState(autoStart);
  const [verified, setVerified] = useState(false);
  const [planName, setPlanName] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);

  // Cancellation flag kept in a ref so it survives the whole polling cycle
  // (the old `let isCancelled` was declared inside `verify()` and was
  // captured by a return-cleanup that nothing ever ran, so unmount during
  // polling leaked async state writes to a stale component).
  const cancelledRef = useRef(false);

  const verify = useCallback(async () => {
    cancelledRef.current = false;
    setVerifying(true);

    const pollIntervals = [
      ...Array(5).fill(500),
      ...Array(5).fill(1000),
      ...Array(5).fill(2000),
    ];

    const url = sessionId
      ? `/api/v2/checkout/verify-subscription?session_id=${encodeURIComponent(sessionId)}`
      : "/api/v2/checkout/verify-subscription";

    for (let i = 0; i < pollIntervals.length; i++) {
      if (cancelledRef.current) return;

      try {
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          const currentPlan = data.data?.plan || "free";

          const isActive = currentPlan !== "free";
          const matchesExpected = expectedPlanId
            ? currentPlan === expectedPlanId
            : isActive;

          if (matchesExpected) {
            const plan = PLANS.find((p) => p.id === currentPlan);
            if (!cancelledRef.current) {
              setPlanId(currentPlan);
              setPlanName(plan?.name || currentPlan);
              setVerified(true);
              setVerifying(false);
            }
            return;
          }
        }
      } catch {
        // Ignore fetch errors, will retry
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervals[i]));
    }

    if (!cancelledRef.current) {
      setVerified(true);
      setVerifying(false);
    }
  }, [sessionId, expectedPlanId]);

  const startVerification = useCallback(() => {
    verify();
  }, [verify]);

  useEffect(() => {
    if (autoStart) {
      verify();
    }
    // On unmount (or when deps change), flip the flag so any in-flight
    // polling loop bails before its next setState.
    return () => {
      cancelledRef.current = true;
    };
  }, [autoStart, verify]);

  return {
    verifying,
    verified,
    planName,
    planId,
    startVerification,
  };
}
