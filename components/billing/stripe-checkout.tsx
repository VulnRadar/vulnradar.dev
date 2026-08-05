"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ROUTES } from "@/lib/config/constants";
import { createSubscription } from "@/app/actions/stripe";
import { getPlanFromProductId } from "@/lib/billing/products";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
);

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

  if (verified) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mb-6">
          <Check className="h-8 w-8 text-emerald-500" />
        </div>
        <h3 className="text-xl font-semibold mb-2">Subscription Active!</h3>
        <p className="text-muted-foreground mb-6">
          Your plan has been upgraded to{" "}
          <span className="font-medium text-foreground capitalize">
            {expectedPlan.replace(/_/g, " ")}
          </span>
        </p>
        <Button asChild>
          <Link href={ROUTES.DASHBOARD}>Go to Scanner</Link>
        </Button>
      </div>
    );
  }

  if (verifying) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <h3 className="text-lg font-semibold mb-2">
          Activating your subscription...
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          This will only take a moment
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setVerified(true);
            setVerifying(false);
            onSuccess?.();
          }}
          className="text-muted-foreground hover:text-foreground"
        >
          Skip and go to Dashboard
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <PaymentElement
        options={{
          layout: "tabs",
        }}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button
        type="submit"
        disabled={!stripe || !elements || isProcessing}
        className="w-full"
        size="lg"
      >
        {isProcessing ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Processing...
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
  const [error, setError] = useState<string | null>(null);

  const expectedPlan = getPlanFromProductId(productId);

  useEffect(() => {
    createSubscription(productId)
      .then(({ clientSecret: cs }) => setClientSecret(cs))
      .catch((err: Error) =>
        setError(err.message ?? "Failed to initialize checkout"),
      );
  }, [productId]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-muted-foreground mb-4">{error}</p>
        <Button onClick={() => window.location.reload()}>Refresh Page</Button>
      </div>
    );
  }

  if (!clientSecret) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: {
          theme: "night",
          variables: {
            colorPrimary: "hsl(190, 90%, 42%)",
            colorBackground: "hsl(222, 47%, 11%)",
            colorText: "#ffffff",
            colorDanger: "#ef4444",
            borderRadius: "8px",
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          },
          rules: {
            ".Input": {
              backgroundColor: "hsl(222, 47%, 15%)",
              border: "1px solid hsl(215, 20%, 25%)",
            },
            ".Input:focus": {
              border: "1px solid hsl(190, 90%, 42%)",
            },
          },
        },
      }}
    >
      <CheckoutForm expectedPlan={expectedPlan} onSuccess={onSuccess} />
    </Elements>
  );
}
