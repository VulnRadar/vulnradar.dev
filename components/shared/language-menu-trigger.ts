import { cn } from "@/lib/ui/utils";
import { focus } from "@/lib/ui/animations";

/**
 * The language button's look, shared by the static shell in language-menu.tsx
 * and the Radix trigger in language-menu-impl.tsx.
 *
 * The shell is what is on screen until the menu's code arrives, and the
 * trigger replaces it in place. If the two spell their classes separately a
 * change to one makes the button jump when the swap happens, so there is one
 * spelling.
 */
export function languageTriggerClassName(className?: string): string {
  return cn(
    // The same shape, size and states as the bell beside it: a circle,
    // 44px below sm for the touch target, and a held-open look while
    // the menu is showing.
    "inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-busy:opacity-60 sm:h-9 sm:w-9",
    "data-[state=open]:bg-muted data-[state=open]:text-foreground",
    focus.ring,
    className,
  );
}
