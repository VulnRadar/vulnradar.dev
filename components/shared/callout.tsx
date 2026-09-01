"use client";

import {
  AlertTriangle,
  Info,
  CheckCircle,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/ui/utils";

export type CalloutVariant = "info" | "warning" | "success" | "error";

/**
 * The one aside.
 *
 * Colours come from the theme's semantic tokens, so a callout stays legible
 * when the palette is retuned and in both light and dark. The left rule does
 * the work; there is no icon-in-a-rounded-square, because four of those down
 * a page is decoration, not information.
 *
 * This lived in components/docs/ while components/legal/ carried a second
 * callout with an overlapping vocabulary: `warning` existed in both and
 * resolved to two different hues (--warning at 38deg here, --severity-medium
 * at 45deg there), and `error` and `danger` were the same thing under two
 * names, drawn at a border weight used nowhere else in the system. Moved here
 * because two sections use it; both docs-callout.tsx and legal-callout.tsx are
 * now thin re-exports so their call sites did not have to change.
 */
const variantStyles: Record<
  CalloutVariant,
  { rule: string; accent: string; icon: LucideIcon; label: string }
> = {
  info: {
    rule: "border-l-primary bg-primary/5",
    accent: "text-primary",
    icon: Info,
    label: "Note",
  },
  warning: {
    rule: "border-l-[hsl(var(--warning))] bg-[hsl(var(--warning))]/5",
    accent: "text-[hsl(var(--warning))]",
    icon: AlertTriangle,
    label: "Warning",
  },
  success: {
    rule: "border-l-[hsl(var(--success))] bg-[hsl(var(--success))]/5",
    accent: "text-[hsl(var(--success))]",
    icon: CheckCircle,
    label: "Works",
  },
  error: {
    rule: "border-l-destructive bg-destructive/5",
    accent: "text-destructive",
    icon: XCircle,
    label: "Do not",
  },
};

export interface CalloutProps {
  variant?: CalloutVariant;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function Callout({
  variant = "info",
  title,
  children,
  className,
}: CalloutProps) {
  const styles = variantStyles[variant];
  const Icon = styles.icon;

  return (
    <aside
      className={cn(
        "rounded-r-lg border border-l-4 border-border/50 p-4",
        styles.rule,
        className,
      )}
    >
      <p
        className={cn(
          "mb-1.5 flex items-center gap-1.5 text-xs font-semibold",
          styles.accent,
        )}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{title ?? styles.label}</span>
      </p>
      <div className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground [&_a]:text-primary [&_a]:underline-offset-2 [&_a]:hover:underline">
        {children}
      </div>
    </aside>
  );
}
