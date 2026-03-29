import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/ui/utils"
import { ACTION_META } from "../config"
import { getActionFallbackLabel } from "../utils"

interface ActionBadgeProps {
  action: string
}

/**
 * Audit log action badge with human-readable labels
 */
export function ActionBadge({ action }: ActionBadgeProps) {
  const meta = ACTION_META[action]
  const label = meta?.label || getActionFallbackLabel(action)
  const cls = meta?.cls || "bg-muted text-muted-foreground border-border"
  
  return (
    <Badge className={cn("text-[10px] px-2 py-0.5 font-medium", cls)}>
      {label}
    </Badge>
  )
}
