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
    <aside className="hidden xl:block w-56 flex-shrink-0">
      <div className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto py-8 px-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-4">
          On This Page
        </h3>
        <nav className="space-y-0.5 border-l border-border/50">
          {items.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={cn(
                "block py-1.5 pl-4 text-sm transition-colors border-l-2 -ml-px",
                item.level === 2 && "pl-6",
                activeSection === item.id
                  ? "text-primary font-medium border-primary"
                  : "text-muted-foreground hover:text-foreground border-transparent hover:border-border"
              )}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </div>
    </aside>
  )
}
