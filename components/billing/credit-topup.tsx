"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { AppPageShell } from "@/components/shared/app-page-shell";
import { cn } from "@/lib/ui/utils";
import {
  ROUTES,
  APP_NAME,
  BILLING_ENABLED,
} from "@/lib/config/client-constants";
import { CheckoutMessage } from "./checkout-message";
import { CreditCheckout } from "./credit-checkout";
import { CreditMeter, allowanceSentence } from "./credit-allowance";
import {
  CREDIT_KINDS,
  bestRateTierId,
  formatCount,
  formatUnits,
  formatUsd,
  unitsPerDollar,
  type CreditKindId,
  type CreditTier,
} from "./credit-kinds";
import type { CreditSnapshot } from "./credit-usage";

const CREDITS_HUB = "/credits";

/**
 * The one top-up page, rendered at /ai-credits, /github-credits and
 * /browser-credits.
 *
 * Four things a person needs at the moment they are about to pay, in this
 * order: what am I buying, what do I already have, what will it cost, and what
 * happens after. The three pages this replaces answered the first and third
 * and neither of the other two, so the page selling you more tokens never once
 * said how many you already held.
 *
 * Chrome, deliberately. These used to render as a bare page with a single
 * floating "Back to Billing" button and no navigation of any kind, which reads
 * as a broken redirect rather than a checkout, on the one surface where a
 * person is being asked to trust us with a card. They are app pages now, with
 * the same header, footer and Tier B heading as /shares and /profile. The
 * focused, chrome-light funnel is still the right shape for
 * /checkout/[productId], which is entered from the public pricing page by
 * someone who is not signed in to anything yet.
 */
export function CreditTopUp({
  kindId,
  snapshot,
}: {
  kindId: CreditKindId;
  snapshot: CreditSnapshot;
}) {
  const kind = CREDIT_KINDS[kindId];
  const [selectedTier, setSelectedTier] = useState<CreditTier | null>(null);
  const [purchase, setPurchase] = useState<{
    amount: number;
    balance: number;
  } | null>(null);

  // The same compiled flag every other checkout guard reads, deliberately:
  // BILLING_ENABLED has a live half (limits) and a compiled half (this UI),
  // documented in lib/config/registry.ts. Reading the runtime setting here
  // would make this one page disagree with the other three.
  if (!BILLING_ENABLED) {
    return (
      <CheckoutMessage
        title="There is nothing to buy"
        description={`Billing is switched off on this ${APP_NAME} deployment, so ${kind.meter} has no cap to top up.`}
        action={
          <Button size="lg" className="h-11 px-6 gap-2" asChild>
            <Link href={ROUTES.DASHBOARD}>Go to Scanner</Link>
          </Button>
        }
      />
    );
  }

  if (purchase) {
    return (
      <CheckoutMessage
        tone="success"
        title={`${formatUnits(kind, purchase.amount)} added`}
        description={
          <>
            Your purchased balance is now{" "}
            <span className="font-medium text-foreground">
              {formatUnits(kind, purchase.balance)}
            </span>
            . They never expire and are spent only once your plan&apos;s free
            allowance runs out.
          </>
        }
        action={
          <>
            <Button
              size="lg"
              variant="outline"
              className="h-11 px-6 gap-2"
              asChild
            >
              <Link href={CREDITS_HUB}>Back to credits</Link>
            </Button>
            <Button size="lg" className="h-11 px-6 gap-2" asChild>
              <Link href={ROUTES.DASHBOARD}>Start scanning</Link>
            </Button>
          </>
        }
      />
    );
  }

  const bestId = bestRateTierId(kind);

  return (
    // Same argument CreditTopUpSkeleton passes, so the placeholder and the
    // page cannot end up at different widths.
    <AppPageShell maxWidth="max-w-5xl" className="flex flex-col gap-6">
      <div>
        <Link
          href={CREDITS_HUB}
          // A bordered pill, not bare text with an arrow. Every other back
          // affordance in the app is a real control (see
          // components/history/history-detail-header.tsx), and a text link
          // sitting alone at the top left of a payment page did not read as
          // something to press. 44px tall below sm for the touch minimum.
          className="inline-flex h-11 sm:h-8 items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          All credits
        </Link>
        <h1 className="mt-3 text-xl sm:text-2xl font-semibold tracking-tight text-balance text-foreground">
          {kind.name}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground leading-relaxed">
          {kind.buys}
        </p>
      </div>

      {/* What you already hold, before anything is asked of you. Server
              rendered from the same quota functions Profile > Billing reads,
              so it is correct on the first frame rather than after a fetch.
              Only while choosing: once a tier is picked the order summary
              carries the same balance, and stating it in both places at once
              is the repetition this page set out to remove. */}
      {!selectedTier && (
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-2xl font-semibold tabular-nums leading-none text-foreground">
            {formatCount(snapshot.purchased)}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            purchased {kind.unitMany} you hold now
          </p>
          <CreditMeter className="mt-4 max-w-md" snapshot={snapshot} />
          <p className="mt-2 max-w-md text-xs text-muted-foreground">
            {allowanceSentence(kind, snapshot)}
          </p>
        </div>
      )}

      {!selectedTier ? (
        <div className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-foreground">
            Pick an amount
          </h2>
          <ul className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
            {kind.tiers.map((tier) => {
              const isBest = tier.id === bestId;
              return (
                <li key={tier.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedTier(tier)}
                    className={cn(
                      "w-full text-left flex items-center justify-between gap-4 p-4 sm:p-5 transition-colors hover:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                      isBest && "bg-primary/5",
                    )}
                  >
                    <div className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
                        {formatUnits(kind, tier.amount)}
                        {/* Words, not a bare icon. This was a Sparkles
                                glyph floating in the left margin with no
                                label, which reads as a rendering artifact
                                rather than a recommendation. */}
                        {isBest && (
                          <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                            Best rate
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {formatCount(unitsPerDollar(tier))} {kind.unitMany} per
                        dollar
                      </span>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="block text-lg font-semibold tabular-nums text-foreground">
                        {formatUsd(tier.priceInCents)}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        one-time
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="max-w-2xl text-xs text-muted-foreground">
            One payment, never a subscription. Purchased {kind.unitMany} never
            expire and are spent only after the free allowance above runs out.
            Payment handled by Stripe, not us.
          </p>
        </div>
      ) : (
        <div
          className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 md:items-start"
          /* The one md: breakpoint left on these pages, deliberately:
                 every other one moved to sm: to match the rest of app/, but
                 this is the split that gives the Stripe payment form its own
                 column, and at 640px that column would be about 270px wide.
                 Wide enough to render the card fields, not wide enough to
                 fill them in. */
        >
          <div>
            <button
              type="button"
              onClick={() => setSelectedTier(null)}
              className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset mb-4"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Change amount
            </button>

            {/* Two ledgers, one for the credits and one for the money.
                    The old summary printed the tier amount twice and the price
                    twice and still never showed the number that decides
                    whether this is the right tier: what the balance becomes. */}
            <div className="relative overflow-hidden rounded-xl border border-border bg-card p-5">
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-1 bg-primary"
              />
              <div className="pl-3">
                <div className="flex items-baseline justify-between gap-3">
                  {/* The amount, not the product name: the page heading
                          six lines up already says which credits these are,
                          and the one thing this panel is here to pin down is
                          how many. */}
                  <h2 className="font-semibold text-lg">
                    {formatUnits(kind, selectedTier.amount)}
                  </h2>
                  <p className="text-sm font-medium text-muted-foreground">
                    one-time
                  </p>
                </div>

                <Separator className="my-4" />

                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Balance now</dt>
                    <dd className="tabular-nums">
                      {formatCount(snapshot.purchased)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3 border-t border-border pt-2 font-medium">
                    <dt>Balance after payment</dt>
                    <dd className="tabular-nums">
                      {formatUnits(
                        kind,
                        snapshot.purchased + selectedTier.amount,
                      )}
                    </dd>
                  </div>
                </dl>

                <Separator className="my-4" />

                <div className="flex justify-between items-center gap-3">
                  <span className="font-semibold">Total today</span>
                  <span className="text-2xl font-semibold tabular-nums">
                    {formatUsd(selectedTier.priceInCents)}
                  </span>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Credited the moment payment clears. Never expires, and never
                  renews.
                </p>
              </div>
            </div>
          </div>

          <div>
            <div className="rounded-xl border border-border bg-card p-6">
              <h2 className="text-base font-semibold mb-5">Payment details</h2>
              <CreditCheckout
                kind={kind}
                tier={selectedTier}
                onSuccess={(amount, balance) =>
                  setPurchase({ amount, balance })
                }
              />
            </div>
            <p className="text-center text-xs text-muted-foreground mt-4">
              Payment handled by Stripe, not us.
            </p>
          </div>
        </div>
      )}
    </AppPageShell>
  );
}
