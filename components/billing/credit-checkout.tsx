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
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/config/client-constants";
import {
  createAiCreditPaymentIntent,
  confirmAiCreditPurchase,
  createGithubCreditPaymentIntent,
  confirmGithubCreditPurchase,
  createBrowserbaseCreditPaymentIntent,
  confirmBrowserbaseCreditPurchase,
} from "@/app/actions/stripe";
import { CHECKOUT_CONFIRM_BACKOFF_MS } from "./checkout-confirm";
import {
  CheckoutStatus,
  PaymentFormSkeleton,
  stripeAppearance,
} from "./checkout-status";
import { InlineAlert } from "@/components/shared/inline-alert";
import {
  formatUsd,
  type CreditKind,
  type CreditKindId,
  type CreditTier,
} from "./credit-kinds";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
);

interface CreditFlow {
  createIntent: (
    tierId: string,
  ) => Promise<{ clientSecret: string; paymentIntentId: string }>;
  /** Normalised so the form never has to know whether this balance is counted
   *  in tokens or minutes. */
  confirm: (
    paymentIntentId: string,
  ) => Promise<{ succeeded: boolean; amount: number; balance: number }>;
}

/**
 * The only per-kind thing in this file: which pair of server actions to call.
 *
 * ai-credit-checkout.tsx, github-credit-checkout.tsx and
 * browserbase-credit-checkout.tsx were three ~300 line files that a diff put
 * at four differences each, all of them a noun or one of these two function
 * names. Three copies of a payment flow is three places for the retry ladder,
 * the error copy and the confirmation states to drift apart, on the one code
 * path in the app where drifting apart means charging someone and telling them
 * the wrong thing about it.
 */
const FLOWS: Record<CreditKindId, CreditFlow> = {
  ai: {
    createIntent: createAiCreditPaymentIntent,
    confirm: async (paymentIntentId) => {
      const result = await confirmAiCreditPurchase(paymentIntentId);
      return {
        succeeded: result.succeeded,
        amount: result.tokens,
        balance: result.balance,
      };
    },
  },
  github: {
    createIntent: createGithubCreditPaymentIntent,
    confirm: async (paymentIntentId) => {
      const result = await confirmGithubCreditPurchase(paymentIntentId);
      return {
        succeeded: result.succeeded,
        amount: result.tokens,
        balance: result.balance,
      };
    },
  },
  browser: {
    createIntent: createBrowserbaseCreditPaymentIntent,
    confirm: async (paymentIntentId) => {
      const result = await confirmBrowserbaseCreditPurchase(paymentIntentId);
      // Seconds to minutes at the boundary, once: the balance column is
      // seconds (users.browserbase_credit_seconds_balance) and every surface
      // above this line speaks in minutes.
      return {
        succeeded: result.succeeded,
        amount: result.minutes,
        balance: result.balanceSeconds / 60,
      };
    },
  },
};

type ConfirmStatus = "idle" | "confirming" | "pending";

/**
 * Confirms the purchase directly against Stripe, right after the browser's
 * confirmPayment() resolves: never against our own (possibly stale) database,
 * never dependent on the Stripe webhook having reached this server. Retries on
 * the shared backoff ladder because an async payment method has not
 * necessarily settled the instant confirmPayment() returns.
 */
function useConfirmPurchase(
  kindId: CreditKindId,
  onSuccess: (amount: number, balance: number) => void,
) {
  const [status, setStatus] = useState<ConfirmStatus>("idle");

  const run = useCallback(
    async (paymentIntentId: string) => {
      setStatus("confirming");
      const delays = CHECKOUT_CONFIRM_BACKOFF_MS;
      for (let attempt = 0; attempt <= delays.length; attempt++) {
        try {
          const result = await FLOWS[kindId].confirm(paymentIntentId);
          if (result.succeeded) {
            // No local "verified" screen: the page owns the confirmation, and
            // rendering one here as well is how two copies of the same success
            // copy came to exist. This component stays on the "adding your
            // credits" state for the instant before the page replaces it.
            onSuccess(result.amount, result.balance);
            return;
          }
        } catch {
          // Transient error (network blip, Stripe API hiccup): fall through to
          // the retry below instead of giving up.
        }
        if (attempt < delays.length) {
          await new Promise<void>((r) => setTimeout(r, delays[attempt]));
        }
      }
      setStatus("pending");
    },
    [kindId, onSuccess],
  );

  return { status, run };
}

function CheckoutForm({
  kind,
  tier,
  onSuccess,
}: {
  kind: CreditKind;
  tier: CreditTier;
  onSuccess: (amount: number, balance: number) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { status, run } = useConfirmPurchase(kind.id, onSuccess);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setIsProcessing(true);
    setError(null);

    // Validate the payment details BEFORE touching Stripe's PaymentIntents
    // API at all: nothing has been created yet at this point, so an invalid
    // card number costs nothing to reject.
    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(
        submitError.message ??
          "Your card details did not validate. Check the card number, expiry date and CVC, then submit again. Nothing has been charged.",
      );
      setIsProcessing(false);
      return;
    }

    let paymentIntent: { clientSecret: string; paymentIntentId: string };
    try {
      paymentIntent = await FLOWS[kind.id].createIntent(tier.id);
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
          return_url: `${window.location.origin}/checkout/success?kind=${kind.successKind}`,
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
      confirmedIntent?.status === "succeeded" ||
      confirmedIntent?.status === "processing"
    ) {
      await run(paymentIntent.paymentIntentId);
    } else {
      // Reached when the intent comes back in any other state (requires_action
      // the browser could not complete, canceled, still requiring a payment
      // method). Nothing is captured in any of them.
      setError(
        `Your bank did not complete the payment, so nothing has been charged and no ${kind.unitMany} were added. Submit again, or use a different card.`,
      );
      setIsProcessing(false);
    }
  };

  if (status === "confirming") {
    return (
      <CheckoutStatus
        tone="progress"
        title={`Payment taken. Adding your ${kind.unitMany}`}
        description="This usually lands in a few seconds. Your card has already been charged, so it is safe to leave."
        action={
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="text-muted-foreground hover:text-foreground"
          >
            <Link href={`${ROUTES.PROFILE}?tab=billing`}>
              Go to Billing now
            </Link>
          </Button>
        }
      />
    );
  }

  if (status === "pending") {
    return (
      <CheckoutStatus
        tone="warning"
        title="Still confirming"
        description="Stripe took the payment, but we have not been able to confirm it yet. This can happen with some payment methods. Refresh this page in a minute, or check Profile > Billing."
        action={
          <Button
            size="lg"
            className="h-11 px-6 gap-2"
            variant="outline"
            asChild
          >
            <Link href={`${ROUTES.PROFILE}?tab=billing`}>Go to Billing</Link>
          </Button>
        }
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <PaymentElement options={{ layout: "tabs" }} />
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
          // The amount, on the button that charges it. "Buy tokens" made the
          // reader look back up at the summary to find out what pressing it
          // would cost.
          `Pay ${formatUsd(tier.priceInCents)}`
        )}
      </Button>
    </form>
  );
}

/** One Stripe Elements checkout for all three credit types. */
export function CreditCheckout({
  kind,
  tier,
  onSuccess,
}: {
  kind: CreditKind;
  tier: CreditTier;
  onSuccess: (amount: number, balance: number) => void;
}) {
  const { resolvedTheme } = useTheme();

  // resolvedTheme is undefined until next-themes mounts client-side: wait for
  // it rather than flashing the wrong-themed Stripe form.
  if (resolvedTheme === undefined) return <PaymentFormSkeleton />;

  // Stripe renders in an iframe, so it cannot inherit our CSS variables. The
  // Appearance is resolved from the live tokens (see checkout-status.tsx) so a
  // top-up cannot drift into looking like a different app from a subscription.
  const isDark = resolvedTheme === "dark";

  return (
    <Elements
      // Remount on theme flip, and on tier change so the amount stays correct.
      key={`${tier.id}-${isDark ? "dark" : "light"}`}
      stripe={stripePromise}
      options={{
        mode: "payment",
        amount: tier.priceInCents,
        currency: "usd",
        appearance: stripeAppearance(isDark),
      }}
    >
      <CheckoutForm kind={kind} tier={tier} onSuccess={onSuccess} />
    </Elements>
  );
}
