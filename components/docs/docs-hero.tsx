"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/ui/utils";
import { useDocsContext } from "./docs-shell";
import { DocsInlineToc } from "./docs-toc";
import type { QuickStat } from "./docs-types";

interface DocsHeroProps {
  id?: string;
  badge: string;
  title: string;
  description: string;
  stats?: QuickStat[];
  className?: string;
}

/**
 * The one <h1> on a docs page, plus the on-page contents for the widths
 * where the right-hand rail is hidden. The contents live here rather than in
 * the shell so they land directly under the title instead of above it.
 */
export function DocsHero({
  id = "overview",
  badge,
  title,
  description,
  stats,
  className,
}: DocsHeroProps) {
  const { tocItems } = useDocsContext();

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
        <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4 pt-4 border-t border-border/30">
          {stats.map((stat, i) => (
            <span key={i} className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground tabular-nums">
                {stat.value}
              </span>{" "}
              {stat.label}
            </span>
          ))}
        </div>
      )}

      <DocsInlineToc items={tocItems} />
    </section>
  );
}
