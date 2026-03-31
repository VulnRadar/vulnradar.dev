import { cn } from "@/lib/ui/utils"
import { CATEGORIES, CATEGORY_GROUPS, type ContactCategory } from "./contact-types"

interface ContactCategorySelectorProps {
  selected: string | null
  onSelect: (id: string) => void
}

function CategoryButton({ cat, selected, onSelect }: { cat: ContactCategory; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex items-center gap-3 p-3 rounded-xl border transition-all text-left w-full",
        selected
          ? "border-primary bg-primary/5"
          : "border-border/50 bg-card/50 hover:bg-card/80 hover:border-primary/30"
      )}
    >
      <div className={cn(
        "p-2 rounded-lg shrink-0",
        selected ? "bg-primary/10" : "bg-muted"
      )}>
        <cat.icon className={cn("h-4 w-4", selected ? "text-primary" : "text-muted-foreground")} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{cat.label}</p>
        <p className="text-xs text-muted-foreground truncate">{cat.desc}</p>
      </div>
    </button>
  )
}

export function ContactCategorySelector({ selected, onSelect }: ContactCategorySelectorProps) {
  const groupedCategories = Object.entries(CATEGORY_GROUPS).map(([groupId, group]) => ({
    ...group,
    id: groupId,
    categories: CATEGORIES.filter((c) => c.group === groupId),
  }))

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">What can we help you with?</h2>
        <p className="text-sm text-muted-foreground">Select a category that best matches your inquiry</p>
      </div>
      
      {groupedCategories.map((group) => (
        <div key={group.id}>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">{group.label}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {group.categories.map((cat) => (
              <CategoryButton
                key={cat.id}
                cat={cat}
                selected={selected === cat.id}
                onSelect={() => onSelect(cat.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
