"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/ui/utils";
import { toggles } from "@/lib/ui/animations";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // a11y (SC 1.4.11, state). Which tab is selected was carried by
      // bg-background sitting inside the list's bg-muted, and those two
      // measure 1.13:1 apart on the light theme and 1.30:1 on the dark one,
      // so the selected pill was all but invisible against its own list; the
      // shadow-xs beside it is a 1px hairline that does not carry the job
      // either. A 1px inset ring in --input outlines the selected tab at
      // 3.13:1 against the list on the light theme and 3.17:1 on the dark
      // one, without changing the trigger's box and so without the layout
      // shift a border or a font-weight swap would cause. The global
      // :focus-visible rule in app/globals.css is a more specific selector,
      // so a keyboard-focused tab still paints the ring-2 focus indicator
      // over this.
      "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs data-[state=active]:ring-1 data-[state=active]:ring-inset data-[state=active]:ring-input",
      // Was a bare `transition-all`, which also animated the trigger's own box
      // whenever a sibling's label changed width. Only the colours change on
      // activation, so only the colours are transitioned.
      toggles.control,
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("mt-2 focus-visible:outline-hidden", className)}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
