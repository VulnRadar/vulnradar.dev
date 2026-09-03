"use client";

import { useCallback, useState } from "react";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { Loader2 } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ROUTES } from "@/lib/config/client-constants";
import { useAuth } from "@/components/providers/auth-provider";
import { createSubscription, confirmSubscription } from "@/app/actions/stripe";
import { getPlanById } from "@/lib/billing/catalog";
import { CHECKOUT_CONFIRM_BACKOFF_MS } from "./checkout-confirm";
import {
  CheckoutStatus,
  PaymentFormSkeleton,
  stripeAppearance,
} from "./checkout-status";
import { InlineAlert } from "@/components/shared/inline-alert";

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
      const delays = CHECKOUT_CONFIRM_BACKOFF_MS;
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

  // For a change with no Stripe payment to confirm (a staff DB-only plan
  // change): the plan is already written server-side, so just show success.
  const markVerified = useCallback(
    (plan: string) => {
      setResolvedPlan(plan);
      setStatus("verified");
      onSuccess?.();
    },
    [onSuccess],
  );

  return { status, resolvedPlan, run, markVerified };
}

// The escape hatch used to call onSuccess(), which swapped this screen for
// "You are subscribed" without going anywhere: the user was told the
// subscription had confirmed while it was in fact still retrying, and was left
// sitting on the checkout route. It navigates for real now, the same way the
// three credit purchase screens do.
function ConfirmingStatus() {
  return (
    <CheckoutStatus
      tone="progress"
      title="Payment taken. Switching your plan over"
      description="This usually lands in a few seconds. Your card has already been charged, so it is safe to leave."
      action={
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="text-muted-foreground hover:text-foreground"
        >
          <Link href={ROUTES.DASHBOARD}>Go to the dashboard now</Link>
        </Button>
      }
    />
  );
}

function VerifiedStatus({ plan }: { plan: string }) {
  return (
    <CheckoutStatus
      tone="success"
      title="You are subscribed"
      description={
        <>
          Your account is on{" "}
          <span className="font-medium text-foreground">
            {getPlanById(plan)?.name || plan}
          </span>{" "}
          now. The new scan limit applies immediately.
        </>
      }
      action={
        <Button size="lg" className="h-11 px-6 gap-2" asChild>
          <Link href={ROUTES.DASHBOARD}>Start scanning</Link>
        </Button>
      }
    />
  );
}

function PendingStatus() {
  return (
    <CheckoutStatus
      tone="warning"
      title="Still confirming"
      description="Stripe took the payment, but we have not been able to confirm it yet. This can happen with some payment methods. Refresh this page in a minute, or check the dashboard."
      action={
        <Button size="lg" className="h-11 px-6 gap-2" variant="outline" asChild>
          <Link href={ROUTES.DASHBOARD}>Go to dashboard</Link>
        </Button>
      }
    />
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
  const { isStaff } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { status, resolvedPlan, run, markVerified } =
    useConfirmSubscription(onSuccess);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setIsProcessing(true);
    setError(null);

    // Returns false (and renders the message) when the card details are not
    // valid, so callers can bail out.
    const validateCard = async () => {
      const { error: submitError } = await elements.submit();
      if (submitError) {
        // Stripe almost always gives a specific message here; this fallback is
        // for the rare case it does not, and it still has to name the failure
        // and the fix rather than say "try again".
        setError(
          submitError.message ??
            "Your card details did not validate. Check the card number, expiry date and CVC, then submit again. Nothing has been charged.",
        );
        setIsProcessing(false);
        return false;
      }
      return true;
    };

    // Validate the card BEFORE anything exists on Stripe's side, the way
    // credit-checkout.tsx does: creating the subscription first meant every
    // mistyped card number left an orphan incomplete subscription behind.
    //
    // Staff are the one exception, and the reason the old order existed: a
    // staff account changing to a plan at or below its free floor resolves to
    // "db_updated", a DB-only change with no payment, so it must not be
    // blocked by an empty card form it never needs to fill in. Its card is
    // validated below instead, on the branch that actually charges.
    if (!isStaff && !(await validateCard())) return;

    let subscription: Awaited<ReturnType<typeof createSubscription>>;
    try {
      subscription = await createSubscription(productId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start checkout");
      setIsProcessing(false);
      return;
    }

    if (subscription.kind === "db_updated") {
      // Staff floor change: plan already written server-side, nothing to charge.
      markVerified(subscription.plan);
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

    // "new": a real purchase. Everyone but staff already validated above; a
    // staff account that turned out to be making a real payment validates now.
    if (isStaff && !(await validateCard())) return;

    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      clientSecret: subscription.clientSecret,
      confirmParams: {
        // ?kind= tells /checkout/success what it is confirming. Without it the
        // page assumed a subscription for every flow, so a redirect-method
        // credit top-up polled for a plan change that was never going to
        // happen and then warned that a successful payment had failed.
        return_url: `${window.location.origin}/checkout/success?kind=subscription`,
      },
      redirect: "if_required",
    });

    if (confirmError) {
      setError(
        confirmError.message ??
          "Stripe could not take the payment and did not say why. Nothing has been charged. Submit again, or use a different card.",
      );
      setIsProcessing(false);
      return;
    }

    if (
      paymentIntent?.status === "succeeded" ||
      paymentIntent?.status === "processing"
    ) {
      await run(subscription.subscriptionId);
    } else {
      // Reached when the intent comes back in any other state (requires_action
      // that the browser could not complete, canceled, still requiring a
      // payment method). Nothing is captured in any of them.
      setError(
        "Your bank did not complete the payment, so nothing has been charged and your plan has not changed. Submit again, or use a different card.",
      );
      setIsProcessing(false);
    }
  };

  if (status === "verified") return <VerifiedStatus plan={resolvedPlan!} />;
  if (status === "confirming") {
    return <ConfirmingStatus />;
  }
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
  const { status, resolvedPlan, run, markVerified } =
    useConfirmSubscription(onSuccess);

  const handleSwitch = async () => {
    setIsProcessing(true);
    setError(null);
    try {
      const result = await createSubscription(productId);
      if (result.kind === "db_updated") {
        // Staff DB-only plan change (no Stripe subscription to confirm).
        markVerified(result.plan);
        return;
      }
      await run(result.subscriptionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to switch plans");
      setIsProcessing(false);
    }
  };

  if (status === "verified") return <VerifiedStatus plan={resolvedPlan!} />;
  if (status === "confirming") {
    return <ConfirmingStatus />;
  }
  if (status === "pending") return <PendingStatus />;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        You already have an active subscription. Switching plans prorates the
        difference on your existing payment method, no new card details needed.
      </p>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
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

  // Stripe renders in an iframe, so it cannot inherit our CSS variables.
  // stripeAppearance() resolves them off the document root instead of keeping
  // a hand-written second palette here; see checkout-status.tsx for why.
  const isDark = resolvedTheme === "dark";
  const appearance = stripeAppearance(isDark);

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
