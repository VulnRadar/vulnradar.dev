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
        "hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
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
      className={cn("scroll-mt-24 space-y-4 sm:space-y-6", className)}
    >
      <h2
        id={`${id}-heading`}
        className="group flex items-center gap-2 border-b border-border/50 pb-2 text-lg sm:text-xl font-semibold tracking-tight text-foreground"
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
    <div id={id} className={cn("scroll-mt-24 space-y-3", className)}>
      <h3 className="group text-base font-medium tracking-tight text-foreground">
        <span>{title}</span>
        {id && <AnchorLink id={id} label={title} />}
      </h3>
      {children}
    </div>
  );
}
