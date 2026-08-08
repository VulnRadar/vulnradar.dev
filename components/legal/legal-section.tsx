import { cn } from "@/lib/ui/utils";

interface LegalSectionProps {
  /** Anchor id. Every clause needs one so it can be linked and quoted directly. */
  id: string;
  title: string;
  children: React.ReactNode;
  className?: string;
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
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className={cn("scroll-mt-24", className)}
    >
      <h2
        id={`${id}-heading`}
        className="group mb-3 flex items-baseline gap-2 border-b border-border/50 pb-2 text-lg font-semibold tracking-tight text-foreground"
      >
        <span>{title}</span>
        <a
          href={`#${id}`}
          aria-label={`Link to section: ${title}`}
          className={cn(
            "text-muted-foreground opacity-0 transition-opacity",
            "group-hover:opacity-100 focus-visible:opacity-100",
            "hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
          )}
        >
          #
        </a>
      </h2>
      <div className="max-w-prose space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}
