"use client";

import { Link as LinkIcon } from "lucide-react";
import { cn } from "@/lib/ui/utils";

/**
 * A permalink beside a heading. Docs get quoted in issues and chat, and a
 * section nobody can link to gets described from memory instead.
 *
 * Hidden until the heading is hovered or the link itself is focused, so it
 * stays reachable by keyboard without adding a hash to every heading.
 */
function AnchorLink({ id, label }: { id: string; label: string }) {
  return (
    <a
      href={`#${id}`}
      aria-label={`Link to ${label}`}
      className={cn(
        "ml-2 inline-flex align-middle text-muted-foreground opacity-0 transition-opacity",
        "group-hover:opacity-100 focus-visible:opacity-100",
        "hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
      )}
    >
      <LinkIcon className="h-3.5 w-3.5" aria-hidden="true" />
    </a>
  );
}

/** House reading measure, the same one components/docs/docs-callout.tsx uses. */
const PROSE_MEASURE = "[&>p]:max-w-[68ch]";

/**
 * The paragraph immediately after the section heading, set one step larger.
 *
 * Every section on a docs page opened with a paragraph that summarised it,
 * drawn at exactly the weight, size and colour of the six paragraphs after
 * it, so the summary was invisible as one and the page read as an unbroken
 * column. `section > h2 + p` picks out the lead and nothing else, and it
 * outranks the `text-sm` on the call site, which is what lets this apply to
 * all twenty-three pages without editing five hundred paragraphs.
 */
const LEAD_PARAGRAPH = "[&>h2+p]:text-[15px] [&>h2+p]:text-foreground/80";

interface DocsSectionProps {
  id: string;
  title: string;
  children: React.ReactNode;
  className?: string;
}

export function DocsSection({
  id,
  title,
  children,
  className,
}: DocsSectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className={cn(
        "scroll-mt-24 space-y-4 sm:space-y-6",
        // The 68ch measure lives here rather than on each page's paragraphs,
        // where eight of the twenty docs pages had forgotten it and ran prose
        // at ~124 characters per line on a 1440px screen. Scoped to direct
        // child <p> so tables, code blocks and grids still use the full column.
        PROSE_MEASURE,
        LEAD_PARAGRAPH,
        className,
      )}
    >
      {/* text-xl/2xl, not text-lg/xl. The page had four type sizes inside
          6px of each other (h1 24, h2 20, h3 16, body 14), which is not a
          hierarchy you can skim on a 700-line reference page: you had to read
          a heading to know it was one. With the h1 on the documented Tier A
          (30/36) the ladder is now 36 / 24 / 16 / 14. */}
      <h2
        id={`${id}-heading`}
        className="group flex items-center gap-2 border-b border-border/50 pb-2.5 text-xl sm:text-2xl font-semibold tracking-tight text-foreground"
      >
        <span>{title}</span>
        <AnchorLink id={id} label={title} />
      </h2>
      {children}
    </section>
  );
}

interface DocsSubSectionProps {
  /** Set this when the page's table of contents links to the subsection. */
  id?: string;
  title: string;
  children: React.ReactNode;
  className?: string;
}

export function DocsSubSection({
  id,
  title,
  children,
  className,
}: DocsSubSectionProps) {
  return (
    <div
      id={id}
      className={cn("scroll-mt-24 space-y-3", PROSE_MEASURE, className)}
    >
      {/* The tick is the only thing at this level that carries the brand
          colour, and it is what makes an h3 findable when four of them run
          down a page under one h2 (thirty-five of them on /docs/config). It
          is drawn in flow rather than pulled into the margin, so it cannot
          clip against the 16px gutter at 375px; the tick keeps the block's
          left edge and the title sits 12px in, which reads as one level of
          nesting on its own. */}
      <h3 className="group flex items-center gap-2.5 text-base font-semibold tracking-tight text-foreground">
        <span
          aria-hidden="true"
          className="h-4 w-0.5 shrink-0 rounded-full bg-primary/70"
        />
        <span>{title}</span>
        {id && <AnchorLink id={id} label={title} />}
      </h3>
      {children}
    </div>
  );
}
