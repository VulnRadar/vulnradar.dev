// The three credit types, described once.
//
// There are three purchasable balances (AI verification tokens, GitHub repo
// review tokens, live-browser minutes) and until now each one owned a whole
// page and a whole Stripe checkout component that were byte-identical to the
// other two apart from a noun. That is ~1,700 lines of copy-paste for three
// products whose only real differences are the four things named below: which
// balance they top up, what spends it, what one unit is called, and the tier
// ladder. Everything else (the page, the ladder, the order summary, the Stripe
// form, the confirmation) is now written once and reads this table.
//
// Deliberately free of server actions, icons and JSX so a React Server
// Component can import it as happily as a client one: app/credits/page.tsx and
// app/ai-credits/page.tsx read it on the server, components/billing/
// credit-checkout.tsx reads it in the browser.

import { AI_CREDIT_TIERS } from "@/lib/billing/ai-credit-catalog";
import { GITHUB_CREDIT_TIERS } from "@/lib/billing/github-credit-catalog";
import { BROWSERBASE_CREDIT_TIERS } from "@/lib/billing/browserbase-credit-catalog";

export type CreditKindId = "ai" | "github" | "browser";

/**
 * One rung of a "buy more, save more" ladder, normalised across the three
 * catalogs: AI and GitHub count tokens, live-browser counts minutes, and the
 * ladder renders identically for both because the only thing that changes is
 * what the number is called.
 */
export interface CreditTier {
  /** The catalog id threaded through Stripe metadata. Never rewritten here. */
  id: string;
  /** Tokens, or minutes. See CreditKind.unitMany for which. */
  amount: number;
  priceInCents: number;
}

export interface CreditKind {
  id: CreditKindId;
  /** Where the top-up page lives. The old /checkout URL still resolves here
   *  through a redirect page at that path. */
  path: string;
  /** The ?kind= value /checkout/success reads back after a redirect-based
   *  payment method. Unchanged from what the three old checkouts sent, so
   *  links already out in the wild still resolve to the right label. */
  successKind: string;
  /** Page title and hub row title. */
  name: string;
  /** What the credits buy, in one sentence, from the buyer's side. */
  buys: string;
  /** What the free allowance is called on the hub, e.g. "AI verification". */
  meter: string;
  unitOne: string;
  unitMany: string;
  /** How the FREE allowance resets. Purchased credits never expire. */
  period: "window" | "month";
  tiers: readonly CreditTier[];
}

export const CREDIT_KINDS: Record<CreditKindId, CreditKind> = {
  ai: {
    id: "ai",
    path: "/ai-credits",
    successKind: "ai-credits",
    name: "AI credits",
    buys: "AI verification: the pass that reads a finding and tells you whether it is real before you go and fix it.",
    meter: "AI verification",
    unitOne: "token",
    unitMany: "tokens",
    period: "window",
    tiers: AI_CREDIT_TIERS.map((t) => ({
      id: t.id,
      amount: t.tokens,
      priceInCents: t.priceInCents,
    })),
  },
  github: {
    id: "github",
    path: "/github-credits",
    successKind: "github-credits",
    name: "GitHub review credits",
    buys: "AI code review on a connected repository, which reads the source itself rather than the deployed site.",
    meter: "GitHub review",
    unitOne: "token",
    unitMany: "tokens",
    period: "window",
    tiers: GITHUB_CREDIT_TIERS.map((t) => ({
      id: t.id,
      amount: t.tokens,
      priceInCents: t.priceInCents,
    })),
  },
  browser: {
    id: "browser",
    path: "/browser-credits",
    successKind: "browser-credits",
    name: "Live-browser minutes",
    buys: "A real Chrome session driven against a target: login flows, JavaScript-rendered pages, anything a plain fetch cannot reach.",
    meter: "Live browser",
    unitOne: "minute",
    unitMany: "minutes",
    period: "month",
    tiers: BROWSERBASE_CREDIT_TIERS.map((t) => ({
      id: t.id,
      amount: t.minutes,
      priceInCents: t.priceInCents,
    })),
  },
};

/** Hub order: the two token balances, then the one counted in minutes. */
export const CREDIT_KIND_ORDER: readonly CreditKindId[] = [
  "ai",
  "github",
  "browser",
];

/**
 * Money, not rounded to the dollar.
 *
 * Every one of the three pages printed prices with `.toFixed(0)`, which is
 * correct only for as long as every tier happens to be a whole number of
 * dollars. The first $12.50 tier would have rendered as "$13" on the page that
 * takes the payment while Stripe charged the real amount.
 */
export function formatUsd(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/**
 * Grouped digits, pinned to en-US rather than the ambient locale.
 *
 * These numbers are rendered on the server (app/credits and the three top-up
 * pages are Server Components) and hydrated in the browser. A bare
 * toLocaleString() resolves against the machine's locale on one side and the
 * visitor's on the other, so "1,000,000" and "1 000 000" are the same call
 * returning two different strings and React reports a hydration mismatch.
 *
 * Live-browser minutes can carry a fraction (a 90 second session is 1.5
 * minutes of the monthly allowance, see credit-usage.ts), so a non-integer
 * keeps one decimal and an integer shows none: "3", never "3.0".
 */
export function formatCount(amount: number): string {
  return amount.toLocaleString("en-US", {
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 1,
  });
}

/** "1 minute" / "30 minutes", "1 token" / "1,000,000 tokens". */
export function formatUnits(kind: CreditKind, amount: number): string {
  const noun = amount === 1 ? kind.unitOne : kind.unitMany;
  return `${formatCount(amount)} ${noun}`;
}

/**
 * Units bought per dollar, which is the only number that lets a buyer compare
 * two rungs of the ladder directly.
 *
 * The old pages printed this for the cheapest tier and then switched to
 * "1.6x the rate of the $10 tier" for every other one, so a column of four
 * values held two different units and could not be read down. One unit for
 * every row; the best rate is called out in words instead.
 */
export function unitsPerDollar(tier: CreditTier): number {
  return tier.amount / (tier.priceInCents / 100);
}

/** The rung with the best rate, which is what a "best rate" marker must mean.
 *  The old pages hardcoded "the last one", which is only the same thing while
 *  the catalogs stay sorted. */
export function bestRateTierId(kind: CreditKind): string {
  return kind.tiers.reduce((best, tier) =>
    unitsPerDollar(tier) > unitsPerDollar(best) ? tier : best,
  ).id;
}
