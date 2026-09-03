import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/ui/utils";

/**
 * The one full-screen checkout state.
 *
 * Nine of these used to be written out by hand across three files: billing
 * switched off, a staff account below its own free floor, an unknown product,
 * two confirmed purchases, a failed payment, a credit top-up, a verification
 * still running, and a payment Stripe took but never confirmed. Every one was
 * the same centred column, and between them they used four different h1
 * recipes (none matching a heading tier), two puck sizes for the same role,
 * one screen with no h1 at all, and four verbatim copies of the same support
 * footnote.
 *
 * One component: Tier A heading, one puck size, one action row. Each state
 * keeps its own copy, tone and buttons.
 */
export type CheckoutMessageTone =
  "neutral" | "success" | "warning" | "error" | "progress";

const TONE: Record<
  CheckoutMessageTone,
  {
    icon?: typeof Check;
    mark?: string;
    puck?: string;
    role?: "status" | "alert";
  }
> = {
  neutral: {},
  success: {
    icon: Check,
    mark: "text-[hsl(var(--success))]",
    puck: "bg-[hsl(var(--success))]/10",
    role: "status",
  },
  warning: {
    icon: AlertTriangle,
    mark: "text-[hsl(var(--warning))]",
    puck: "bg-[hsl(var(--warning))]/10",
    role: "status",
  },
  error: {
    icon: AlertTriangle,
    mark: "text-destructive",
    puck: "bg-destructive/10",
    role: "alert",
  },
  // No puck: a spinner is already its own shape, and boxing it made the one
  // transient screen heavier than the two permanent ones.
  progress: { icon: Loader2, mark: "text-primary", role: "status" },
};

/**
 * The waiting screen for /checkout/success, in one place because it has two
 * callers that must not disagree: app/checkout/success/loading.tsx (the route
 * fallback, which used to be app/checkout/loading.tsx's payment form, an order
 * summary and a card field for a page that has neither) and the page's own
 * Suspense fallback while it reads ?session_id.
 *
 * Deliberately the same tone and shape as the "Switching your plan over"
 * screen that follows it, so coming back from Stripe is one spinner that
 * gains a sentence rather than three different layouts in a row.
 *
 * The copy claims nothing about the payment: at this point the page has not
 * read its own query string yet, let alone asked the server.
 */
export function CheckoutReturningMessage() {
  return (
    <CheckoutMessage
      tone="progress"
      title="Confirming your payment"
      description="You have just come back from Stripe. This takes a few seconds."
    />
  );
}

export function CheckoutMessage({
  tone = "neutral",
  title,
  description,
  action,
  footnote,
}: {
  tone?: CheckoutMessageTone;
  title: React.ReactNode;
  description: React.ReactNode;
  /** Rendered under the copy. One or two Buttons, laid out in a wrapping row. */
  action?: React.ReactNode;
  /** Small print under the actions, e.g. where to get help. */
  footnote?: React.ReactNode;
}) {
  const styles = TONE[tone];
  const Icon = styles.icon;
  const isProgress = tone === "progress";

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-background px-4"
      role={styles.role}
      // Only the in-progress screen changes under the user without them doing
      // anything, so only it is announced as it resolves.
      aria-live={isProgress ? "polite" : undefined}
    >
      <div className="text-center max-w-md">
        {Icon &&
          (isProgress ? (
            <Icon
              className={cn("h-8 w-8 animate-spin mx-auto mb-6", styles.mark)}
              aria-hidden="true"
            />
          ) : (
            <div
              className={cn(
                "w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6",
                styles.puck,
              )}
            >
              <Icon className={cn("h-8 w-8", styles.mark)} aria-hidden="true" />
            </div>
          ))}
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-5 text-balance">
          {title}
        </h1>
        <p className="text-muted-foreground leading-relaxed">{description}</p>
        {action && (
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {action}
          </div>
        )}
        {footnote && (
          <p className="text-xs text-muted-foreground mt-8">{footnote}</p>
        )}
      </div>
    </div>
  );
}
