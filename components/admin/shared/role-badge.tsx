"use client"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { ROLE_BADGE_STYLES, STAFF_ROLE_LABELS } from "@/lib/constants"

interface RoleBadgeProps {
  role: string | null
  size?: "sm" | "md"
  className?: string
}

export function RoleBadge({ role, size = "sm", className }: RoleBadgeProps) {
  if (!role || role === "user") return null
  
  const style = ROLE_BADGE_STYLES[role] || ROLE_BADGE_STYLES.user
  const label = STAFF_ROLE_LABELS[role as keyof typeof STAFF_ROLE_LABELS] || role
  
  return (
    <Badge className={cn(
      style,
      size === "sm" ? "text-[10px] px-2 py-0.5" : "text-xs px-2.5 py-0.5",
      "font-medium capitalize",
      className
    )}>
      {label}
    </Badge>
  )
}
