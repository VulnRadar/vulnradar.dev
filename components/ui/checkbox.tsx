"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";

import { cn } from "@/lib/ui/utils";
import { toggles } from "@/lib/ui/animations";

/* The box had no transition at all, so ticking it swapped an empty outline for
   a solid primary fill in one frame: the sharpest snap of any control in the
   product, and the one users hit most. The fill now settles over
   `toggles.control` and the tick is mounted with `toggles.markIn` rather than
   simply appearing, since Radix only renders the indicator while checked and
   there is no unchecked state to transition from.

   a11y (SC 1.4.11), and the reason the edge is two tokens rather than one.
   Unchecked, the border is the ONLY thing that says a checkbox is there, and
   it was `border-primary`: brand blue at 1.99:1 against the page and 2.25:1
   against a card in light mode, so on the light theme the box was close to
   invisible until you ticked it. Unchecked now uses --input, the control-edge
   token, at 3.54:1 and 4.00:1 on those same surfaces.

   Checked, the fill is --primary, which is 1.99:1 against the light theme's
   page: the tick inside it is legible (7.06:1) but the outer boundary of the
   control is not. So the checked edge keeps the brand hue and takes it from
   --primary-text, the darker blue this file's sibling token already defines
   for exactly this problem: 4.56:1 in light mode, and byte-identical to
   --primary in dark mode, so the dark theme still draws one seamless blue
   square and nothing about its look changes. */
const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer h-4 w-4 shrink-0 rounded-sm border border-input focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-[hsl(var(--primary-text))] data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
      toggles.control,
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn(
        "flex items-center justify-center text-current",
        toggles.markIn,
      )}
    >
      <Check className="h-4 w-4" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
