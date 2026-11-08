import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/ui/utils";
import { DOCS_PROSE } from "./docs-prose";

/**
 * A collapsed block for material most readers skip ("How it works"). Native
 * <details>: keyboard operable and announced correctly with no JavaScript, and
 * it opens by itself when the browser's find-in-page lands inside it.
 */
export function DocsDetails({
  summary,
  open,
  id,
  children,
  className,
}: {
  summary: string;
  open?: boolean;
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details
      id={id}
      open={open}
      className={cn("rounded-lg border border-border/50 bg-card/50", className)}
    >
      <summary className="flex min-h-11 cursor-pointer items-center rounded-lg px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
        {summary}
      </summary>
      <div
        className={cn("space-y-3 border-t border-border/50 p-4", DOCS_PROSE)}
      >
        {children}
      </div>
    </details>
  );
}

/** "Before you start": what it takes, as a <dl> rather than a callout. */
export function DocsPrerequisites({
  time,
  need,
  costs,
  className,
}: {
  time?: ReactNode;
  need?: ReactNode;
  costs?: ReactNode;
  className?: string;
}) {
  const rows = (
    [
      ["Time", time],
      ["You need", need],
      ["Costs", costs],
    ] as [string, ReactNode][]
  ).filter(([, value]) => Boolean(value));

  return (
    <dl
      className={cn(
        "grid gap-x-4 gap-y-2 text-[15px] leading-relaxed sm:grid-cols-[8rem_1fr]",
        className,
      )}
    >
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="font-medium text-foreground">{label}</dt>
          <dd className="mb-2 text-foreground/85 sm:mb-0">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface DocsNextStep {
  href: string;
  label: string;
  /** Why this one comes next, in a line. */
  reason: string;
}

/** Up to three explicit next links, so a page does not just stop. */
export function DocsNextSteps({
  steps,
  className,
}: {
  steps: DocsNextStep[];
  className?: string;
}) {
  return (
    <ul className={cn("space-y-3", className)}>
      {steps.slice(0, 3).map((step) => (
        <li key={step.href}>
          <Link
            href={step.href}
            className="-my-1.5 block rounded-sm py-1.5 text-[15px] font-medium focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            {step.label}
          </Link>
          <span className="block text-[13px] leading-relaxed text-muted-foreground">
            {step.reason}
          </span>
        </li>
      ))}
    </ul>
  );
}
