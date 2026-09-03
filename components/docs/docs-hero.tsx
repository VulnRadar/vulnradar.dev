"use client";

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
      {/* The category was an outline Badge pill, which put a third label
          shape above the title: the breadcrumb reads "Docs / Rate Limits" in
          small muted sans directly above it. A tracked mono kicker is a
          different register rather than a competing one, and it is the same
          kicker components/legal/legal-page-header.tsx already uses, so the
          two reference surfaces open the same way. text-primary rather than
          text-primary/70: the opacity form does not hit the .text-primary
          remap in globals.css, so in light mode it was painting the non-AA
          --primary at 70%. */}
      <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
        {badge}
      </p>
      {/* Tier A from CLAUDE.md. This was text-2xl sm:text-3xl, a third H1
          size that belonged to neither tier and left only a 4px gap to the
          section headings below it. */}
      <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-4 text-balance text-foreground">
        {title}
      </h1>
      <p className="text-base text-muted-foreground leading-relaxed max-w-[68ch]">
        {description}
      </p>

      {stats && stats.length > 0 && (
        // A spec strip, not four stat cards. The numbers used to run inline
        // inside a sentence-shaped row ("795+ checks 18 categories"), where
        // the values had no more presence than the labels. Stacking value
        // over label makes the figures the thing you see, and the pairs are
        // a <dl> because that is what they are. No vertical rules between
        // them: four stats wrap on a phone, and a rule on the first item of
        // the second row hangs off nothing.
        <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-4 border-t border-border/50 pt-4">
          {stats.map((stat, i) => (
            <div key={i} className="flex min-w-0 flex-col-reverse gap-0.5">
              <dt className="text-xs text-muted-foreground">{stat.label}</dt>
              <dd className="text-lg font-semibold leading-none tabular-nums text-foreground">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <DocsInlineToc items={tocItems} />
    </section>
  );
}
