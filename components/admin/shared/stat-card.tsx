import { cn } from "@/lib/utils"

interface StatCardProps {
  label: string
  value: string
  icon: React.ElementType
  color: string
  accent: string
}

/**
 * Dashboard stat card component
 */
export function StatCard({ label, value, icon: Icon, color, accent }: StatCardProps) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-4 flex flex-col gap-2">
      <div className={cn("absolute top-0 left-0 w-full h-0.5", accent)} />
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <div className="h-8 w-8 rounded-lg flex items-center justify-center bg-muted/50">
          <Icon className={cn("h-4 w-4", color)} />
        </div>
      </div>
      <span className="text-2xl font-bold text-foreground tracking-tight">
        {Number(value).toLocaleString()}
      </span>
    </div>
  )
}
