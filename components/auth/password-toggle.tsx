"use client";

import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { focus, transitions } from "@/lib/ui/animations";

/**
 * The show/hide control inside a secret field.
 *
 * The name stays "Show password" and aria-pressed carries the state. The old
 * copies changed the label as well, so a screen reader announced "Hide
 * password, pressed": a button claiming to be on and offering to do the
 * opposite.
 */
export function PasswordToggle({
  shown,
  onToggle,
  label = "password",
  disabled,
  sizeClassName = "right-1 h-9 w-9 after:absolute after:-inset-1.5 sm:after:hidden",
  iconClassName = "h-4 w-4",
}: {
  shown: boolean;
  onToggle: () => void;
  /** What is being revealed, for the accessible name. */
  label?: string;
  disabled?: boolean;
  /**
   * The default is for an h-11 auth field: the after: overlay grows the hit
   * area past 44px while the visible control stays small enough to sit inside
   * the field. A shorter field passes its own box and overlay.
   */
  sizeClassName?: string;
  iconClassName?: string;
}) {
  const Icon = shown ? EyeOff : Eye;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-label={`Show ${label}`}
      aria-pressed={shown}
      className={cn(
        "absolute top-1/2 flex -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
        sizeClassName,
        transitions.colors,
        focus.ring,
      )}
    >
      <Icon className={iconClassName} aria-hidden="true" />
    </button>
  );
}
