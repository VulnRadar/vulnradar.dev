"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/ui/utils";

export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme();

  // Default to dark to match the html class="dark" set on the server,
  // so SSR and first paint always agree - no flash.
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
      aria-checked={isDark}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "relative flex items-center h-8 w-16 rounded-full border border-border transition-colors duration-300 px-1",
        isDark ? "bg-muted" : "bg-primary/10",
      )}
      aria-label="Dark mode"
    >
      {/* Icons on both sides */}
      <Sun
        aria-hidden="true"
        className={cn(
          "h-3.5 w-3.5 absolute left-2 transition-opacity duration-300",
          isDark ? "opacity-40 text-muted-foreground" : "opacity-0",
        )}
      />
      <Moon
        aria-hidden="true"
        className={cn(
          "h-3.5 w-3.5 absolute right-2 transition-opacity duration-300",
          isDark ? "opacity-0" : "opacity-40 text-muted-foreground",
        )}
      />

      {/* Sliding dot */}
      <div
        className={cn(
          "h-6 w-6 rounded-full flex items-center justify-center shadow-xs transition-all duration-300 ease-out",
          isDark ? "translate-x-8 bg-card" : "translate-x-0 bg-card",
        )}
      >
        {isDark ? (
          <Moon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        ) : (
          <Sun className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        )}
      </div>
    </button>
  );
}
