"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/ui/utils";
import {
  modalBand,
  modalCloseChip,
  modalCloseClearance,
  modalCompact,
  modalPanel,
  modalPositioner,
  modalScrim,
  modalSize,
  modalTier,
  type ModalSize,
  type ModalTier,
} from "@/components/ui/modal-grammar";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

/**
 * Which tier the surrounding DialogContent is.
 *
 * Header, body and footer read this instead of taking a prop, so a call site
 * cannot pair a banded header with a padded panel (which is exactly how the
 * shells drifted apart the first time: every modal restated its own padding).
 * Picking `variant` on DialogContent is the only styling decision left.
 */
const DialogTierContext = React.createContext<ModalTier>("compact");

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(modalScrim, className)}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

interface DialogContentProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  /**
   * `shell` is the house modal: header band, scrolling body, footer band. Use
   * it for anything with a form, a list or content that can grow.
   *
   * `compact` is a single padded box that scrolls as one, for prompts short
   * enough that three dividers would be theater. It stays the default so the
   * dozens of two-sentence dialogs do not each have to opt out.
   */
  variant?: ModalTier;
  /** Width rung. Overridden by an explicit max-w in `className`. */
  size?: ModalSize;
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(
  (
    { className, children, variant = "compact", size = "md", ...props },
    ref,
  ) => (
    <DialogPortal>
      <DialogOverlay />
      <div className={modalPositioner}>
        <DialogPrimitive.Content
          ref={ref}
          className={cn(
            modalPanel,
            modalTier[variant],
            modalSize[size],
            className,
          )}
          onOpenAutoFocus={(e) => {
            // Radix's default focuses the first focusable descendant, which in
            // this product is often a submit or destructive button, so Enter
            // could fire it the instant the dialog opened. That is still the
            // reason for preventDefault().
            //
            // What preventDefault() ALONE did was leave focus on the trigger,
            // which Radix has just put behind an aria-hidden barrier: a
            // keyboard user got no visible focus anywhere on screen, a screen
            // reader was never told a dialog had opened, and the first Tab was
            // eaten by FocusScope hauling focus back inside. Moving focus to
            // the panel itself keeps Enter inert (the panel is not a control)
            // while satisfying SC 2.4.3 and 4.1.2: focus is inside the dialog,
            // the dialog is announced, and Tab continues from here. Radix gives
            // Content tabindex="-1" for exactly this, and the global
            // :focus-visible rule in app/globals.css skips tabindex="-1", so
            // this does not paint a ring around the whole panel.
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus();
          }}
          {...props}
        >
          <DialogTierContext.Provider value={variant}>
            {children}
          </DialogTierContext.Provider>
          <DialogPrimitive.Close className={modalCloseChip}>
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </div>
    </DialogPortal>
  ),
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  const tier = React.useContext(DialogTierContext);
  return (
    <div
      className={cn(
        tier === "shell" ? modalBand.header : modalCompact.header,
        // Every Dialog renders a close chip, so every Dialog header reserves
        // its corner. Without it a long title ran underneath the button.
        modalCloseClearance[tier],
        className,
      )}
      {...props}
    />
  );
};
DialogHeader.displayName = "DialogHeader";

/**
 * The scrolling middle band. Only meaningful inside `variant="shell"`; in a
 * compact dialog the whole panel already scrolls, so it renders as a plain
 * block and adds nothing.
 */
const DialogBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  const tier = React.useContext(DialogTierContext);
  return (
    <div
      className={cn(tier === "shell" ? modalBand.body : undefined, className)}
      {...props}
    />
  );
};
DialogBody.displayName = "DialogBody";

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  const tier = React.useContext(DialogTierContext);
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
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-base font-semibold leading-tight tracking-tight text-foreground",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm leading-relaxed text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
