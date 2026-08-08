"use client";

import {
  AlertTriangle,
  Info,
  CheckCircle,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/ui/utils";

type CalloutVariant = "info" | "warning" | "success" | "error";

/**
 * Colours come from the theme's semantic tokens, so a callout stays legible
 * when the palette is retuned and in both light and dark. The left rule does
 * the work; there is no icon-in-a-rounded-square, because four of those down
 * a page is decoration, not information.
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

interface DocsCalloutProps {
  variant?: CalloutVariant;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function DocsCallout({
  variant = "info",
  title,
  children,
  className,
}: DocsCalloutProps) {
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
        <Icon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
        <span>{title ?? styles.label}</span>
      </p>
      <div className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground [&_a]:text-primary [&_a]:underline-offset-2 hover:[&_a]:underline">
        {children}
      </div>
    </aside>
  );
}
