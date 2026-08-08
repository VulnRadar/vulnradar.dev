import { cn } from "@/lib/ui/utils";
import { focus } from "@/lib/ui/animations";
import { CATEGORIES } from "./contact-types";

interface ContactCategorySelectorProps {
  selected: string | null;
  onSelect: (id: string) => void;
}

export function ContactCategorySelector({
  selected,
  onSelect,
}: ContactCategorySelectorProps) {
  return (
    <div>
      <h2 className="text-sm font-medium text-foreground mb-1">
        What is this about?
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        Pick one and the form adjusts to it.
      </p>

      <div
        role="radiogroup"
        aria-label="Message category"
        className="grid grid-cols-2 sm:grid-cols-4 gap-2"
      >
        {CATEGORIES.map((cat) => {
          const isSelected = selected === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onSelect(cat.id)}
              className={cn(
                "flex flex-col gap-1 p-3 rounded-lg border text-left transition-colors",
                focus.ring,
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border/50 bg-card/50 hover:border-border hover:bg-card",
              )}
            >
              <span
                className={cn(
                  "text-sm font-medium",
                  isSelected ? "text-primary" : "text-foreground",
                )}
              >
                {cat.label}
              </span>
              <span className="text-xs text-muted-foreground leading-snug hidden sm:block">
                {cat.desc}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
