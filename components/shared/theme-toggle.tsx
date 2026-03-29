"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"

export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme()

  // Default to dark to match the html class="dark" set on the server,
  // so SSR and first paint always agree - no flash.
  const isDark = (resolvedTheme ?? "dark") === "dark"

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "relative flex items-center h-8 w-16 rounded-full border border-border transition-colors duration-300 px-1",
        isDark ? "bg-muted" : "bg-primary/10",
      )}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
    >
      {/* Icons on both sides */}
      <Sun className={cn(
        "h-3.5 w-3.5 absolute left-2 transition-opacity duration-300",
        isDark ? "opacity-40 text-muted-foreground" : "opacity-0",
      )} />
      <Moon className={cn(
        "h-3.5 w-3.5 absolute right-2 transition-opacity duration-300",
        isDark ? "opacity-0" : "opacity-40 text-muted-foreground",
      )} />

      {/* Sliding dot */}
      <div className={cn(
        "h-6 w-6 rounded-full flex items-center justify-center shadow-sm transition-all duration-300 ease-out",
        isDark
          ? "translate-x-8 bg-card"
          : "translate-x-0 bg-card",
      )}>
        {isDark ? (
          <Moon className="h-3.5 w-3.5 text-primary" />
        ) : (
          <Sun className="h-3.5 w-3.5 text-primary" />
        )}
      </div>
    </button>
  )
}
