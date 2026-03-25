"use client"

import { 
  Users, 
  Activity, 
  Key, 
  CalendarClock, 
  Webhook, 
  ShieldCheck, 
  BarChart3,
  Globe,
  Ban
} from "lucide-react"
import { StatCard } from "./stat-card"
import type { AdminStats } from "../types"

interface StatsGridProps {
  stats: AdminStats
}

export function StatsGrid({ stats }: StatsGridProps) {
  const statItems = [
    { label: "Total Users", value: stats.total_users, icon: Users, color: "text-primary", accent: "bg-primary" },
    { label: "Total Scans", value: stats.total_scans, icon: Activity, color: "text-primary", accent: "bg-primary" },
    { label: "Scans (24h)", value: stats.scans_24h, icon: BarChart3, color: "text-primary", accent: "bg-primary" },
    { label: "New Users (7d)", value: stats.new_users_7d, icon: Users, color: "text-primary", accent: "bg-primary" },
    { label: "Shared Scans", value: stats.shared_scans, icon: Globe, color: "text-primary", accent: "bg-primary/70" },
    { label: "API Keys", value: stats.active_api_keys, icon: Key, color: "text-[hsl(var(--severity-medium))]", accent: "bg-[hsl(var(--severity-medium))]" },
    { label: "Schedules", value: stats.active_schedules, icon: CalendarClock, color: "text-[hsl(var(--severity-low))]", accent: "bg-[hsl(var(--severity-low))]" },
    { label: "Webhooks", value: stats.active_webhooks, icon: Webhook, color: "text-muted-foreground", accent: "bg-muted-foreground/50" },
    { label: "2FA Users", value: stats.users_with_2fa, icon: ShieldCheck, color: "text-primary", accent: "bg-primary/50" },
    { label: "Disabled", value: stats.disabled_users, icon: Ban, color: "text-destructive", accent: "bg-destructive" },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      {statItems.map((item) => (
        <StatCard key={item.label} {...item} />
      ))}
    </div>
  )
}
