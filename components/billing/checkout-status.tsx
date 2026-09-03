"use client";

import type { Appearance } from "@stripe/stripe-js";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/ui/utils";

/**
 * The one post-payment status block, and the one Stripe Appearance.
 *
 * Four checkout components (subscription, AI credits, live-browser credits,
 * GitHub review credits) each carried their own byte-identical copy of a
 * confirming / verified / pending trio AND their own byte-identical copy of
 * the Stripe palette. The duplication was even documented in comments saying
 * "copied verbatim, kept as its own copy so this file never has to touch the
 * flow it is not modifying", which held while the copies agreed and stopped
 * holding the moment they did not: three of the four drew their heading at
 * text-xl inside a card whose own h2 is text-base, so the child heading was a
 * step LARGER than its parent, and the palette copies hardcoded
 * `hsl(213, 94%, 68%)`, which is --primary written out by hand.
 *
 * Nothing here touches a payment code path: these are the screens shown after
 * confirmPayment() has already resolved, plus the iframe's colours.
 */

/** Shared by all four checkouts. Mirrors the PaymentElement's own shape (tabs
 * row, then card/email fields) so there's no layout jump once Stripe's real
 * form mounts. Only shown for the brief window before the theme is known
 * client-side. */
export function PaymentFormSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading payment form">
      <div className="flex gap-2">
        <Skeleton className="h-10 flex-1 rounded-md" />
        <Skeleton className="h-10 flex-1 rounded-md" />
        <Skeleton className="h-10 flex-1 rounded-md" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-10 w-full rounded-md" />
        <Skeleton className="h-10 w-full rounded-md" />
        <div className="flex gap-3">
          <Skeleton className="h-10 flex-1 rounded-md" />
          <Skeleton className="h-10 flex-1 rounded-md" />
        </div>
      </div>
      <Skeleton className="h-11 w-full rounded-md" />
    </div>
  );
}

export type CheckoutStatusTone = "progress" | "success" | "warning";

// puck is optional on purpose: the progress tone renders a bare spinner with
// no disc behind it, so only success and warning carry one. Typed explicitly
// rather than left to `as const`, because `styles` is destructured before the
// branch that reads puck and TypeScript cannot narrow the union there.
const TONE: Record<
  CheckoutStatusTone,
  { icon: LucideIcon; mark: string; puck?: string }
> = {
  progress: { icon: Loader2, mark: "text-primary" },
  success: {
    icon: Check,
    mark: "text-[hsl(var(--success))]",
    puck: "bg-[hsl(var(--success))]/10",
  },
  warning: {
    icon: AlertTriangle,
    mark: "text-[hsl(var(--warning))]",
    puck: "bg-[hsl(var(--warning))]/10",
  },
};

export function CheckoutStatus({
  tone,
  title,
  description,
  action,
}: {
  tone: CheckoutStatusTone;
  title: React.ReactNode;
  description: React.ReactNode;
  /** Rendered under the copy. One or two Buttons. */
  action?: React.ReactNode;
}) {
  const styles = TONE[tone];
  const Icon = styles.icon;
  const isProgress = tone === "progress";

  return (
    <div
      className="flex flex-col items-center justify-center py-10 text-center"
      role="status"
      // Only the in-progress state changes under the user without them doing
      // anything, so only it needs announcing as it lands.
      aria-live={isProgress ? "polite" : undefined}
    >
      {isProgress ? (
        <Icon
          className={cn("h-7 w-7 animate-spin mb-4", styles.mark)}
          aria-hidden="true"
        />
      ) : (
        <div
          className={cn(
            "w-14 h-14 rounded-full flex items-center justify-center mb-5",
            styles.puck,
          )}
        >
          <Icon className={cn("h-7 w-7", styles.mark)} aria-hidden="true" />
        </div>
      )}
      {/* text-base, not text-xl: this renders inside the "Payment details"
          card, whose own heading is an h2 at text-base. A child heading is
          never drawn larger than the heading it sits under. */}
      <h3 className="text-base font-semibold mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
        {description}
      </p>
      {action && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          {action}
        </div>
      )}
    </div>
  );
}

/**
 * The Stripe Appearance API, built from our own theme tokens.
 *
 * Stripe renders the PaymentElement in a cross-origin iframe, so it cannot
 * inherit our CSS variables and the Appearance API only accepts resolved
 * colour strings. The previous answer was a hand-maintained second palette in
 * each of the four checkout files, which is how a literal `hsl(213, 94%, 68%)`
 * (that is --primary) plus a white card background that no theme actually uses
 * ended up shipping.
 *
 * So resolve the tokens instead: --primary, --card, --foreground, --destructive
 * and friends are declared on :root and overridden under .dark, which
 * next-themes puts on <html>, so reading the computed value off the document
 * root gives whichever theme is live right now. globals.css stores them as raw
 * `H S% L%` triples for Tailwind's `hsl(var(--x) / <alpha>)` syntax, hence the
 * hsl() wrapper here. Callers key <Elements> on the theme, so a light/dark flip
 * remounts and re-reads.
 *
 * SSR-safe: there is no `document` on the server, and a token that somehow does
 * not resolve is left off entirely rather than sent as an empty string, so
 * Stripe falls back to its own "stripe"/"night" theme for that one property.
 */
export function stripeAppearance(isDark: boolean): Appearance {
  const variables: NonNullable<Appearance["variables"]> = {
    // Not colours, so not tokens: the radius is Stripe's own control geometry
    // and the stack is the system font this app already renders in.
    borderRadius: "8px",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  };
  const theme = isDark ? "night" : "stripe";

  if (typeof document === "undefined") return { theme, variables };

  const root = getComputedStyle(document.documentElement);
  const token = (name: string): string | null => {
    const raw = root.getPropertyValue(name).trim();
    if (!raw) return null;
    // globals.css stores each colour as a bare `H S% L%` triple, because that
    // is what Tailwind's `hsl(var(--x) / <alpha>)` syntax needs. Rejoin it with
    // commas rather than handing Stripe the space-separated CSS Color 4 form:
    // the comma form is what this iframe has always been sent, and this is not
    // the place to find out how Stripe's own validator feels about the other.
    const parts = raw.split(/\s+/);
    return parts.length === 3 ? `hsl(${parts.join(", ")})` : `hsl(${raw})`;
  };

  const primary = token("--primary");
  const card = token("--card");
  const foreground = token("--foreground");
  const destructive = token("--destructive");
  // The form's own controls, matching components/ui/input.tsx exactly:
  // bg-background inside a card, with the --input control edge (which carries
  // a real 3:1 floor) rather than the softer --border container edge.
  const background = token("--background");
  const controlEdge = token("--input");
  const ring = token("--ring");

  if (primary) variables.colorPrimary = primary;
  if (card) variables.colorBackground = card;
  if (foreground) variables.colorText = foreground;
  if (destructive) variables.colorDanger = destructive;

  const rules: NonNullable<Appearance["rules"]> = {};
  if (background || controlEdge) {
    rules[".Input"] = {
      ...(background ? { backgroundColor: background } : {}),
      ...(controlEdge ? { border: `1px solid ${controlEdge}` } : {}),
    };
  }
  if (ring) {
    rules[".Input:focus"] = {
      border: `1px solid ${ring}`,
      boxShadow: `0 0 0 1px ${ring}`,
    };
  }

  return { theme, variables, rules };
}
