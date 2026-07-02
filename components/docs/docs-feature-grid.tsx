"use client";

import type { Feature } from "./docs-types";
import { cn } from "@/lib/ui/utils";

interface DocsFeatureGridProps {
  features: Feature[];
  columns?: 2 | 3;
  className?: string;
}

export function DocsFeatureGrid({
  features,
  columns = 3,
  className,
}: DocsFeatureGridProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 sm:grid-cols-2 gap-x-8",
        columns === 3 && "lg:grid-cols-3",
        className,
      )}
    >
      {features.map((feature, i) => (
        <div
          key={i}
          className="flex items-start gap-2.5 py-3 border-b border-border/20 last:border-0"
        >
          <feature.icon className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
          <div>
            <span className="text-sm font-medium text-foreground">
              {feature.title}
            </span>
            <p className="text-xs text-muted-foreground mt-0.5">
              {feature.description}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
