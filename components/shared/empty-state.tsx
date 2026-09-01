import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/ui/utils";

/**
 * The one empty state.
 *
 * Five grammars used to ship for the same moment: four one-file modules
 * (history, assets, shares, public-scans) that were the same JSX with a
 * different icon and sentence, plus a set of inline copies in teams, the
 * results list, the scan detail and the badge page, at three paddings
 * (py-10 / py-12 / py-14), three radii and four surfaces. A new account meets
 * this element on five pages in a row, so it should be one element, and a copy
 * or accessibility fix should be one edit rather than nine.
 *
 * `variant="inline"` drops the border and background for use inside a card
 * that already has one. `size="sm"` is the "nothing matches that filter"
 * treatment: smaller icon, tighter padding.
 *
 * SIZE sets density, TONE sets emphasis, and they are deliberately separate.
 * The first pass conflated them, and the cost was paid at the one moment in
 * this product worth getting right: "Nothing found on this scan" is the best
 * news a vulnerability scanner ever delivers, and it rendered as a gray dashed
 * box with a green sentence in it, no icon, indistinguishable at a glance from
 * "you have not created any assets yet". `warning` had a tinted container but
 * a gray icon; `success` had neither. A toned state is a VERDICT about the
 * thing the user just ran, so it now carries the tone across the whole
 * element: container, icon and title. An untoned state is just an absence, and
 * stays quiet on purpose. That contrast is the point; making every empty state
 * loud would put us back where we started.
 */
const TONE = {
  default: {
    container: "border-border bg-card/50",
    icon: "text-muted-foreground/60",
    title: "text-foreground",
  },
  warning: {
    container: "border-[hsl(var(--warning))]/40 bg-[hsl(var(--warning))]/5",
    icon: "text-[hsl(var(--warning))]",
    title: "text-[hsl(var(--warning))]",
  },
  success: {
    container: "border-[hsl(var(--success))]/40 bg-[hsl(var(--success))]/5",
    icon: "text-[hsl(var(--success))]",
    title: "text-[hsl(var(--success))]",
  },
} as const;

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = "default",
  size = "md",
  tone = "default",
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  /** Rendered under the copy. Usually a Button. */
  action?: React.ReactNode;
  variant?: "default" | "inline";
  size?: "sm" | "md";
  /** Anything other than "default" states a verdict about what the user just
   *  ran, rather than simply reporting that a list is empty, and is drawn with
   *  the matching accent throughout. */
  tone?: "default" | "warning" | "success";
  className?: string;
}) {
  const toned = tone !== "default";
  const styles = TONE[tone];

  return (
    <div
      className={cn(
        // A fade rather than nothing: this element almost always replaces a
        // list that was just there (a filter cleared, a scan finished), and
        // swapping one for the other in a single frame is the abrupt bit.
        // prefers-reduced-motion is clamped globally in app/globals.css.
        "flex animate-in flex-col items-center gap-3 px-4 text-center fade-in-0 duration-200",
        size === "sm" ? "py-12" : "py-14",
        variant === "default" &&
          cn("rounded-xl border border-dashed", styles.container),
        className,
      )}
    >
      {Icon && (
        <Icon
          aria-hidden
          className={cn(size === "sm" ? "h-5 w-5" : "h-7 w-7", styles.icon)}
        />
      )}
      <div className="flex flex-col gap-1">
        <p
          className={cn(
            "text-balance",
            size === "sm" ? "text-sm" : "text-base",
            // A plain "nothing here yet" is a caption; a verdict is a
            // headline, whatever density it is drawn at.
            !toned && size === "sm" ? "font-medium" : "font-semibold",
            styles.title,
          )}
        >
          {title}
        </p>
        {description && (
          <p
            className={cn(
              "text-muted-foreground",
              size === "sm" ? "max-w-sm text-xs" : "max-w-md text-sm",
              // Ordered after the size on purpose: a text-<size> utility also
              // sets a line-height, so tailwind-merge drops a leading-* that
              // precedes it. Written first, this class never survived cn().
              "leading-relaxed",
            )}
          >
            {description}
          </p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
