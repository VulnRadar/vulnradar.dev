"use client";

import { Card } from "@/components/ui/card";
import type { Step } from "./docs-types";
import { cn } from "@/lib/ui/utils";

/**
 * A real ordered list, numbered by the browser. Numbers in circle badges look
 * like a diagram and read like one too: the reader has to work out that the
 * items are sequential. An <ol> says it outright and survives copy-paste.
 */
export function DocsSteps({
  steps,
  className,
}: {
  steps: Step[];
  className?: string;
}) {
  return (
    <ol
      className={cn(
        "divide-y divide-border/50 border-y border-border/50",
        className,
      )}
    >
      {steps.map((item) => (
        <li key={item.step} className="flex gap-3 py-3">
          <span
            aria-hidden="true"
            className="w-4 flex-shrink-0 text-sm font-semibold text-primary tabular-nums"
          >
            {item.step}.
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium leading-tight text-foreground">
              {item.title}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {item.description}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

interface DocsStepCardProps {
  step: number;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function DocsStepCard({
  step,
  title,
  description,
  children,
  className,
}: DocsStepCardProps) {
  return (
    <Card className={cn("p-3 sm:p-5 border-border/50 bg-card/50", className)}>
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-sm font-semibold text-primary tabular-nums">
          {step}.
        </span>
        <h3 className="text-sm font-medium leading-tight text-foreground">
          {title}
        </h3>
      </div>
      {description && (
        <p className="mb-3 text-sm text-muted-foreground">{description}</p>
      )}
      {children}
    </Card>
  );
}
