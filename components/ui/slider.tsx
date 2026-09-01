"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "@/lib/ui/utils";

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center",
      className,
    )}
    {...props}
  >
    {/* a11y (SC 1.4.11). Both the filled range and the thumb ring were
        --primary, which on the light theme is 1.85:1 against the track and
        1.99:1 against the page: on the image-crop zoom slider you could see
        neither how far along it was nor where the handle sat. --primary-text
        is the same brand hue at AA strength (4.56:1 on the page) and is the
        same value as --primary in dark mode, so the dark slider is
        unchanged. */}
    <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary">
      <SliderPrimitive.Range className="absolute h-full bg-[hsl(var(--primary-text))]" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block h-5 w-5 rounded-full border-2 border-[hsl(var(--primary-text))] bg-background transition-colors focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50" />
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
