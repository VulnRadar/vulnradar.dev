"use client";

import * as React from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";

import { cn } from "@/lib/ui/utils";
import { buttonVariants } from "@/components/ui/button";
import {
  modalBand,
  modalCompact,
  modalPanel,
  modalPositioner,
  modalScrim,
  modalSize,
  modalTier,
  type ModalSize,
  type ModalTier,
} from "@/components/ui/modal-grammar";

const AlertDialog = AlertDialogPrimitive.Root;

const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

const AlertDialogPortal = AlertDialogPrimitive.Portal;

/** See components/ui/dialog.tsx for why the tier travels by context. */
const AlertTierContext = React.createContext<ModalTier>("compact");

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    className={cn(modalScrim, className)}
    {...props}
    ref={ref}
  />
));
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName;

interface AlertDialogContentProps extends React.ComponentPropsWithoutRef<
  typeof AlertDialogPrimitive.Content
> {
  /**
   * `compact` by default and almost always right: an alert dialog asks one
   * question. `shell` exists for the few that carry a list of what is about to
   * be deleted, where the footer has to stay pinned below it.
   */
  variant?: ModalTier;
  size?: ModalSize;
}

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  AlertDialogContentProps
>(
  (
    { className, children, variant = "compact", size = "sm", ...props },
    ref,
  ) => (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <div className={modalPositioner}>
        <AlertDialogPrimitive.Content
          ref={ref}
          className={cn(
            modalPanel,
            modalTier[variant],
            modalSize[size],
            className,
          )}
          onOpenAutoFocus={(e) => {
            // Same reasoning as DialogContent's override: Radix's default
            // auto-focuses the first focusable descendant, which for an
            // AlertDialog is very often the confirm/destructive action button,
            // so Enter must not be able to fire it on open. Focus then moves to
            // the panel rather than being left on the now aria-hidden trigger,
            // so the dialog is announced and Tab starts inside it. See
            // DialogContent for the full note.
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus();
          }}
          {...props}
        >
          <AlertTierContext.Provider value={variant}>
            {children}
          </AlertTierContext.Provider>
        </AlertDialogPrimitive.Content>
      </div>
    </AlertDialogPortal>
  ),
);
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName;

const AlertDialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  const tier = React.useContext(AlertTierContext);
  return (
    <div
      // No close-chip clearance here, unlike DialogHeader: an alert dialog
      // renders no close button, because it exists to be answered.
      className={cn(
        tier === "shell" ? modalBand.header : modalCompact.header,
        className,
      )}
      {...props}
    />
  );
};
AlertDialogHeader.displayName = "AlertDialogHeader";

const AlertDialogBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  const tier = React.useContext(AlertTierContext);
  return (
    <div
      className={cn(tier === "shell" ? modalBand.body : undefined, className)}
      {...props}
    />
  );
};
AlertDialogBody.displayName = "AlertDialogBody";

const AlertDialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  const tier = React.useContext(AlertTierContext);
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
AlertDialogFooter.displayName = "AlertDialogFooter";

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-base font-semibold leading-tight tracking-tight text-foreground",
      className,
    )}
    {...props}
  />
));
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName;

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn("text-sm leading-relaxed text-muted-foreground", className)}
    {...props}
  />
));
AlertDialogDescription.displayName =
  AlertDialogPrimitive.Description.displayName;

const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Action
    ref={ref}
    className={cn(buttonVariants(), className)}
    {...props}
  />
));
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName;

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    // The old `mt-2 sm:mt-0` was compensating for a footer that had no gap on
    // mobile. The footer owns its own gap now, so this only has to be a
    // button.
    className={cn(buttonVariants({ variant: "outline" }), className)}
    {...props}
  />
));
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName;

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogBody,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
