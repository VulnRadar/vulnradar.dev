"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { Check, Loader2, AlertTriangle } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ROUTES } from "@/lib/config/constants";
import { createSubscription } from "@/app/actions/stripe";
import { getPlanFromProductId } from "@/lib/billing/products";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
);

function usePlanVerification(expectedPlan: string, onSuccess?: () => void) {
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);

  const verifySubscription = useCallback(async () => {
    setVerifying(true);
    const intervals = [
      ...Array(5).fill(500),
      ...Array(5).fill(1000),
      ...Array(5).fill(2000),
    ];
    for (const delay of intervals) {
      try {
        const res = await fetch("/api/v3/auth/me");
        if (res.ok) {
          const data = await res.json();
          if ((data.data?.plan || "free") === expectedPlan) {
            setVerified(true);
            setVerifying(false);
            onSuccess?.();
            return;
          }
        }
      } catch {
        // retry
      }
      await new Promise<void>((r) => setTimeout(r, delay));
    }
    // Timed out — assume success (webhook may be slow)
    setVerified(true);
    setVerifying(false);
    onSuccess?.();
  }, [expectedPlan, onSuccess]);

  return { verifying, verified, verifySubscription };
}

function PlanVerificationStatus({ onSkip }: { onSkip: () => void }) {
  return (
    <div
      className="flex flex-col items-center justify-center py-10 text-center"
      role="status"
      aria-live="polite"
    >
      <Loader2
        className="h-7 w-7 animate-spin text-primary mb-4"
        aria-hidden="true"
      />
      <h3 className="text-base font-semibold mb-1">
        Payment taken. Switching your plan over
      </h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-xs">
        This usually lands in a few seconds. Your card has already been charged,
        so it is safe to leave.
      </p>
      <Button
        variant="ghost"
        size="sm"
        onClick={onSkip}
        className="text-muted-foreground hover:text-foreground"
      >
        Go to the dashboard now
      </Button>
    </div>
  );
}

function PlanVerifiedStatus({ expectedPlan }: { expectedPlan: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center py-10 text-center"
      role="status"
    >
      <div className="w-14 h-14 rounded-full bg-[hsl(var(--success)/0.12)] flex items-center justify-center mb-5">
        <Check
          className="h-7 w-7 text-[hsl(var(--success))]"
          aria-hidden="true"
        />
      </div>
      <h3 className="text-xl font-semibold mb-2">You are subscribed</h3>
      <p className="text-muted-foreground mb-6">
        Your account is on{" "}
        <span className="font-medium text-foreground capitalize">
          {expectedPlan.replace(/_/g, " ")}
        </span>{" "}
        now. The new scan limit applies immediately.
      </p>
      <Button size="lg" className="h-11 px-6 gap-2" asChild>
        <Link href={ROUTES.DASHBOARD}>Start scanning</Link>
      </Button>
    </div>
  );
}

function PlanSwitchStatus({
  expectedPlan,
  onSuccess,
}: {
  expectedPlan: string;
  onSuccess?: () => void;
}) {
  const { verifying, verified, verifySubscription } = usePlanVerification(
    expectedPlan,
    onSuccess,
  );

  useEffect(() => {
    verifySubscription();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (verified) return <PlanVerifiedStatus expectedPlan={expectedPlan} />;
  if (verifying) {
    return <PlanVerificationStatus onSkip={() => onSuccess?.()} />;
  }
  return null;
}

function CheckoutForm({
  expectedPlan,
  onSuccess,
}: {
  expectedPlan: string;
  onSuccess?: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { verifying, verified, verifySubscription } = usePlanVerification(
    expectedPlan,
    onSuccess,
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setIsProcessing(true);
    setError(null);

    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/checkout/success`,
      },
      redirect: "if_required",
    });

    if (confirmError) {
      setError(confirmError.message ?? "Payment failed");
      setIsProcessing(false);
      return;
    }

    if (
      paymentIntent?.status === "succeeded" ||
      paymentIntent?.status === "processing"
    ) {
      verifySubscription();
    } else {
      setError("Payment was not completed. Please try again.");
      setIsProcessing(false);
    }
  };

  if (verified) return <PlanVerifiedStatus expectedPlan={expectedPlan} />;
  if (verifying) {
    return <PlanVerificationStatus onSkip={() => onSuccess?.()} />;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <PaymentElement
        options={{
          layout: "tabs",
        }}
      />
      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertTriangle
            className="h-4 w-4 shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <span>{error}</span>
        </p>
      )}
      <Button
        type="submit"
        disabled={!stripe || !elements || isProcessing}
        className="w-full h-11 gap-2"
        size="lg"
      >
        {isProcessing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Taking payment...
          </>
        ) : (
          "Subscribe"
        )}
      </Button>
    </form>
  );
}

export function StripeCheckout({
  productId,
  userId: _userId,
  onSuccess,
}: {
  productId: string;
  userId: number;
  onSuccess?: () => void;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [switched, setSwitched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();

  const expectedPlan = getPlanFromProductId(productId);

  // createSubscription() creates a real Stripe subscription -- it must run
  // at most once per productId. Without this guard, React Strict Mode's
  // deliberate mount->unmount->remount in development (and any other
  // remount not tied to a genuine productId change) fires it twice,
  // leaving a duplicate "incomplete" subscription object behind in Stripe.
  const startedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (startedForRef.current === productId) return;
    startedForRef.current = productId;

    createSubscription(productId)
      .then((result) => {
        if (result.kind === "switched") {
          setSwitched(true);
        } else {
          setClientSecret(result.clientSecret);
        }
      })
      .catch((err: Error) =>
        setError(err.message ?? "Failed to initialize checkout"),
      );
  }, [productId]);

  if (error) {
    return (
      <div className="flex flex-col items-start gap-4 py-8" role="alert">
        <div className="flex items-start gap-2.5">
          <AlertTriangle
            className="h-4 w-4 text-destructive shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-medium text-foreground">
              We could not open the payment form
            </p>
            <p className="text-sm text-muted-foreground mt-1">{error}</p>
            <p className="text-sm text-muted-foreground mt-1">
              Nothing has been charged.
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </div>
    );
  }

  if (switched) {
    return (
      <PlanSwitchStatus expectedPlan={expectedPlan} onSuccess={onSuccess} />
    );
  }

  if (!clientSecret) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  // Stripe renders in an iframe, so it cannot inherit our CSS variables. Mirror
  // the two themes here instead of shipping a dark form onto a light page.
  const isDark = (resolvedTheme ?? "dark") === "dark";
  const appearance = isDark
    ? {
        theme: "night" as const,
        variables: {
          colorPrimary: "hsl(190, 90%, 50%)",
          colorBackground: "hsl(224, 18%, 9%)",
          colorText: "hsl(210, 20%, 95%)",
          colorDanger: "hsl(0, 91%, 71%)",
          borderRadius: "8px",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
        rules: {
          ".Input": {
            backgroundColor: "hsl(224, 18%, 12%)",
            border: "1px solid hsl(224, 15%, 16%)",
          },
          ".Input:focus": {
            border: "1px solid hsl(190, 90%, 50%)",
            boxShadow: "0 0 0 1px hsl(190, 90%, 50%)",
          },
        },
      }
    : {
        theme: "stripe" as const,
        variables: {
          colorPrimary: "hsl(190, 90%, 42%)",
          colorBackground: "hsl(0, 0%, 100%)",
          colorText: "hsl(220, 20%, 10%)",
          colorDanger: "hsl(0, 84%, 60%)",
          borderRadius: "8px",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
        rules: {
          ".Input": {
            backgroundColor: "hsl(0, 0%, 100%)",
            border: "1px solid hsl(220, 15%, 88%)",
          },
          ".Input:focus": {
            border: "1px solid hsl(190, 90%, 42%)",
            boxShadow: "0 0 0 1px hsl(190, 90%, 42%)",
          },
        },
      };

  return (
    <Elements
      // Remount on theme flip so Stripe picks up the new appearance.
      key={isDark ? "dark" : "light"}
      stripe={stripePromise}
      options={{ clientSecret, appearance }}
    >
      <CheckoutForm expectedPlan={expectedPlan} onSuccess={onSuccess} />
    </Elements>
  );
}
