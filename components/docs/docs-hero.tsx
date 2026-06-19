"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/ui/utils";
import type { QuickStat } from "./docs-types";

interface DocsHeroProps {
  id?: string;
  badge: string;
  title: string;
  description: string;
  stats?: QuickStat[];
  className?: string;
}

export function DocsHero({
  id = "overview",
  badge,
  title,
  description,
  stats,
  className,
}: DocsHeroProps) {
  return (
    <section id={id} className={cn("scroll-mt-24", className)}>
      <Badge
        variant="outline"
        className="mb-3 sm:mb-4 text-primary border-primary/30 bg-primary/5"
      >
        {badge}
      </Badge>
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3 sm:mb-4 text-foreground">
        {title}
      </h1>
      <p className="text-sm sm:text-base text-muted-foreground leading-relaxed max-w-3xl">
        {description}
      </p>

      {stats && stats.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mt-6 sm:mt-8">
          {stats.map((stat, i) => (
            <div
              key={i}
              className="flex items-center gap-3 p-3 sm:p-4 rounded-xl bg-card/50 border border-border/50"
            >
              <div>
                <div className="text-lg sm:text-xl font-bold text-primary">
                  {stat.value}
                </div>
                <div className="text-[10px] sm:text-xs text-muted-foreground">
                  {stat.label}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
