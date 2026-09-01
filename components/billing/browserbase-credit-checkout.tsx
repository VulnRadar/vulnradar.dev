"use client";

import { useCallback, useState } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import { ROUTES } from "@/lib/config/client-constants";
import {
  createBrowserbaseCreditPaymentIntent,
  confirmBrowserbaseCreditPurchase,
} from "@/app/actions/stripe";
import type { BrowserbaseCreditTier } from "@/lib/billing/browserbase-credit-catalog";
import { CHECKOUT_CONFIRM_BACKOFF_MS } from "./checkout-confirm";
import { InlineAlert } from "@/components/shared/inline-alert";

/**
 * Copied verbatim from components/billing/ai-credit-checkout.tsx's own
 * PaymentFormSkeleton, same reasoning: kept as its own copy instead of an
 * import so this file never has to touch the flows it's deliberately not
 * modifying.
 */
function PaymentFormSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading payment form">
      <div className="flex gap-2">
        <Skeleton className="h-10 flex-1 rounded-md" />
        <Skeleton className="h-10 flex-1 rounded-md" />
        <Skeleton className="h-10 flex-1 rounded-md" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-10 w-full rounded-md" />
        <Skeleton className="h-10 w-full rounded-md" />
        <div className="flex gap-3">
          <Skeleton className="h-10 flex-1 rounded-md" />
          <Skeleton className="h-10 flex-1 rounded-md" />
        </div>
      </div>
      <Skeleton className="h-11 w-full rounded-md" />
    </div>
  );
}

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
);

type ConfirmStatus = "idle" | "confirming" | "verified" | "pending";

/**
 * Confirms a Browserbase credit purchase directly against Stripe via the
 * confirmBrowserbaseCreditPurchase server action -- mirrors
 * ai-credit-checkout.tsx's useConfirmAiCreditPurchase exactly, same retry/
 * backoff schedule for the same reason.
 */
function useConfirmBrowserbaseCreditPurchase(
  onSuccess?: (minutes: number, balanceSeconds: number) => void,
) {
  const [status, setStatus] = useState<ConfirmStatus>("idle");
  const [minutes, setMinutes] = useState(0);
  const [balanceSeconds, setBalanceSeconds] = useState(0);

  const run = useCallback(
    async (paymentIntentId: string) => {
      setStatus("confirming");
      const delays = CHECKOUT_CONFIRM_BACKOFF_MS;
      for (let attempt = 0; attempt <= delays.length; attempt++) {
        try {
          const result =
            await confirmBrowserbaseCreditPurchase(paymentIntentId);
          if (result.succeeded) {
            setMinutes(result.minutes);
            setBalanceSeconds(result.balanceSeconds);
            setStatus("verified");
            onSuccess?.(result.minutes, result.balanceSeconds);
            return;
          }
        } catch {
          // Transient error (network blip, Stripe API hiccup) -- fall
          // through to the retry/backoff below instead of giving up.
        }
        if (attempt < delays.length) {
          await new Promise<void>((r) => setTimeout(r, delays[attempt]));
        }
      }
      setStatus("pending");
    },
    [onSuccess],
  );

  return { status, minutes, balanceSeconds, run };
}

function ConfirmingStatus() {
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
        Payment taken. Adding your minutes
      </h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-xs">
        This usually lands in a few seconds. Your card has already been charged,
        so it is safe to leave.
      </p>
      <Button
        variant="ghost"
        size="sm"
        asChild
        className="text-muted-foreground hover:text-foreground"
      >
        <Link href={`${ROUTES.PROFILE}?tab=billing`}>Go to Billing now</Link>
      </Button>
    </div>
  );
}

function VerifiedStatus({
  minutes,
  balanceSeconds,
}: {
  minutes: number;
  balanceSeconds: number;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center py-10 text-center"
      role="status"
    >
      <div className="w-14 h-14 rounded-full bg-[hsl(var(--success))]/10 flex items-center justify-center mb-5">
        <Check
          className="h-7 w-7 text-[hsl(var(--success))]"
          aria-hidden="true"
        />
      </div>
      <h3 className="text-xl font-semibold mb-2">
        {minutes.toLocaleString()} minute{minutes === 1 ? "" : "s"} added
      </h3>
      <p className="text-muted-foreground mb-6">
        Your purchased balance is now{" "}
        <span className="font-medium text-foreground">
          {(balanceSeconds / 60).toLocaleString()}
        </span>{" "}
        minutes. They never expire and are only spent once your plan&apos;s free
        monthly allowance runs out.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button size="lg" variant="outline" className="h-11 px-6 gap-2" asChild>
          <Link href={`${ROUTES.PROFILE}?tab=billing`}>Back to Billing</Link>
        </Button>
        <Button size="lg" className="h-11 px-6 gap-2" asChild>
          <Link href={ROUTES.DASHBOARD}>Start scanning</Link>
        </Button>
      </div>
    </div>
  );
}

function PendingStatus() {
  return (
    <div
      className="flex flex-col items-center justify-center py-10 text-center"
      role="status"
    >
      <div className="w-14 h-14 rounded-full bg-[hsl(var(--warning))]/10 flex items-center justify-center mb-5">
        <AlertTriangle
          className="h-7 w-7 text-[hsl(var(--warning))]"
          aria-hidden="true"
        />
      </div>
      <h3 className="text-xl font-semibold mb-2">Still confirming</h3>
      <p className="text-muted-foreground mb-6 max-w-sm">
        Stripe took the payment, but we have not been able to confirm it yet.
        This can happen with some payment methods. Refresh this page in a
        minute, or check Profile &gt; Billing.
      </p>
      <Button size="lg" className="h-11 px-6 gap-2" variant="outline" asChild>
        <Link href={`${ROUTES.PROFILE}?tab=billing`}>Go to Billing</Link>
      </Button>
    </div>
  );
}

function CheckoutForm({
  tierId,
  onSuccess,
}: {
  tierId: string;
  onSuccess?: (minutes: number, balanceSeconds: number) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { status, minutes, balanceSeconds, run } =
    useConfirmBrowserbaseCreditPurchase(onSuccess);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setIsProcessing(true);
    setError(null);

    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message ?? "Please check your payment details");
      setIsProcessing(false);
      return;
    }

    let paymentIntent: Awaited<
      ReturnType<typeof createBrowserbaseCreditPaymentIntent>
    >;
    try {
      paymentIntent = await createBrowserbaseCreditPaymentIntent(tierId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start checkout");
      setIsProcessing(false);
      return;
    }

    const { error: confirmError, paymentIntent: confirmedIntent } =
      await stripe.confirmPayment({
        elements,
        clientSecret: paymentIntent.clientSecret,
        confirmParams: {
          return_url: `${window.location.origin}/checkout/success?kind=browser-credits`,
        },
        redirect: "if_required",
      });

    if (confirmError) {
      setError(confirmError.message ?? "Payment failed");
      setIsProcessing(false);
      return;
    }

    if (
      confirmedIntent?.status === "succeeded" ||
      confirmedIntent?.status === "processing"
    ) {
      await run(paymentIntent.paymentIntentId);
    } else {
      setError("Payment was not completed. Please try again.");
      setIsProcessing(false);
    }
  };

  if (status === "verified") {
    return <VerifiedStatus minutes={minutes} balanceSeconds={balanceSeconds} />;
  }
  if (status === "confirming") return <ConfirmingStatus />;
  if (status === "pending") return <PendingStatus />;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <PaymentElement
        options={{
          layout: "tabs",
        }}
      />
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
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
          "Buy minutes"
        )}
      </Button>
    </form>
  );
}

export function BrowserbaseCreditCheckout({
  tier,
  onSuccess,
}: {
  tier: BrowserbaseCreditTier;
  onSuccess?: (minutes: number, balanceSeconds: number) => void;
}) {
  const { resolvedTheme } = useTheme();

  if (resolvedTheme === undefined) return <PaymentFormSkeleton />;

  // Copied from ai-credit-checkout.tsx's own two Appearance API themes --
  // see that file's comment for why this isn't a shared import.
  const isDark = resolvedTheme === "dark";
  const appearance = isDark
    ? {
        theme: "night" as const,
        variables: {
          colorPrimary: "hsl(213, 94%, 68%)",
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
            border: "1px solid hsl(213, 94%, 68%)",
            boxShadow: "0 0 0 1px hsl(213, 94%, 68%)",
          },
        },
      }
    : {
        theme: "stripe" as const,
        variables: {
          colorPrimary: "hsl(213, 94%, 68%)",
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
            border: "1px solid hsl(213, 94%, 68%)",
            boxShadow: "0 0 0 1px hsl(213, 94%, 68%)",
          },
        },
      };

  return (
    <Elements
      key={`${tier.id}-${isDark ? "dark" : "light"}`}
      stripe={stripePromise}
      options={{
        mode: "payment",
        amount: tier.priceInCents,
        currency: "usd",
        appearance,
      }}
    >
      <CheckoutForm tierId={tier.id} onSuccess={onSuccess} />
    </Elements>
  );
}
