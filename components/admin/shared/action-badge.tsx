"use client"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { ACTION_META } from "../constants"

interface ActionBadgeProps {
  action: string
}

export function ActionBadge({ action }: ActionBadgeProps) {
  // Fallback: convert snake_case to readable format
  const fallbackLabel = action.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
  const m = ACTION_META[action] || { label: fallbackLabel, cls: "bg-muted text-muted-foreground border-border" }
  return <Badge className={cn("text-[10px] px-2 py-0.5 font-medium", m.cls)}>{m.label}</Badge>
}
