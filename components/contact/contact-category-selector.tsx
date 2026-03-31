import { cn } from "@/lib/ui/utils"
import { CATEGORIES } from "./contact-types"

interface ContactCategorySelectorProps {
  selected: string | null
  onSelect: (id: string) => void
}

export function ContactCategorySelector({ selected, onSelect }: ContactCategorySelectorProps) {
  return (
    <div>
      <p className="text-sm font-medium text-foreground mb-3">What can we help you with?</p>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => onSelect(cat.id)}
            className={cn(
              "flex flex-col items-center gap-2 p-4 rounded-xl border transition-all text-center",
              selected === cat.id
                ? "border-primary bg-primary/5"
                : "border-border bg-card hover:bg-muted/50 hover:border-accent"
            )}
          >
            <cat.icon className={cn("h-5 w-5", selected === cat.id ? "text-primary" : "text-muted-foreground")} />
            <span className="text-xs font-medium text-foreground">{cat.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
