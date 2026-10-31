"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/ui/utils";

const subscribeToNothing = () => () => {};

/**
 * False on the server and during hydration, true from the first commit after.
 * A switch's checked state is the one thing here that React has to decide,
 * and it must not differ between the server's HTML and the client's first
 * render.
 */
function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
}

/**
 * The theme switch.
 *
 * Everything you can see is drawn with `dark:` classes, which the stylesheet
 * keys on the `dark` class that next-themes puts on <html> before first paint.
 * It used to be drawn from `resolvedTheme` in JavaScript, which is undefined
 * on the server and the stored theme on the client: a light-theme visitor's
 * first client render disagreed with the server's HTML, and React keeps the
 * server's attributes on a mismatch, so the thumb could sit on the dark side
 * of a light page. Now both renders are the same markup and CSS does the
 * choosing, the same way the rest of the app is themed.
 *
 * What React still decides is aria-checked, guarded by `mounted` so it too is
 * the same on both sides: true (the app's default is dark) until the theme has
 * actually been read.
 */
export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme();
  const mounted = useMounted();

  // Default to dark to match the html class="dark" set on the server.
  const isDark = (resolvedTheme ?? "dark") === "dark";

  return (
    /* a11y (SC 4.1.2). This is drawn as a switch -- a pill with a track and a
       sliding thumb -- but it was exposed as a plain button, so assistive tech
       could announce the action and never the current value: a screen-reader
       user could not tell which theme was on without changing it. role/
       aria-checked give it the value. The name goes static with it: an
       action-phrase name ("Switch to light mode") on a control that also
       reports checked state reads as a contradiction, so the name says what
       the control IS and aria-checked says where it sits. */
    <button
      type="button"
      role="switch"
      aria-checked={mounted ? isDark : true}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "relative flex items-center h-8 w-16 rounded-full border border-border transition-colors duration-300 px-1",
        "bg-primary/10 dark:bg-muted",
      )}
      aria-label="Dark mode"
    >
      {/* Icons on both sides */}
      <Sun
        aria-hidden="true"
        className="h-3.5 w-3.5 absolute left-2 transition-opacity duration-300 opacity-0 text-muted-foreground dark:opacity-40"
      />
      <Moon
        aria-hidden="true"
        className="h-3.5 w-3.5 absolute right-2 transition-opacity duration-300 opacity-40 text-muted-foreground dark:opacity-0"
      />

      {/* Sliding dot. Both icons are in the markup; the theme hides one. */}
      <div className="h-6 w-6 rounded-full flex items-center justify-center shadow-xs transition-all duration-300 ease-out bg-card translate-x-0 dark:translate-x-8">
        <Moon
          className="hidden h-3.5 w-3.5 text-primary dark:block"
          aria-hidden="true"
        />
        <Sun
          className="h-3.5 w-3.5 text-primary dark:hidden"
          aria-hidden="true"
        />
      </div>
    </button>
  );
}
