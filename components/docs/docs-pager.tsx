"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { docsPageContext } from "./docs-nav";

/**
 * "Docs / Rate Limits". Two levels is the whole hierarchy, so this is short
 * by design: its job is to say which of the nine pages you are on, above the
 * fold, without scrolling to find the heading.
 */
export function DocsBreadcrumb() {
  const pathname = usePathname();
  const { current } = docsPageContext(pathname);
  if (!current || current.href === "/docs") return null;

  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <li>
          <Link
            href="/docs"
            className="rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Docs
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li>
          <span className="text-foreground">{current.label}</span>
        </li>
      </ol>
    </nav>
  );
}

/**
 * Previous/next in reading order. Docs pages that nobody links to do not get
 * read, and the sidebar alone does not tell you what comes after this page.
 */
export function DocsPager() {
  const pathname = usePathname();
  const { previous, next } = docsPageContext(pathname);
  if (!previous && !next) return null;

  return (
    <nav
      aria-label="Documentation pages"
      className="mt-16 grid grid-cols-1 gap-3 border-t border-border/50 pt-8 sm:grid-cols-2"
    >
      {previous ? (
        <Link
          href={previous.href}
          rel="prev"
          className="group flex flex-col gap-1 rounded-lg border border-border/50 p-4 transition-colors hover:border-primary/30 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <ChevronLeft className="h-3 w-3" aria-hidden="true" />
            Previous
          </span>
          <span className="text-sm font-medium text-foreground group-hover:text-primary">
            {previous.label}
          </span>
        </Link>
      ) : (
        <span aria-hidden="true" className="hidden sm:block" />
      )}

      {next && (
        <Link
          href={next.href}
          rel="next"
          className="group flex flex-col gap-1 rounded-lg border border-border/50 p-4 text-right transition-colors hover:border-primary/30 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:col-start-2"
        >
          <span className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
            Next
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
          </span>
          <span className="text-sm font-medium text-foreground group-hover:text-primary">
            {next.label}
          </span>
        </Link>
      )}
    </nav>
  );
}
