"use client";

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
            className="w-4 shrink-0 text-sm font-semibold text-primary tabular-nums"
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
