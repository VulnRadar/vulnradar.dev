"use client"

import { 
  Users, 
  Activity, 
  Key, 
  CalendarClock, 
  Webhook, 
  ShieldCheck, 
  BarChart3, 
  UserX, 
  Share2,
  TrendingUp 
} from "lucide-react"
import { StatCard } from "./stat-card"
import type { AdminStats } from "../types"

interface StatsGridProps {
  stats: AdminStats | null
  loading?: boolean
}

const STAT_CONFIG = [
  { key: "total_users" as const, label: "Total Users", icon: Users, color: "text-primary", accent: "bg-primary" },
  { key: "new_users_7d" as const, label: "New Users (7d)", icon: TrendingUp, color: "text-emerald-500", accent: "bg-emerald-500" },
  { key: "total_scans" as const, label: "Total Scans", icon: Activity, color: "text-blue-500", accent: "bg-blue-500" },
  { key: "scans_24h" as const, label: "Scans (24h)", icon: BarChart3, color: "text-cyan-500", accent: "bg-cyan-500" },
  { key: "active_api_keys" as const, label: "Active API Keys", icon: Key, color: "text-amber-500", accent: "bg-amber-500" },
  { key: "active_schedules" as const, label: "Active Schedules", icon: CalendarClock, color: "text-violet-500", accent: "bg-violet-500" },
  { key: "active_webhooks" as const, label: "Active Webhooks", icon: Webhook, color: "text-pink-500", accent: "bg-pink-500" },
  { key: "users_with_2fa" as const, label: "Users with 2FA", icon: ShieldCheck, color: "text-emerald-500", accent: "bg-emerald-500" },
  { key: "shared_scans" as const, label: "Shared Scans", icon: Share2, color: "text-indigo-500", accent: "bg-indigo-500" },
  { key: "disabled_users" as const, label: "Disabled Users", icon: UserX, color: "text-destructive", accent: "bg-destructive" },
]

export function StatsGrid({ stats, loading }: StatsGridProps) {
  if (loading || !stats) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Platform Overview</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-[100px] rounded-xl border border-border/50 bg-card/50 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Platform Overview</h2>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {STAT_CONFIG.map(({ key, label, icon, color, accent }) => (
          <StatCard
            key={key}
            label={label}
            value={stats[key]}
            icon={icon}
            color={color}
            accent={accent}
          />
        ))}
      </div>
    </div>
  )
}
