"use client";

import { useSearchParams } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ROUTES } from "@/lib/config/constants";
import { useVerifySubscription } from "@/hooks/use-verify-subscription";

export function CheckoutSuccessContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const { verifying, planName } = useVerifySubscription({ sessionId });

  if (verifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">
            Activating your subscription...
          </h2>
          <p className="text-muted-foreground">This will only take a moment</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center max-w-md px-4">
        <div className="mx-auto mb-6">
          <div className="w-20 h-20 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto">
            <Check className="h-10 w-10 text-emerald-500" />
          </div>
        </div>

        <h1 className="text-3xl font-bold mb-3">
          Welcome to {planName || "your new plan"}!
        </h1>
        <p className="text-muted-foreground mb-8">
          Your subscription is now active. Thank you for supporting VulnRadar!
        </p>

        <div className="flex flex-col gap-3">
          <Button size="lg" asChild>
            <Link href={ROUTES.DASHBOARD}>Start Scanning</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/profile#billing">View Billing Details</Link>
          </Button>
        </div>

        <p className="text-xs text-muted-foreground mt-8">
          Need help? Contact us at{" "}
          <a
            href="mailto:support@vulnradar.com"
            className="underline hover:text-foreground"
          >
            support@vulnradar.com
          </a>
        </p>
      </div>
    </div>
  );
}
