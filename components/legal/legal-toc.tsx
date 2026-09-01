export interface LegalTocItem {
  id: string;
  label: string;
}

/**
 * A real table of contents for a page that is otherwise a wall of clauses.
 * Plain anchor links, no client-side scroll spy: legal pages are read once
 * and searched, not scrolled through with a highlighted position in mind,
 * so the extra state was not worth the code.
 */
export function LegalToc({ items }: { items: LegalTocItem[] }) {
  if (items.length === 0) return null;

  return (
    <nav
      aria-label="On this page"
      className="mb-8 rounded-lg border border-border/50 bg-muted/30 p-4 sm:p-5"
    >
      <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        On this page
      </p>
      {/* The links used to be bare text with no vertical padding: a 20px
          tall tap target in a two-column grid, which is under half the 44px
          minimum and the worst offender in the legal and docs navigation.
          min-h-11 is 44px; the negative margin keeps the visual rhythm of
          the list the same while the target grows around it. */}
      <ol className="grid grid-cols-1 list-none gap-x-6 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.id} className="min-w-0">
            <a
              href={`#${item.id}`}
              className="flex min-h-11 items-center truncate rounded-sm text-sm text-muted-foreground underline-offset-2 hover:text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              {item.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
