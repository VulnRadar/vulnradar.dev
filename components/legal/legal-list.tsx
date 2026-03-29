import { cn } from "@/lib/ui/utils"

interface LegalListProps {
  items: (string | React.ReactNode)[]
  className?: string
}

export function LegalList({ items, className }: LegalListProps) {
  return (
    <ul className={cn("space-y-2 text-sm text-muted-foreground", className)}>
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-primary mt-1.5 shrink-0">•</span>
          <span className="leading-relaxed">{item}</span>
        </li>
      ))}
    </ul>
  )
}
