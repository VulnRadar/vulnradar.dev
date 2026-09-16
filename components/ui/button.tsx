import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/ui/utils";

const buttonVariants = cva(
  // `transition`, not `transition-colors`: the press state below moves a
  // transform, and transition-colors does not carry one, so the button would
  // snap between sizes instead of settling.
  //
  // active:scale-[0.98] is the press feedback the product has been missing.
  // The design language in DESIGN.md makes a press scale the system-wide
  // micro-interaction on every button, and this app had it written down
  // twice and rendered zero times: `hovers.button` and
  // `interactive.buttonOutline` in lib/ui/animations.ts both carry this exact
  // class and neither object has a single importer anywhere in app/ or
  // components/, which is why app/globals.css safelists the class (an
  // arbitrary value is not reliably extracted from a TS string literal) and
  // why that safelist was, in practice, compiling a rule nothing rendered.
  // Putting it on the primitive is what actually connects it.
  //
  // Reduced motion is already handled globally: the
  // prefers-reduced-motion block in app/globals.css forces
  // transition-duration to 0.01ms on everything, so the press lands
  // instantly rather than animating.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition active:scale-[0.98] focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // The hover used to be `hover:bg-accent hover:text-accent-foreground`,
        // from a repo-wide "standardize hover styles to neutral gray accent"
        // replacement (64b7e06f). That rule is right for outline, secondary
        // and ghost, which are neutral surfaces that should not acquire the
        // brand colour on hover. Applied to this variant it inverted: the
        // button already IS the brand colour, so hovering the product's
        // highest-traffic controls (Sign in, Start scan, every primary CTA on
        // the landing page) drained them to the same flat gray as every other
        // button, which reads as the control going disabled under the cursor.
        // `destructive` directly below never had this problem because it kept
        // its own hue and only shifted luminance, which is what this now does:
        // over --background, /90 lifts the light theme's pale blue and deepens
        // the dark theme's, so the feedback is visible in both without the
        // control ever changing what colour it is.
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
      // Opt-in, and deliberately a separate axis from `size` rather than a
      // new variant or a new size.
      //
      // The marketing surface wants the full-pill CTA of the design language
      // in DESIGN.md, where the pill radius IS the "this is the action"
      // signal. The app does not: a pill on a dense toolbar reads as a chip,
      // and `rounded-md` is the control rung of the radius ladder in
      // CLAUDE.md, which every other control in the product sits on.
      //
      // Making it a variant would have forced a choice between pill and
      // `destructive`/`outline`; making it a size would have forced a choice
      // between pill and `lg`. As its own axis a hero CTA can be
      // `size="lg" shape="pill"` and still be the primary blue, and nothing
      // that does not ask for it changes. It is declared after `size` so its
      // radius wins over the `rounded-md` baked into `sm`/`lg` - cva emits
      // variants in key order and tailwind-merge keeps the last radius.
      shape: {
        default: "",
        pill: "rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      shape: "default",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
  shape?: VariantProps<typeof buttonVariants>["shape"];
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  // `shape` has to be destructured, not just typed. Anything left in props is
  // spread onto the element, and React would pass an unknown `shape` straight
  // through to the DOM, where it is an invalid attribute on <button> and a
  // hydration warning in the console.
  ({ className, variant, size, shape, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, shape, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
