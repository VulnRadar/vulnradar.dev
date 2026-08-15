"use client";

import { useSearchParams } from "next/navigation";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ROUTES, APP_NAME, SUPPORT_EMAIL } from "@/lib/config/constants";
import { useVerifySubscription } from "@/hooks/use-verify-subscription";

export function CheckoutSuccessContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const { verifying, pending, planName } = useVerifySubscription({
    sessionId,
  });

  if (verifying) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-background"
        role="status"
        aria-live="polite"
      >
        <div className="text-center px-4">
          <Loader2
            className="h-8 w-8 animate-spin text-primary mx-auto mb-4"
            aria-hidden="true"
          />
          <h2 className="text-xl font-semibold mb-2">
            Payment taken. Switching your plan over
          </h2>
          <p className="text-muted-foreground">
            This usually lands in a few seconds. Your card has already been
            charged.
          </p>
        </div>
      </div>
    );
  }

  // Payment succeeded but the plan never confirmed; don't show the success screen.
  if (pending) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-background"
        role="status"
      >
        <div className="text-center max-w-md px-4">
          <div className="w-14 h-14 rounded-full bg-[hsl(var(--warning)/0.12)] flex items-center justify-center mx-auto mb-5">
            <AlertTriangle
              className="h-7 w-7 text-[hsl(var(--warning))]"
              aria-hidden="true"
            />
          </div>
          <h1 className="text-xl font-semibold mb-2">Still confirming</h1>
          <p className="text-muted-foreground mb-8">
            Stripe took the payment, but we have not been able to confirm your
            new plan yet. This can happen with some payment methods. Refresh
            this page in a minute, or check Profile &gt; Billing.
          </p>
          <div className="flex flex-col gap-3">
            <Button size="lg" className="h-11 px-6 gap-2" asChild>
              <Link href={`${ROUTES.PROFILE}?tab=billing`}>Go to Billing</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={ROUTES.DASHBOARD}>Back to dashboard</Link>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-8">
            Need help? Contact us at{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="underline hover:text-foreground"
            >
              {SUPPORT_EMAIL}
            </a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-background"
      role="status"
    >
      <div className="text-center max-w-md px-4">
        <div className="mx-auto mb-6">
          <div className="w-20 h-20 rounded-full bg-[hsl(var(--success)/0.12)] flex items-center justify-center mx-auto">
            <Check
              className="h-10 w-10 text-[hsl(var(--success))]"
              aria-hidden="true"
            />
          </div>
        </div>

        <h1 className="text-3xl font-bold mb-3">
          You are on {planName || "your new plan"}
        </h1>
        <p className="text-muted-foreground mb-8">
          Your card has been charged and the new scan limit applies right away.
          Thank you for supporting {APP_NAME}.
        </p>

        <div className="flex flex-col gap-3">
          <Button size="lg" className="h-11 px-6 gap-2" asChild>
            <Link href={ROUTES.DASHBOARD}>Start scanning</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={`${ROUTES.PROFILE}?tab=billing`}>
              View billing details
            </Link>
          </Button>
        </div>

        <p className="text-xs text-muted-foreground mt-8">
          Need help? Contact us at{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="underline hover:text-foreground"
          >
            {SUPPORT_EMAIL}
          </a>
        </p>
      </div>
    </div>
  );
}
