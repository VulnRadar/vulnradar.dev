"use client"

import { History, Shield, User, CreditCard, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

interface FilterCategory {
  id: string
  label: string
  icon: LucideIcon
}

const FILTER_CATEGORIES: FilterCategory[] = [
  { id: "all", label: "All Actions", icon: History },
  { id: "security", label: "Security", icon: Shield },
  { id: "user", label: "User Changes", icon: User },
  { id: "plan", label: "Plan Changes", icon: CreditCard },
  { id: "danger", label: "Destructive", icon: AlertTriangle },
]

interface AuditFiltersProps {
  activeFilter: string
  onFilterChange: (filter: string) => void
  className?: string
}

export function AuditFilters({ activeFilter, onFilterChange, className }: AuditFiltersProps) {
  return (
    <div className={cn("flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none", className)}>
      {FILTER_CATEGORIES.map(cat => {
        const isActive = activeFilter === cat.id
        const Icon = cat.icon
        return (
          <button
            key={cat.id}
            onClick={() => onFilterChange(cat.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all shrink-0",
              isActive 
                ? "bg-primary text-primary-foreground" 
                : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="h-3 w-3" />
            {cat.label}
          </button>
        )
      })}
    </div>
  )
}

// Filter logic helper
export function filterAuditLogs<T extends { action: string; admin_email?: string; admin_name?: string | null; target_email?: string | null; target_name?: string | null; details?: string | null }>(
  logs: T[],
  filter: string,
  search: string
): T[] {
  return logs.filter(log => {
    // Search filter
    if (search.trim()) {
      const searchLower = search.toLowerCase()
      const matchesSearch = 
        log.admin_email?.toLowerCase().includes(searchLower) ||
        log.admin_name?.toLowerCase().includes(searchLower) ||
        log.target_email?.toLowerCase().includes(searchLower) ||
        log.target_name?.toLowerCase().includes(searchLower) ||
        log.action?.toLowerCase().includes(searchLower) ||
        log.details?.toLowerCase().includes(searchLower)
      if (!matchesSearch) return false
    }
    
    // Category filter
    if (filter === "all") return true
    if (filter === "security") {
      return ["reset_password", "revoke_sessions", "revoke_api_keys", "reset_2fa", "force_logout_all", "reset_temp_password"].includes(log.action)
    }
    if (filter === "user") {
      return ["set_role", "make_admin", "remove_admin", "change_email", "award_badge", "revoke_badge"].includes(log.action)
    }
    if (filter === "plan") {
      return ["set_plan", "gift_plan", "remove_gift"].includes(log.action)
    }
    if (filter === "danger") {
      return ["delete_user", "disable_user", "delete_scan", "delete_scans", "revoke_sessions", "revoke_api_keys"].includes(log.action)
    }
    return true
  })
}
