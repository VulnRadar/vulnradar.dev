"use client";

import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";

import { cn } from "@/lib/ui/utils";
import {
  modalBand,
  modalCloseChip,
  modalCloseClearance,
  modalCompact,
  modalScrim,
  type ModalTier,
} from "@/components/ui/modal-grammar";

const Sheet = SheetPrimitive.Root;

const SheetTrigger = SheetPrimitive.Trigger;

const SheetClose = SheetPrimitive.Close;

const SheetPortal = SheetPrimitive.Portal;

/** See components/ui/dialog.tsx for why the tier travels by context. */
const SheetTierContext = React.createContext<ModalTier>("compact");

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      modalScrim,
      "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
    ref={ref}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  // Same surface as the dialog panel (components/ui/modal-grammar.ts), minus
  // the radius and the max-height: a sheet is flush to a viewport edge and
  // fills it, so a corner radius there would be arbitrary and a max-height
  // would leave a gap. Everything else -- bg-card, the bare --border edge, the
  // shadow -- is deliberately the same, so a sheet reads as the same object as
  // a dialog seen from the side.
  //
  // The edge border is left bare. It was briefly border-input on the theory
  // that the Tailwind v4 compat shim at the top of app/globals.css
  // (`border-color: var(--color-gray-200, currentcolor)`) would otherwise
  // paint a near-white hairline. It does not: that shim and the
  // `* { @apply border-border }` rule are both single-`*` selectors in
  // @layer base, so source order decides, and border-border is emitted later
  // and wins. See modal-grammar.ts for why SC 1.4.11 does not reach a panel
  // edge.
  "fixed z-50 flex flex-col bg-card shadow-lg transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
      variant: {
        // A sheet is tall and its content usually scrolls, so `shell` is the
        // default here where it is the opt-in for a dialog.
        shell: "overflow-hidden",
        compact: "gap-4 overflow-y-auto p-6",
      },
    },
    defaultVariants: {
      side: "right",
      variant: "shell",
    },
  },
);

interface SheetContentProps
  extends
    React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(
  (
    { side = "right", variant = "shell", className, children, ...props },
    ref,
  ) => (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        ref={ref}
        className={cn(sheetVariants({ side, variant }), className)}
        onOpenAutoFocus={(e) => {
          // Same reasoning as components/ui/dialog.tsx's override: don't
          // auto-focus the first link/button inside (e.g. the mobile nav's
          // first item), but do move focus into the panel so the sheet is
          // announced and Tab starts inside it rather than on the trigger
          // Radix has just hidden behind the scrim.
          e.preventDefault();
          (e.currentTarget as HTMLElement).focus();
        }}
        {...props}
      >
        <SheetTierContext.Provider value={variant ?? "shell"}>
          {children}
        </SheetTierContext.Provider>
        <SheetPrimitive.Close className={modalCloseChip}>
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  ),
);
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  const tier = React.useContext(SheetTierContext);
  return (
    <div
      className={cn(
        tier === "shell" ? modalBand.header : modalCompact.header,
        modalCloseClearance[tier],
        className,
      )}
      {...props}
    />
  );
};
SheetHeader.displayName = "SheetHeader";

const SheetBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  const tier = React.useContext(SheetTierContext);
  return (
    <div
      className={cn(tier === "shell" ? modalBand.body : undefined, className)}
      {...props}
    />
  );
};
SheetBody.displayName = "SheetBody";

const SheetFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  const tier = React.useContext(SheetTierContext);
  return (
    <div
      className={cn(
        tier === "shell" ? modalBand.footer : modalCompact.footer,
        className,
      )}
      {...props}
    />
  );
};
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn(
      "text-base font-semibold leading-tight tracking-tight text-foreground",
      className,
    )}
    {...props}
  />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-sm leading-relaxed text-muted-foreground", className)}
    {...props}
  />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
