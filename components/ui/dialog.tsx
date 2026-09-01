"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/ui/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    // The scrim used to be bg-black/80. In dark mode that is close enough to
    // bg-background/80, which the newer in-app modals use, but in light mode
    // --background is 213 25% 90%, so the two are opposites: opening a
    // black/80 modal and then a background/80 one dimmed the page to near
    // black and then washed it to near white, which reads as a rendering bug.
    // One scrim, correct in both themes.
    className={cn(
      "fixed inset-0 z-50 bg-background/80 backdrop-blur-xs",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          // bg-card, not bg-background: the scrim above is now built from
          // --background, so a bg-background panel would have nothing but its
          // border separating it from the dimmed page behind.
          //
          // A bare `border`, which resolves to --border through the
          // `* { @apply border-border }` rule in app/globals.css. This was
          // briefly `border-input` to satisfy SC 1.4.11, which was a misread:
          // that criterion asks for 3:1 on the visual information required to
          // identify a user interface COMPONENT and its states. A modal panel
          // is not a component you operate. It is identified by its own
          // surface, its shadow and the scrim over the page behind it, all
          // three of which are present here. Putting a 3:1 rule around it
          // bought no conformance and drew a hard outline around every modal
          // in the product. The control edge inside the panel is where
          // --input belongs, and that is where it stayed.
          "relative z-50 grid w-full max-w-lg gap-4 border bg-card p-6 shadow-lg sm:rounded-lg max-h-[90vh] overflow-y-auto",
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
        {children}
        {/* A real background chip (not just the bare icon) so this stays
            legible over whatever's directly behind it -- a colored
            severity rail, an image, anything -- instead of blending in. */}
        <DialogPrimitive.Close className="absolute right-4 top-4 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-border/60 bg-background/90 text-muted-foreground backdrop-blur-xs transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </div>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
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
    className={cn("text-sm text-muted-foreground", className)}
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
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
