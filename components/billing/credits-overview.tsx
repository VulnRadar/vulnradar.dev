"use client";

// Client for one reason: react-icons' FaGithub renders through
// React.createContext, which a Server Component cannot call. Nothing in here
// holds state or handles an event; the page above it is still the Server
// Component that reads the balances, and it hands them down already resolved.

import Link from "next/link";
import { Monitor, Sparkles } from "lucide-react";
import { FaGithub } from "react-icons/fa";
import type { IconType } from "react-icons";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/config/client-constants";
import {
  CREDIT_KINDS,
  CREDIT_KIND_ORDER,
  formatCount,
  type CreditKindId,
} from "./credit-kinds";
import { CreditMeter, allowanceSentence } from "./credit-allowance";
import type { CreditSnapshot } from "./credit-usage";

/** Kept out of credit-kinds.ts so that table stays plain serializable data a
 *  Server Component can hand to a client one. */
const ICONS: Record<CreditKindId, LucideIcon | IconType> = {
  ai: Sparkles,
  github: FaGithub,
  browser: Monitor,
};

/**
 * The credits hub: every balance on one page.
 *
 * Laid out as a statement, not a shop. Three products of the same shape with
 * different numbers is a list to be read down, so the rows share a left edge,
 * a hairline divider and one column of figures, rather than becoming three
 * identical marketing cards in a grid. The only per-row decoration is the
 * allowance track, which earns its place by drawing the actual mechanic: free
 * allowance first, purchased balance only after it runs out.
 */
export function CreditsOverview({
  snapshots,
}: {
  snapshots: Record<CreditKindId, CreditSnapshot>;
}) {
  return (
    <div className="flex flex-col gap-8">
      <div className="max-w-2xl">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-balance text-foreground">
          Credits
        </h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          Three separate balances, one for each metered feature. A balance is
          spent only after that feature&apos;s free allowance for the period
          runs out, and none of them expires.
        </p>
      </div>

      <ul className="rounded-xl border border-border bg-card divide-y divide-border">
        {CREDIT_KIND_ORDER.map((kindId) => {
          const kind = CREDIT_KINDS[kindId];
          const snapshot = snapshots[kindId];
          const Icon = ICONS[kindId];
          return (
            <li key={kindId} className="p-5 sm:p-6">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-8">
                <div className="min-w-0 flex-1">
                  <h2 className="flex items-center gap-2 font-semibold text-foreground">
                    <Icon
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    {kind.name}
                  </h2>
                  <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                    {kind.buys}
                  </p>
                  <div className="mt-4 max-w-md space-y-2">
                    <CreditMeter snapshot={snapshot} />
                    <p className="text-xs text-muted-foreground">
                      {allowanceSentence(kind, snapshot)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4 sm:w-44 sm:shrink-0 sm:flex-col sm:items-end sm:justify-start sm:gap-3 sm:text-right">
                  <div>
                    <p className="text-2xl font-semibold tabular-nums leading-none text-foreground">
                      {formatCount(snapshot.purchased)}
                    </p>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      purchased {kind.unitMany}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="h-11 px-4 shrink-0"
                    asChild
                  >
                    <Link href={kind.path}>Buy {kind.unitMany}</Link>
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="max-w-2xl space-y-2 text-sm text-muted-foreground">
        <p>
          AI credits and GitHub review credits are priced identically, tier for
          tier: the same provider call costs the same whichever feature made it.
          They are separate balances because separate features spend them, not
          because one is dearer than the other.
        </p>
        <p>
          Every top-up is one payment, never a subscription. Receipts, invoices
          and your plan live in{" "}
          <Link
            href={`${ROUTES.PROFILE}?tab=billing`}
            className="underline underline-offset-2 rounded-sm hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            Profile, Billing
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
