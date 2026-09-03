"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/ui/utils";

interface ActionCardProps {
  icon: React.ElementType;
  label: string;
  description: string;
  color: string;
  bg: string;
  variant?: "danger" | "success";
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}

/**
 * Support action card button for admin actions.
 *
 * `variant="danger"` used to change the border to destructive/20 and nothing
 * else: the resting fill stayed `bg-card/30`, identical to a benign card, so
 * "Delete Account" and "Clear Avatar" were the same rectangle until you
 * hovered one of them. A destructive card now carries a tinted surface at
 * rest, which is the only state an operator scanning a grid of twenty cards
 * ever sees.
 *
 * The description is where the blast radius lives ("Remove all 412 scans"),
 * so it is not 10px muted filler: it is the sentence that decides whether the
 * click is safe, and it renders with tabular figures so a count is legible.
 *
 * Radius is `rounded-md` because this is a control, not a card, and because
 * these sit inside a `rounded-lg` Card: a child never gets a larger radius
 * than its container (CLAUDE.md's radius ladder). It was `rounded-xl`.
 */
export function ActionCard({
  icon: Icon,
  label,
  description,
  color,
  bg,
  variant,
  disabled,
  loading,
  onClick,
}: ActionCardProps) {
  return (
    <button
      className={cn(
        "flex items-center gap-3 p-3.5 rounded-md border transition-all text-left",
        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        disabled
          ? "border-border/40 bg-muted/20 opacity-50 cursor-not-allowed"
          : variant === "danger"
            ? "border-destructive/30 bg-destructive/5 hover:bg-destructive/10 hover:border-destructive/50 cursor-pointer"
            : variant === "success"
              ? "border-[hsl(var(--success))]/25 bg-[hsl(var(--success))]/5 hover:bg-[hsl(var(--success))]/10 hover:border-[hsl(var(--success))]/40 cursor-pointer"
              : "border-border/40 bg-card/30 hover:bg-card/50 hover:border-border/60 cursor-pointer",
      )}
      disabled={disabled || loading}
      onClick={onClick}
    >
      <div
        className={cn(
          "h-9 w-9 rounded-md flex items-center justify-center shrink-0",
          bg,
        )}
      >
        {loading ? (
          <Loader2 className={cn("h-4 w-4 animate-spin", color)} />
        ) : (
          <Icon className={cn("h-4 w-4", color)} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-sm font-medium",
            variant === "danger"
              ? "text-destructive"
              : variant === "success"
                ? "text-[hsl(var(--success))]"
                : "text-foreground",
          )}
        >
          {label}
        </p>
        <p
          className={cn(
            "text-[11px] leading-snug mt-0.5 tabular-nums",
            variant === "danger"
              ? "text-destructive/80"
              : "text-muted-foreground",
          )}
        >
          {description}
        </p>
      </div>
    </button>
  );
}
