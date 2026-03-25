"use client"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface PlanBadgeProps {
  plan: string
  subscriptionStatus?: string | null
  giftedPlan?: string | null
  size?: "sm" | "md"
  className?: string
}

const PLAN_STYLES: Record<string, string> = {
  free: "bg-muted text-muted-foreground border-border",
  pro: "bg-primary/10 text-primary border-primary/20",
  enterprise: "bg-amber-500/10 text-amber-500 border-amber-500/20",
}

export function PlanBadge({ plan, subscriptionStatus, giftedPlan, size = "sm", className }: PlanBadgeProps) {
  const displayPlan = giftedPlan || plan
  const isGifted = !!giftedPlan
  const isCanceled = subscriptionStatus === "canceled"
  
  const style = PLAN_STYLES[displayPlan.toLowerCase()] || PLAN_STYLES.free
  
  return (
    <Badge className={cn(
      style,
      size === "sm" ? "text-[10px] px-2 py-0.5" : "text-xs px-2.5 py-0.5",
      "font-medium capitalize",
      isCanceled && "opacity-60 line-through",
      className
    )}>
      {displayPlan}
      {isGifted && " (Gift)"}
    </Badge>
  )
}
