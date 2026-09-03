import { cn } from "@/lib/ui/utils";

interface LegalSectionProps {
  /** Anchor id. Every clause needs one so it can be linked and quoted directly. */
  id: string;
  title: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Splits a leading clause number off a section title.
 *
 * Every LegalSection on all six pages is titled "7. Data Retention", and the
 * number was rendered as the first two characters of the heading in the same
 * weight and colour as the words after it. That is the one piece of a legal
 * page people navigate by ("see section 7") and it had no more presence than
 * the "of" in the sentence below it.
 *
 * Parsed here rather than passed as a prop so all six pages keep their
 * existing call sites, and so a section written without a number (or a page
 * that renumbers) still renders correctly: no match means no marker.
 */
function splitClauseNumber(title: string): {
  number: string | null;
  label: string;
} {
  const match = /^(\d{1,2})\.\s+(.*\S)$/.exec(title);
  if (!match) return { number: null, label: title };
  return { number: match[1], label: match[2] };
}

/**
 * One numbered clause. The heading carries the anchor so a section can be
 * quoted by URL (#data-retention) rather than "scroll down to the part
 * about retention". Content is capped at a real reading measure: 65ch is
 * Tailwind's built-in `max-w-prose`, the width this whole redesign uses for
 * legal prose.
 */
export function LegalSection({
  id,
  title,
  children,
  className,
}: LegalSectionProps) {
  const { number, label } = splitClauseNumber(title);

  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className={cn("scroll-mt-24", className)}
    >
      <h2
        id={`${id}-heading`}
        className="group mb-3 flex items-baseline gap-3 border-b border-border/50 pb-2.5 text-lg sm:text-xl font-semibold tracking-tight text-foreground"
      >
        {number ? (
          // A fixed-width tabular gutter, so fifteen clause numbers line up
          // into a rail you can run an eye down instead of fifteen headings
          // that each start at a different x. Tabular figures matter at two
          // digits: "9" and "15" would otherwise sit at different offsets.
          //
          // The number is also the permalink, which replaces the hover-only
          // "#" that used to sit after the title. Someone quoting a legal
          // page says "clause 7", so the number is what they reach for; a
          // permalink that only appears on hover is not reachable on a phone
          // at all, and it was the only way to get the URL of a clause.
          <a
            href={`#${id}`}
            aria-label={`Link to clause ${number}, ${label}`}
            className="w-6 shrink-0 rounded-sm font-mono text-sm tabular-nums text-primary underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            {number}
          </a>
        ) : (
          <a
            href={`#${id}`}
            aria-label={`Link to section: ${title}`}
            className={cn(
              "order-last text-muted-foreground opacity-0 transition-opacity",
              "group-hover:opacity-100 focus-visible:opacity-100",
              "hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
            )}
          >
            #
          </a>
        )}
        <span className="min-w-0">{label}</span>
      </h2>
      {/* Indented to the clause rail on anything wider than a phone, so the
          number reads as a marker for the block under it rather than as part
          of the first line. Flush at 375px, where 36px of the measure is
          worth more than the alignment. */}
      <div
        className={cn(
          "max-w-prose space-y-3 text-sm leading-relaxed text-muted-foreground",
          number && "sm:pl-9",
        )}
      >
        {children}
      </div>
    </section>
  );
}
