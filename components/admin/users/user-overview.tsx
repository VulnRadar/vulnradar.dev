"use client"

import { Activity, Key, Globe, Clock, ShieldCheck, ShieldOff, KeyRound, FileText } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AdminUser } from "../types"

interface UserOverviewProps {
  user: AdminUser & { session_count: number; has_backup_codes: boolean }
}

export function UserOverview({ user: u }: UserOverviewProps) {
  const stats = [
    { label: "Scans", value: u.scan_count.toLocaleString(), icon: Activity, color: "text-primary" },
    { label: "API Keys", value: u.api_key_count, icon: Key, color: "text-[hsl(var(--severity-medium))]" },
    { label: "Sessions", value: String(u.session_count), icon: Globe, color: "text-emerald-500" },
    { label: "Joined", value: new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), icon: Clock, color: "text-muted-foreground" },
  ]

  return (
    <div className="space-y-4">
      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-3">
        {stats.map((item) => (
          <div key={item.label} className="flex items-center gap-2.5 p-3 rounded-lg bg-muted/30 border border-border">
            <item.icon className={cn("h-4 w-4 shrink-0", item.color)} />
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground">{item.label}</p>
              <p className="text-sm font-semibold text-foreground truncate">{item.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Security badges */}
      <div className="pt-4 border-t border-border">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Security</p>
        <div className="flex flex-wrap gap-2">
          <div className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border",
            u.totp_enabled 
              ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-500" 
              : "bg-muted/50 border-border text-muted-foreground"
          )}>
            {u.totp_enabled ? <ShieldCheck className="h-3 w-3" /> : <ShieldOff className="h-3 w-3" />}
            {u.totp_enabled ? "2FA Enabled" : "No 2FA"}
          </div>
          {u.totp_enabled && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-muted/50 border border-border text-muted-foreground">
              <KeyRound className="h-3 w-3" />
              {u.has_backup_codes ? "Has backup codes" : "No backup codes"}
            </div>
          )}
          <div className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border",
            u.tos_accepted_at 
              ? "bg-muted/50 border-border text-muted-foreground" 
              : "bg-[hsl(var(--severity-medium))]/5 border-[hsl(var(--severity-medium))]/20 text-[hsl(var(--severity-medium))]"
          )}>
            <FileText className="h-3 w-3" />
            {u.tos_accepted_at ? "TOS Accepted" : "TOS Not Accepted"}
          </div>
        </div>
      </div>
    </div>
  )
}
