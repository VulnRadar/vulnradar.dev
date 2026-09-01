"use client";

import { AlertTriangle, Check, Info, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/ui/utils";

export type InlineAlertTone = "error" | "success" | "warning" | "info";

/**
 * The one inline alert.
 *
 * 23 distinct geometries used to ship for this single element across 53
 * files: four radii (md / lg / xl / 2xl), three border opacities (/20, /25,
 * /30), six paddings, and background opacities including `bg-destructive/3`
 * and `bg-destructive/6`, which are not steps on Tailwind's opacity scale and
 * so were shades nobody chose deliberately. The success side additionally
 * split across two syntaxes for the same colour, `bg-[hsl(var(--success)/0.1)]`
 * and `bg-[hsl(var(--success))]/10`. Error and success feedback is the
 * highest-stakes UI in the product because it only appears when something has
 * gone wrong, and it looked different on every screen it appeared on.
 *
 * One geometry, one tone table. `role="alert"` comes free at every call site,
 * which is the other thing the hand-rolled copies kept forgetting.
 */
const TONE_STYLES: Record<
  InlineAlertTone,
  { container: string; icon: LucideIcon; iconClass: string }
> = {
  error: {
    container: "border-destructive/30 bg-destructive/10 text-destructive",
    icon: AlertTriangle,
    iconClass: "text-destructive",
  },
  success: {
    container:
      "border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]",
    icon: Check,
    iconClass: "text-[hsl(var(--success))]",
  },
  warning: {
    container:
      "border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))]",
    icon: AlertTriangle,
    iconClass: "text-[hsl(var(--warning))]",
  },
  info: {
    container: "border-primary/25 bg-primary/5 text-foreground",
    icon: Info,
    iconClass: "text-primary",
  },
};

export interface InlineAlertProps {
  tone?: InlineAlertTone;
  /** Bolded first line. Omit for a single-sentence alert. */
  title?: string;
  children?: React.ReactNode;
  /** Renders a dismiss button on the trailing edge when provided. */
  onDismiss?: () => void;
  /** Hides the leading icon, for the rare dense row that has no space. */
  hideIcon?: boolean;
  className?: string;
}

export function InlineAlert({
  tone = "error",
  title,
  children,
  onDismiss,
  hideIcon,
  className,
}: InlineAlertProps) {
  const styles = TONE_STYLES[tone];
  const Icon = styles.icon;

  return (
    <div
      // "error" and "warning" are the two a user needs told about immediately;
      // a success or info line is a confirmation of something they just did,
      // so it is announced politely rather than interrupting.
      role={tone === "error" || tone === "warning" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm",
        styles.container,
        className,
      )}
    >
      {!hideIcon && (
        <Icon
          aria-hidden="true"
          className={cn("mt-0.5 h-4 w-4 shrink-0", styles.iconClass)}
        />
      )}
      <div className="min-w-0 flex-1 leading-relaxed">
        {/* font-medium against a regular body is half a step and did not read
            as a heading, so a titled alert looked like two sentences that
            happened to be stacked. The title is the part a user scans first
            when something has gone wrong; it gets a full weight step. */}
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          // a11y (SC 2.5.8): p-1 around a 14px icon computed to a 22x22
          // target, under the 24x24 minimum, on the dismiss control of the
          // alert component reused across teams, profile and the dashboard.
          // A fixed 24x24 box centring the same icon keeps the mark the size
          // it was and only grows the hit area.
          className="-my-0.5 -mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
