import { cn } from "@/lib/ui/utils";
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
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">
          What can we help you with?
        </h2>
        <p className="text-sm text-muted-foreground">
          Select a category that best matches your inquiry
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => onSelect(cat.id)}
            className={cn(
              "flex flex-col items-center gap-2 p-3 sm:p-4 rounded-xl border transition-all text-center",
              selected === cat.id
                ? "border-primary bg-primary/5"
                : "border-border/50 bg-card/50 hover:bg-card/80 hover:border-primary/30",
            )}
          >
            <div
              className={cn(
                "p-2 rounded-lg",
                selected === cat.id ? "bg-primary/10" : "bg-muted",
              )}
            >
              <cat.icon
                className={cn(
                  "h-4 w-4",
                  selected === cat.id
                    ? "text-primary"
                    : "text-muted-foreground",
                )}
              />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {cat.label}
              </p>
              <p className="text-xs text-muted-foreground hidden sm:block line-clamp-2">
                {cat.desc}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
