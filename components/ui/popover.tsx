"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/ui/utils";
import { useCloseOnScroll } from "@/lib/ui/use-close-on-scroll";

/**
 * Wraps Radix Popover.Root so every popover in the app closes when the PAGE
 * scrolls (see useCloseOnScroll) -- the behavior the scan form's check-families
 * panels established, applied consistently everywhere instead of per usage.
 *
 * It has to own the open state to be able to close it: controlled usage
 * (`open` + `onOpenChange`) is respected and simply gets its onOpenChange
 * called on scroll; uncontrolled usage is tracked here so it, too, can be
 * closed. Radix is always driven controlled from here, which is transparent to
 * callers.
 */
function Popover({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Root>) {
  const isControlled = open !== undefined;
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false);
  const actualOpen = isControlled ? open : internalOpen;

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const close = React.useCallback(() => setOpen(false), [setOpen]);
  useCloseOnScroll(actualOpen, close);

  return (
    <PopoverPrimitive.Root
      open={actualOpen}
      onOpenChange={setOpen}
      {...props}
    />
  );
}

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent };
