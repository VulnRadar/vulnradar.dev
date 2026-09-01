"use client";

import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/ui/utils";
import { toggles } from "@/lib/ui/animations";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      // a11y (SC 1.4.11), light theme. The ON track was bg-primary, the pale
      // blue this theme pairs with near-black button text. Measured on the
      // light theme that fill is 1.99:1 against the page, so the whole switch
      // disappeared into the background when it was on, and the white thumb
      // sitting on it was also 1.99:1, so you could not see which end the
      // thumb was at either: the two things that carry the state, both under
      // the bar. --primary-text is the same brand hue held to AA strength
      // (the token app/globals.css already defines because text-primary had
      // the identical problem), so the ON track is now 4.56:1 against the
      // page and the thumb reads 4.56:1 on it. In dark mode --primary-text is
      // byte-identical to --primary, so nothing about the dark switch moves.
      "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-[hsl(var(--primary-text))] data-[state=unchecked]:bg-input",
      // Track and thumb previously rode Tailwind's bare `transition-colors` /
      // `transition-transform` defaults, so the two halves of one control were
      // timed independently of everything else on the page. They were then
      // written out here as literal class strings that happened to match the
      // shared recipe, which meant the next retune of that recipe reached
      // every other toggle in the product and left this one behind. Imported
      // now, so the switch cannot drift again.
      toggles.control,
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0",
        toggles.indicator,
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
