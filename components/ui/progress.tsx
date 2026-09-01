"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/ui/utils";

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn(
      "relative h-4 w-full overflow-hidden rounded-full bg-secondary",
      className,
    )}
    {...props}
  >
    {/* a11y (SC 1.4.11, graphical object): the filled length IS the value, so
        it has to be distinguishable from the unfilled track. bg-primary
        measured 1.85:1 against bg-secondary on the light theme, i.e. a bar
        with no readable fill on the plan-usage meter and the API-key quota
        meter. --primary-text is the same hue at AA strength and is identical
        to --primary in dark mode, so only the light theme changes. */}
    <ProgressPrimitive.Indicator
      className="h-full w-full flex-1 bg-[hsl(var(--primary-text))] transition-all"
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
    />
  </ProgressPrimitive.Root>
));
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
