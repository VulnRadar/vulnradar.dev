"use client";

import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ROUTES, APP_NAME, SUPPORT_EMAIL } from "@/lib/config/client-constants";
import { useVerifySubscription } from "@/hooks/use-verify-subscription";
import { CheckoutMessage } from "@/components/billing/checkout-message";

/** Credit top-up labels, keyed by the ?kind= the checkout components send. */
const CREDIT_KINDS: Record<string, string> = {
  "ai-credits": "AI credits",
  "browser-credits": "live-browser credits",
  "github-credits": "GitHub review credits",
};

/* Written out verbatim on four of the five screens this file renders, which
   meant four places to edit if the support address ever moved. */
const SupportFootnote = (
  <>
    Need help? Contact us at{" "}
    <a
      href={`mailto:${SUPPORT_EMAIL}`}
      className="underline hover:text-foreground"
    >
      {SUPPORT_EMAIL}
    </a>
  </>
);

export function CheckoutSuccessContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  // This page is the return_url for all four checkout flows, but it only ever
  // knew how to confirm a subscription: a redirect-method credit top-up polled
  // verify-subscription for 22 seconds and then warned that a payment which had
  // actually succeeded could not be confirmed. ?kind= says which flow came back
  // (absent on older links, which were all subscriptions).
  const kind = searchParams.get("kind");
  const creditLabel = kind ? CREDIT_KINDS[kind] : undefined;
  // Stripe appends this on a redirect-based confirmation. It was ignored
  // entirely, so a genuinely failed payment landed on a page implying success
  // was merely pending.
  const redirectStatus = searchParams.get("redirect_status");
  const paymentFailed =
    redirectStatus === "failed" || redirectStatus === "canceled";

  const { verifying, pending, planName } = useVerifySubscription({
    sessionId,
    autoStart: !creditLabel && !paymentFailed,
  });

  if (paymentFailed) {
    return (
      <CheckoutMessage
        tone="error"
        title="Payment did not go through"
        description="Your bank did not complete this payment, so nothing has been charged and nothing has changed on your account. You can try again with the same or a different card."
        action={
          <>
            <Button size="lg" className="h-11 px-6 gap-2" asChild>
              <Link href={ROUTES.PRICING}>Back to plans</Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-11 px-6 gap-2"
              asChild
            >
              <Link href={ROUTES.DASHBOARD}>Back to dashboard</Link>
            </Button>
          </>
        }
        footnote={SupportFootnote}
      />
    );
  }

  if (creditLabel) {
    return (
      <CheckoutMessage
        tone="success"
        title="Payment received"
        description={`Your ${creditLabel} are being added to your account. The balance on your billing page is the live number. Thank you for supporting ${APP_NAME}.`}
        action={
          <>
            <Button size="lg" className="h-11 px-6 gap-2" asChild>
              <Link href={`${ROUTES.PROFILE}?tab=billing`}>
                View your balance
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-11 px-6 gap-2"
              asChild
            >
              <Link href={ROUTES.DASHBOARD}>Back to dashboard</Link>
            </Button>
          </>
        }
        footnote={SupportFootnote}
      />
    );
  }

  if (verifying) {
    // This screen had no h1 at all, only an h2, on a page whose entire content
    // it is. It gets the same Tier A title as the four states beside it.
    return (
      <CheckoutMessage
        tone="progress"
        title="Payment taken. Switching your plan over"
        description="This usually lands in a few seconds. Your card has already been charged."
      />
    );
  }

  // Payment succeeded but the plan never confirmed; don't show the success screen.
  if (pending) {
    return (
      <CheckoutMessage
        tone="warning"
        title="Still confirming"
        description="Stripe took the payment, but we have not been able to confirm your new plan yet. This can happen with some payment methods. Refresh this page in a minute, or check Profile > Billing."
        action={
          <>
            <Button size="lg" className="h-11 px-6 gap-2" asChild>
              <Link href={`${ROUTES.PROFILE}?tab=billing`}>Go to Billing</Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-11 px-6 gap-2"
              asChild
            >
              <Link href={ROUTES.DASHBOARD}>Back to dashboard</Link>
            </Button>
          </>
        }
        footnote={SupportFootnote}
      />
    );
  }

  return (
    <CheckoutMessage
      tone="success"
      title={`You are on ${planName || "your new plan"}`}
      description={`Your card has been charged and the new scan limit applies right away. Thank you for supporting ${APP_NAME}.`}
      action={
        <>
          <Button size="lg" className="h-11 px-6 gap-2" asChild>
            <Link href={ROUTES.DASHBOARD}>Start scanning</Link>
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-11 px-6 gap-2"
            asChild
          >
            <Link href={`${ROUTES.PROFILE}?tab=billing`}>
              View billing details
            </Link>
          </Button>
        </>
      }
      footnote={SupportFootnote}
    />
  );
}
