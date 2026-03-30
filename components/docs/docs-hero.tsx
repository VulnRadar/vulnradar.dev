"use client"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/ui/utils"
import type { QuickStat } from "./docs-types"

interface DocsHeroProps {
  id?: string
  badge: string
  title: string
  description: string
  stats?: QuickStat[]
  className?: string
}

export function DocsHero({ id = "overview", badge, title, description, stats, className }: DocsHeroProps) {
  return (
    <section id={id} className={cn("scroll-mt-24", className)}>
      <Badge variant="outline" className="mb-3 sm:mb-4 text-primary border-primary/30">
        {badge}
      </Badge>
      <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight mb-3 sm:mb-4">
        {title}
      </h1>
      <p className="text-base sm:text-lg text-muted-foreground leading-relaxed max-w-3xl">
        {description}
      </p>

      {stats && stats.length > 0 && (
        <div className={cn("grid gap-3 sm:gap-4 mt-6 sm:mt-8", `grid-cols-${Math.min(stats.length, 4)}`)}>
          {stats.map((stat, i) => (
            <div key={i} className="p-3 sm:p-4 rounded-lg bg-card border border-border/40">
              <div className="text-xl sm:text-2xl font-bold text-primary mb-1">{stat.value}</div>
              <div className="text-[10px] sm:text-xs text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
