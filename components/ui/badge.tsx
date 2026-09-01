import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/ui/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground",
        outline: "text-foreground",
        // info / success / warning / error used to live here as
        // bg-blue-500/10 text-blue-600 and friends: the only primitive in
        // components/ui that painted from the raw Tailwind palette instead
        // of the theme tokens, and the only one with no dark-mode variant,
        // so text-blue-600 on a dark card was close to unreadable. They had
        // zero call sites across app/ and components/ (status colour is done
        // with the --severity-* and --success/--warning tokens everywhere it
        // actually happens), so they are removed rather than re-tokenised:
        // adding a fifth way to paint a status was the problem.
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
