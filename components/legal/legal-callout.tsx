"use client";

import { Callout } from "@/components/shared/callout";

/**
 * The legal pages' aside, now the same component the docs use.
 *
 * It used to be its own implementation: rounded-xl, border-2 (a width used on
 * no other non-decorative element in the product), no icon, no coloured rule,
 * an <h3> title inside sections that already have their own h3s, and a
 * `warning` variant painted with --severity-medium where the docs callout used
 * --warning. Two grammars for the same aside, and the same word meaning two
 * colours. `danger` is retired in favour of `error`, which is what it always
 * was; it is still accepted so an existing page keeps working.
 */
export function LegalCallout({
  variant = "info",
  title,
  children,
  className,
}: {
  variant?: "warning" | "danger" | "error" | "info" | "success";
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Callout
      variant={variant === "danger" ? "error" : variant}
      title={title}
      className={className ?? "max-w-prose"}
    >
      {children}
    </Callout>
  );
}
