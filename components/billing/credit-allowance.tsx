import { cn } from "@/lib/ui/utils";
import { formatCount, type CreditKind } from "./credit-kinds";
import type { CreditSnapshot } from "./credit-usage";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * A reset time written in UTC, deterministically.
 *
 * Not toLocaleString(): these pages render on the server and hydrate in the
 * browser, and a locale-dependent date string differs between the two, which
 * is a hydration mismatch on the first paint of a page whose whole job is
 * showing correct numbers immediately. UTC is also the clock the allowance
 * actually resets on (lib/billing/browserbase-usage.ts's period boundary is
 * Date.UTC), so this is the honest label rather than a convenient one.
 */
export function formatResetUtc(iso: string, withTime: boolean): string {
  const d = new Date(iso);
  const day = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  if (!withTime) return day;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day}, ${hh}:${mm} UTC`;
}

/** Free allowance left in the current period, floored at zero: a plan can be
 *  overspent into purchased credits, and a negative remainder is not a thing
 *  a reader can act on. */
function freeRemaining(snapshot: CreditSnapshot): number {
  if (snapshot.freeLimit <= 0) return 0;
  return Math.max(0, snapshot.freeLimit - snapshot.freeUsed);
}

/**
 * The one sentence that states where the free allowance stands.
 *
 * Written as prose rather than a stack of labelled figures because it is read
 * once, to answer "do I actually need to buy anything". The purchased balance
 * is deliberately NOT in here: it is the row's own headline number, and saying
 * it twice in one view is exactly the repetition this page set out to remove.
 */
export function allowanceSentence(
  kind: CreditKind,
  snapshot: CreditSnapshot,
): string {
  if (snapshot.usingOwnKey) {
    return "Your own AI provider key is configured, so this allowance never applies to you.";
  }
  if (snapshot.freeLimit === -1) {
    return "No cap on this plan, so nothing is drawing your purchased balance down.";
  }
  if (snapshot.freeLimit === 0) {
    return `Your plan includes no free ${kind.unitMany} for this, so purchased ${kind.unitMany} are the only ones that work.`;
  }
  const period =
    kind.period === "month"
      ? "this month"
      : `this ${snapshot.windowHours}-hour window`;
  const resets = formatResetUtc(snapshot.resetsAt, kind.period === "window");
  return `${formatCount(freeRemaining(snapshot))} of ${formatCount(
    snapshot.freeLimit,
  )} free ${kind.unitMany} left ${period}, resetting ${resets}.`;
}

/**
 * One track carrying both pools, in the order they are spent.
 *
 * Purchased credits are a fallback, never a substitute: a call the free
 * allowance covers never touches them (see lib/billing/ai-usage.ts). So the
 * bar is scaled to free allowance PLUS purchased balance and painted
 * left-to-right in spend order: what has already gone, then the free
 * allowance still to come, then the purchased balance beyond it. The shape is
 * the mechanic, which is why it is worth drawing at all.
 *
 * aria-hidden on purpose: allowanceSentence() beside it already states both
 * numbers, and a progressbar role here would have to pick one of the two
 * pools to be its value.
 */
export function CreditMeter({
  snapshot,
  className,
}: {
  snapshot: CreditSnapshot;
  className?: string;
}) {
  // An own-provider key bypasses the cap rather than raising it, so there is
  // no allowance being drawn down and a bar showing one against a number that
  // is not being enforced would be a lie in picture form.
  if (snapshot.usingOwnKey) return null;

  const limit = Math.max(0, snapshot.freeLimit);
  const total = limit + Math.max(0, snapshot.purchased);
  if (total <= 0) return null;

  const spent = Math.min(Math.max(0, snapshot.freeUsed), limit);
  const pct = (n: number) => `${(n / total) * 100}%`;

  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex h-2 w-full overflow-hidden rounded-full bg-muted",
        className,
      )}
    >
      <div className="bg-muted-foreground/45" style={{ width: pct(spent) }} />
      <div style={{ width: pct(limit - spent) }} />
      <div
        className="bg-primary"
        style={{ width: pct(Math.max(0, snapshot.purchased)) }}
      />
    </div>
  );
}
