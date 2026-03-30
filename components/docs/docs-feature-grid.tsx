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
          className="flex items-start gap-3 p-4 rounded-lg bg-card/50 border border-border/40 transition-colors hover:border-border/60"
        >
          <feature.icon className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="font-semibold text-sm">{feature.title}</h3>
            <p className="text-xs text-muted-foreground">{feature.description}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
