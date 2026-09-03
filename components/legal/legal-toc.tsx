export interface LegalTocItem {
  id: string;
  label: string;
}

/** Same split as components/legal/legal-section.tsx, on the same title strings. */
function splitClauseNumber(label: string): {
  number: string | null;
  rest: string;
} {
  const match = /^(\d{1,2})\.\s+(.*\S)$/.exec(label);
  if (!match) return { number: null, rest: label };
  return { number: match[1], rest: match[2] };
}

/**
 * A real table of contents for a page that is otherwise a wall of clauses.
 * Plain anchor links, no client-side scroll spy: legal pages are read once
 * and searched, not scrolled through with a highlighted position in mind,
 * so the extra state was not worth the code.
 *
 * The clause number is pulled into its own tabular column rather than left
 * inside the label. It is the thing being indexed, and with fifteen entries
 * across two columns the titles now start at one x instead of three.
 */
export function LegalToc({ items }: { items: LegalTocItem[] }) {
  if (items.length === 0) return null;

  return (
    <nav
      aria-label="On this page"
      className="mb-8 rounded-lg border border-border/50 bg-muted/30 p-4 sm:p-5"
    >
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        On this page
        <span className="ml-2 font-normal normal-case tracking-normal tabular-nums">
          {items.length} sections
        </span>
      </p>
      {/* The links used to be bare text with no vertical padding: a 20px
          tall tap target in a two-column grid, which is under half the 44px
          minimum and the worst offender in the legal and docs navigation.
          min-h-11 is 44px; the negative margin keeps the visual rhythm of
          the list the same while the target grows around it. */}
      <ol className="grid grid-cols-1 list-none gap-x-8 sm:grid-cols-2">
        {items.map((item) => {
          const { number, rest } = splitClauseNumber(item.label);
          return (
            <li key={item.id} className="min-w-0">
              <a
                href={`#${item.id}`}
                // Wrapping rather than truncating: "10. Your Rights Under
                // CCPA/CPRA (California Residents)" is the longest clause
                // title in the set and it was being cut off mid-word in the
                // one place whose whole job is telling you it exists.
                className="flex min-h-11 items-center gap-3 rounded-sm py-1.5 text-sm text-muted-foreground underline-offset-2 hover:text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                {number && (
                  <span className="w-5 shrink-0 font-mono text-xs tabular-nums">
                    {number}
                  </span>
                )}
                <span className="min-w-0 leading-snug">{rest}</span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
