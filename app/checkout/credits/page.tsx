"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, ChevronLeft, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/ui/utils";
import { ROUTES, BILLING_ENABLED, APP_NAME } from "@/lib/config/constants";
import {
  AI_CREDIT_TIERS,
  type AiCreditTier,
} from "@/lib/billing/ai-credit-catalog";
import { AiCreditCheckout } from "@/components/billing/ai-credit-checkout";
import { CheckoutSkeleton } from "@/components/billing/checkout-skeleton";

function tokensPerDollar(tier: AiCreditTier): number {
  return tier.tokens / (tier.priceInCents / 100);
}

export default function CreditsCheckoutPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [selectedTier, setSelectedTier] = useState<AiCreditTier | null>(null);
  const [purchaseResult, setPurchaseResult] = useState<{
    tokens: number;
    balance: number;
  } | null>(null);

  useEffect(() => {
    async function checkAuth() {
      try {
        const meRes = await fetch("/api/v3/auth/me");
        if (!meRes.ok) {
          router.push("/auth?redirect=/checkout/credits");
          return;
        }
      } catch {
        router.push("/auth?redirect=/checkout/credits");
        return;
      }
      setLoading(false);
    }
    checkAuth();
  }, [router]);

  if (!BILLING_ENABLED) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-md px-4">
          <h1 className="text-2xl font-bold mb-2">There is nothing to buy</h1>
          <p className="text-muted-foreground mb-4">
            Billing is switched off on this {APP_NAME} deployment, so AI
            verification has no window cap to top up.
          </p>
          <Button size="lg" className="h-11 px-6 gap-2" asChild>
            <Link href={ROUTES.DASHBOARD}>Go to Scanner</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (loading) {
    return <CheckoutSkeleton />;
  }

  if (purchaseResult) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-background"
        role="status"
      >
        <div className="text-center px-4 max-w-md">
          <div className="w-16 h-16 rounded-full bg-[hsl(var(--success)/0.12)] flex items-center justify-center mx-auto mb-6">
            <Check
              className="h-8 w-8 text-[hsl(var(--success))]"
              aria-hidden="true"
            />
          </div>
          <h1 className="text-2xl font-bold mb-2">
            {purchaseResult.tokens.toLocaleString()} tokens added
          </h1>
          <p className="text-muted-foreground mb-6">
            Your purchased balance is now{" "}
            <span className="font-medium text-foreground">
              {purchaseResult.balance.toLocaleString()}
            </span>{" "}
            tokens. They never expire and are spent only once your plan&apos;s
            free window allowance runs out.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button
              size="lg"
              variant="outline"
              className="h-11 px-6 gap-2"
              asChild
            >
              <Link href={`${ROUTES.PROFILE}?tab=billing`}>
                Back to Billing
              </Link>
            </Button>
            <Button size="lg" className="h-11 px-6 gap-2" asChild>
              <Link href={ROUTES.DASHBOARD}>Start scanning</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const baseRate = tokensPerDollar(AI_CREDIT_TIERS[0]);
  const baseTierPrice = (AI_CREDIT_TIERS[0].priceInCents / 100).toFixed(0);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 sticky top-[var(--vr-banner-h,0px)] z-10 transition-[top] duration-300">
        <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link
            href={`${ROUTES.PROFILE}?tab=billing`}
            className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span className="text-sm">Back to Billing</span>
          </Link>
          <div className="w-4" />
        </div>
      </header>
      {/* position: sticky reserves flow space at the header's unshifted
          height only -- the extra top-[var(--vr-banner-h)] offset that
          pushes it down below a banner is a paint-only shift, so without
          this the header visually overlaps the content below it. */}
      <div
        className="h-[var(--vr-banner-h,0px)] transition-[height] duration-300"
        aria-hidden="true"
      />

      <main className="container max-w-4xl mx-auto px-4 py-8 md:py-12">
        <div className="mb-8 max-w-2xl">
          <h1 className="text-2xl md:text-3xl font-bold mb-2">
            Buy more AI verification tokens
          </h1>
          <p className="text-muted-foreground">
            A one-time top-up on top of your plan&apos;s free window allowance.
            Tokens never expire and only get spent once that free allowance runs
            out for the window.
          </p>
        </div>

        {!selectedTier ? (
          <div className="max-w-2xl rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
            {AI_CREDIT_TIERS.map((tier) => {
              const isBest =
                tier.id === AI_CREDIT_TIERS[AI_CREDIT_TIERS.length - 1].id;
              const multiplier = tokensPerDollar(tier) / baseRate;
              return (
                <button
                  key={tier.id}
                  type="button"
                  onClick={() => setSelectedTier(tier)}
                  className={cn(
                    "w-full text-left flex items-center justify-between gap-4 p-4 sm:p-5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    isBest && "bg-primary/5",
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {isBest && (
                      <Sparkles
                        className="h-4 w-4 text-primary shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground">
                        {tier.tokens.toLocaleString()} tokens
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {multiplier === 1
                          ? `${tokensPerDollar(tier).toLocaleString()} tokens per dollar`
                          : `${multiplier.toFixed(1)}x the rate of the $${baseTierPrice} tier`}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-bold text-foreground">
                      ${(tier.priceInCents / 100).toFixed(0)}
                    </p>
                    <p className="text-xs text-muted-foreground">one-time</p>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-8 md:gap-12 md:items-start max-w-4xl">
            <div>
              <button
                type="button"
                onClick={() => setSelectedTier(null)}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Change tier
              </button>
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-semibold text-lg">
                    {selectedTier.tokens.toLocaleString()} tokens
                  </p>
                  <p className="text-sm font-medium tabular-nums text-muted-foreground">
                    one-time
                  </p>
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Added to your purchased balance the moment payment clears.
                  Never expires.
                </p>
                <Separator className="my-4" />
                <div className="flex justify-between items-center">
                  <span className="font-semibold">Total today</span>
                  <span className="text-2xl font-bold">
                    ${(selectedTier.priceInCents / 100).toFixed(0)}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <div className="rounded-xl border border-border bg-card p-6">
                <h2 className="text-base font-semibold mb-5">
                  Payment details
                </h2>
                <AiCreditCheckout
                  tier={selectedTier}
                  onSuccess={(tokens, balance) =>
                    setPurchaseResult({ tokens, balance })
                  }
                />
              </div>
              <p className="text-center text-xs text-muted-foreground mt-4">
                Payment handled by Stripe, not us.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
