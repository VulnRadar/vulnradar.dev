"use client"

import type { Feature } from "./docs-types"
import { cn } from "@/lib/ui/utils"

interface DocsFeatureGridProps {
  features: Feature[]
  columns?: 2 | 3
  className?: string
}

export function DocsFeatureGrid({ features, columns = 3, className }: DocsFeatureGridProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4",
        columns === 3 && "lg:grid-cols-3",
        className
      )}
    >
      {features.map((feature, i) => (
        <div
          key={i}
          className="flex items-start gap-3 p-4 rounded-xl bg-card/50 border border-border/50 transition-colors hover:border-primary/30"
        >
          <div className="p-2 rounded-lg bg-primary/10 flex-shrink-0">
            <feature.icon className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-foreground">{feature.title}</h3>
            <p className="text-sm text-muted-foreground">{feature.description}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
