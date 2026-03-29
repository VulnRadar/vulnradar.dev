import { cn } from "@/lib/ui/utils"

interface StatCardProps {
  label: string
  value: string
  icon: React.ElementType
  color: string
  accent: string
}

/**
 * Dashboard stat card component - follows VulnRadar design system
 */
export function StatCard({ label, value, icon: Icon, color, accent }: StatCardProps) {
  return (
    <div className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-card/30 hover:bg-card/50 hover:border-border/60 transition-colors">
      <div className={cn("p-2.5 rounded-lg shrink-0", accent)}>
        <Icon className={cn("h-4 w-4", color)} />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold tracking-tight">
          {Number(value).toLocaleString()}
        </p>
        <p className="text-[11px] text-muted-foreground truncate">{label}</p>
      </div>
    </div>
  )
}
