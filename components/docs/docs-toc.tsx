"use client"

import { cn } from "@/lib/ui/utils"
import type { TocItem } from "./docs-types"

interface DocsTocProps {
  items: TocItem[]
  activeSection: string
}

export function DocsToc({ items, activeSection }: DocsTocProps) {
  if (items.length === 0) return null

  return (
    <aside className="hidden xl:block w-64 flex-shrink-0">
      <div className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto py-8 px-6">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
          On This Page
        </h3>
        <nav className="space-y-1">
          {items.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={cn(
                "group flex items-center gap-2 py-1.5 text-sm transition-all duration-200",
                item.level === 2 && "pl-4",
                activeSection === item.id
                  ? "text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span
                className={cn(
                  "w-1 h-1 rounded-full transition-all duration-200",
                  activeSection === item.id
                    ? "bg-primary w-1.5 h-1.5"
                    : "bg-muted-foreground/30 group-hover:bg-muted-foreground/50"
                )}
              />
              {item.label}
            </a>
          ))}
        </nav>
      </div>
    </aside>
  )
}
