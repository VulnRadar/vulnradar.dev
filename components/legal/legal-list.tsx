import { cn } from "@/lib/ui/utils";

interface LegalListProps {
  items: (string | React.ReactNode)[];
  className?: string;
}

export function LegalList({ items, className }: LegalListProps) {
  return (
    <ul className={cn("space-y-2.5 text-sm text-muted-foreground", className)}>
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          {/* A drawn dot rather than the "•" glyph. The character's own
              vertical centring differs by font and it was being nudged with
              mt-1.5, which lands differently again once an item wraps to two
              lines; a 4px circle offset from the line box sits on the first
              line every time. */}
          <span
            aria-hidden="true"
            className="mt-[0.5em] h-1 w-1 shrink-0 rounded-full bg-primary"
          />
          <span className="min-w-0 leading-relaxed">{item}</span>
        </li>
      ))}
    </ul>
  );
}
