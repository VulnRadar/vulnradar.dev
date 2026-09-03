import { cn } from "@/lib/ui/utils";
import { focus } from "@/lib/ui/animations";
import { CATEGORIES, type ContactCategory } from "./contact-types";

/**
 * The category that gets its own row rather than a cell in the grid: it is the
 * only one that opens a tracked, two-way thread instead of sending a message
 * into an inbox, and it is the one most people who arrive here actually want.
 * Looked up by id rather than taken off the front of CATEGORIES so reordering
 * that list cannot silently promote something else.
 */
const LEAD_CATEGORY_ID = "ticket";

interface ContactCategorySelectorProps {
  selected: string | null;
  onSelect: (id: string) => void;
}

/**
 * A radio group, so it is drawn as one.
 *
 * This shipped as nine identical bordered cards in a 2x4 grid, every one the
 * same weight, which made the single most important choice on the page look
 * like a wall of tiles and made the visual centre of /contact the clearest
 * repeated-card violation in the app. It is one panel now, with hairline
 * dividers instead of nine borders, the tracked-ticket option carrying more
 * weight than the eight fire-and-forget ones, and the `icon` that
 * contact-types.ts has always declared and no one has ever rendered finally
 * doing a job.
 *
 * Behaviour is unchanged: same role="radio" per option, same aria-checked,
 * same tab order, same 44px minimum target.
 */
export function ContactCategorySelector({
  selected,
  onSelect,
}: ContactCategorySelectorProps) {
  const lead = CATEGORIES.find((c) => c.id === LEAD_CATEGORY_ID);
  const rest = CATEGORIES.filter((c) => c.id !== LEAD_CATEGORY_ID);

  return (
    <section>
      <h2 className="text-base font-semibold tracking-tight text-foreground mb-1">
        What is this about?
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        Pick one and the form adjusts to it.
      </p>

      <div
        role="radiogroup"
        aria-label="Message category"
        className="rounded-xl border border-border bg-card overflow-hidden"
      >
        {lead && (
          <CategoryOption
            category={lead}
            selected={selected === lead.id}
            onSelect={onSelect}
            emphasis
          />
        )}
        {/* border-t on every cell and border-l on the second column draws the
            grid's rules without a wrapper per cell. `gap-px` over a tinted
            background would have been shorter and leaves a solid block where
            an odd-numbered last item does not fill its row. */}
        <div className="grid grid-cols-2">
          {rest.map((cat) => (
            <CategoryOption
              key={cat.id}
              category={cat}
              selected={selected === cat.id}
              onSelect={onSelect}
              className="border-t border-border even:border-l"
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function CategoryOption({
  category,
  selected,
  onSelect,
  emphasis,
  className,
}: {
  category: ContactCategory;
  selected: boolean;
  onSelect: (id: string) => void;
  /** The lead row: description always visible, heavier label. */
  emphasis?: boolean;
  className?: string;
}) {
  const Icon = category.icon;

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onSelect(category.id)}
      className={cn(
        // min-h-11 rather than padding alone: the compact cells hide their
        // description on mobile, and without a floor a label-only row lands
        // under the 44px target.
        "flex w-full items-start gap-2.5 text-left transition-colors min-h-11 focus-visible:ring-inset",
        emphasis ? "p-4" : "px-4 py-3",
        focus.ring,
        selected ? "bg-primary/10" : "hover:bg-muted/50",
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "shrink-0 mt-0.5",
          emphasis ? "h-5 w-5" : "h-4 w-4",
          selected ? "text-primary" : "text-muted-foreground/70",
        )}
      />
      <span className="min-w-0">
        <span
          className={cn(
            "block",
            emphasis ? "text-sm font-semibold" : "text-sm font-medium",
            selected ? "text-primary" : "text-foreground",
          )}
        >
          {category.label}
        </span>
        <span
          className={cn(
            "block text-xs text-muted-foreground leading-snug",
            emphasis ? "mt-0.5" : "mt-0.5 hidden sm:block",
          )}
        >
          {category.desc}
        </span>
      </span>
    </button>
  );
}
