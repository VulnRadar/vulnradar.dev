"use client";

import { Link as LinkIcon } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { DOCS_ANCHOR_OFFSET, DOCS_PROSE, slugifyHeading } from "./docs-prose";

/**
 * A permalink beside a heading. Docs get quoted in issues and chat, and a
 * section nobody can link to gets described from memory instead.
 *
 * Hidden until the heading is hovered or the link itself is focused, so it
 * stays reachable by keyboard without adding a hash to every heading. A touch
 * screen has no hover, so there it stays faintly visible.
 */
function AnchorLink({ id, label }: { id: string; label: string }) {
  return (
    <a
      href={`#${id}`}
      aria-label={`Link to ${label}`}
      className={cn(
        // h-6 w-6: the icon alone is 14px, under the 24px target minimum.
        "ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center align-middle text-muted-foreground opacity-0 transition-opacity [@media(hover:none)]:opacity-40",
        "group-hover:opacity-100 focus-visible:opacity-100",
        "hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
      )}
    >
      <LinkIcon className="h-3.5 w-3.5" aria-hidden="true" />
    </a>
  );
}

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
      className={cn(DOCS_ANCHOR_OFFSET, "space-y-4", DOCS_PROSE, className)}
    >
      {/* text-xl/2xl, not text-lg/xl. The page had four type sizes inside
          6px of each other (h1 24, h2 20, h3 16, body 14), which is not a
          hierarchy you can skim on a 700-line reference page: you had to read
          a heading to know it was one. With the h1 on the documented Tier A
          (30/36) the ladder is now 36 / 24 / 17 / 15. No rule under it: the
          spacing between sections already draws that line. */}
      <h2
        id={`${id}-heading`}
        className="group flex items-center gap-2 text-xl sm:text-2xl font-semibold tracking-tight text-foreground"
      >
        <span>{title}</span>
        <AnchorLink id={id} label={title} />
      </h2>
      {children}
    </section>
  );
}

interface DocsSubSectionProps {
  /** Defaults to a slug of the title, so every subsection can be linked to. */
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
  const anchor = id ?? slugifyHeading(title);

  return (
    <div
      id={anchor}
      className={cn(
        DOCS_ANCHOR_OFFSET,
        "space-y-3 pt-6 first:pt-0",
        DOCS_PROSE,
        className,
      )}
    >
      {/* The tick is the only thing at this level that carries the brand
          colour, and it is what makes an h3 findable when four of them run
          down a page under one h2 (thirty-five of them on /docs/config). It
          is drawn in flow rather than pulled into the margin, so it cannot
          clip against the 16px gutter at 375px; the tick keeps the block's
          left edge and the title sits 12px in, which reads as one level of
          nesting on its own. */}
      <h3 className="group flex items-center gap-2.5 text-base sm:text-[17px] font-semibold tracking-tight text-foreground">
        <span
          aria-hidden="true"
          className="h-4 w-0.5 shrink-0 rounded-full bg-primary/70"
        />
        <span>{title}</span>
        <AnchorLink id={anchor} label={title} />
      </h3>
      {children}
    </div>
  );
}
