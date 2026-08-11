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
import { ROUTES } from "@/lib/config/constants";
import { createSubscription, confirmSubscription } from "@/app/actions/stripe";

/** Mirrors the PaymentElement's own shape (tabs row, then card/email
 * fields) so there's no layout jump once Stripe's real form mounts. Only
 * shown for the brief window before the theme is known client-side. */
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
 * Confirms a subscription directly against Stripe via the confirmSubscription
 * server action -- never against our own (possibly stale) DB, and never
 * dependent on the Stripe webhook having reached this server. Retries a
 * handful of times in case an async payment method hasn't fully settled the
 * instant stripe.confirmPayment() returns, and never lies about success on
 * timeout: a genuinely unresolved confirmation lands on "pending", not a
 * fake checkmark.
 */
function useConfirmSubscription(onSuccess?: () => void) {
  const [status, setStatus] = useState<ConfirmStatus>("idle");
  const [resolvedPlan, setResolvedPlan] = useState<string | null>(null);

  const run = useCallback(
    async (subscriptionId: string) => {
      setStatus("confirming");
      const delays = [500, 1000, 1500, 2000, 3000];
      for (let attempt = 0; attempt <= delays.length; attempt++) {
        try {
          const result = await confirmSubscription(subscriptionId);
          if (result.active) {
            setResolvedPlan(result.plan);
            setStatus("verified");
            onSuccess?.();
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

  return { status, resolvedPlan, run };
}

function ConfirmingStatus({ onSkip }: { onSkip: () => void }) {
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

function VerifiedStatus({ plan }: { plan: string }) {
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
          {plan.replace(/_/g, " ")}
        </span>{" "}
        now. The new scan limit applies immediately.
      </p>
      <Button size="lg" className="h-11 px-6 gap-2" asChild>
        <Link href={ROUTES.DASHBOARD}>Start scanning</Link>
      </Button>
    </div>
  );
}

function PendingStatus() {
  return (
    <div
      className="flex flex-col items-center justify-center py-10 text-center"
      role="status"
    >
      <div className="w-14 h-14 rounded-full bg-[hsl(var(--warning)/0.12)] flex items-center justify-center mb-5">
        <AlertTriangle
          className="h-7 w-7 text-[hsl(var(--warning))]"
          aria-hidden="true"
        />
      </div>
      <h3 className="text-xl font-semibold mb-2">Still confirming</h3>
      <p className="text-muted-foreground mb-6 max-w-sm">
        Stripe took the payment, but we have not been able to confirm it yet.
        This can happen with some payment methods. Refresh this page in a
        minute, or check the dashboard.
      </p>
      <Button size="lg" className="h-11 px-6 gap-2" variant="outline" asChild>
        <Link href={ROUTES.DASHBOARD}>Go to dashboard</Link>
      </Button>
    </div>
  );
}

function CheckoutForm({
  productId,
  onSuccess,
}: {
  productId: string;
  onSuccess?: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { status, resolvedPlan, run } = useConfirmSubscription(onSuccess);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setIsProcessing(true);
    setError(null);

    // Validate the payment details BEFORE touching Stripe's subscriptions
    // API at all -- nothing has been created yet at this point, so an
    // invalid card number costs nothing to reject.
    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message ?? "Please check your payment details");
      setIsProcessing(false);
      return;
    }

    let subscription: Awaited<ReturnType<typeof createSubscription>>;
    try {
      subscription = await createSubscription(productId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start checkout");
      setIsProcessing(false);
      return;
    }

    if (subscription.kind === "switched") {
      // Became an in-place plan switch between page load and submit (the
      // account picked up an active subscription in the meantime) --
      // proration bills the existing payment method automatically, no
      // card confirmation needed.
      await run(subscription.subscriptionId);
      return;
    }

    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      clientSecret: subscription.clientSecret,
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
      await run(subscription.subscriptionId);
    } else {
      setError("Payment was not completed. Please try again.");
      setIsProcessing(false);
    }
  };

  if (status === "verified") return <VerifiedStatus plan={resolvedPlan!} />;
  if (status === "confirming") {
    return <ConfirmingStatus onSkip={() => onSuccess?.()} />;
  }
  if (status === "pending") return <PendingStatus />;

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

/** Shown instead of the card form when the account already has an active
 * paid subscription -- switching plans reuses the existing payment method
 * via proration, so there's nothing for the customer to type in. */
function SwitchPlanPanel({
  productId,
  planName,
  onSuccess,
}: {
  productId: string;
  planName: string;
  onSuccess?: () => void;
}) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { status, resolvedPlan, run } = useConfirmSubscription(onSuccess);

  const handleSwitch = async () => {
    setIsProcessing(true);
    setError(null);
    try {
      const result = await createSubscription(productId);
      await run(result.subscriptionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to switch plans");
      setIsProcessing(false);
    }
  };

  if (status === "verified") return <VerifiedStatus plan={resolvedPlan!} />;
  if (status === "confirming") {
    return <ConfirmingStatus onSkip={() => onSuccess?.()} />;
  }
  if (status === "pending") return <PendingStatus />;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        You already have an active subscription. Switching plans prorates the
        difference on your existing payment method, no new card details needed.
      </p>
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
        onClick={handleSwitch}
        disabled={isProcessing}
        className="w-full h-11 gap-2"
        size="lg"
      >
        {isProcessing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Switching...
          </>
        ) : (
          `Switch to ${planName}`
        )}
      </Button>
    </div>
  );
}

export function StripeCheckout({
  productId,
  planName,
  amountCents,
  hasActiveSubscription,
  onSuccess,
}: {
  productId: string;
  planName: string;
  amountCents: number;
  hasActiveSubscription: boolean;
  onSuccess?: () => void;
}) {
  const { resolvedTheme } = useTheme();

  if (hasActiveSubscription) {
    return (
      <SwitchPlanPanel
        productId={productId}
        planName={planName}
        onSuccess={onSuccess}
      />
    );
  }

  // resolvedTheme is undefined until next-themes mounts client-side --
  // wait for it rather than flashing the wrong-themed Stripe form.
  if (resolvedTheme === undefined) return <PaymentFormSkeleton />;

  // Stripe renders in an iframe, so it cannot inherit our CSS variables. Mirror
  // the two themes here instead of shipping a dark form onto a light page.
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
      // Remount on theme flip so Stripe picks up the new appearance.
      key={isDark ? "dark" : "light"}
      stripe={stripePromise}
      options={{
        mode: "subscription",
        amount: amountCents,
        currency: "usd",
        appearance,
      }}
    >
      <CheckoutForm productId={productId} onSuccess={onSuccess} />
    </Elements>
  );
}
