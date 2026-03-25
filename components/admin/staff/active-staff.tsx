"use client"

import { Shield, RefreshCw, Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { StaffCard } from "./staff-card"
import type { ActiveAdmin } from "../types"

interface ActiveStaffProps {
  staff: ActiveAdmin[]
  loading: boolean
  onRefresh: () => void
  onStaffSelect?: (staff: ActiveAdmin) => void
}

export function ActiveStaff({
  staff,
  loading,
  onRefresh,
  onStaffSelect,
}: ActiveStaffProps) {
  // Sort: online first, then by recent activity
  const sortedStaff = [...staff].sort((a, b) => {
    const aOnline = a.is_active && (a.seconds_since_heartbeat ?? 999) < 120
    const bOnline = b.is_active && (b.seconds_since_heartbeat ?? 999) < 120
    if (aOnline && !bOnline) return -1
    if (!aOnline && bOnline) return 1
    const aTime = a.last_admin_action ? new Date(a.last_admin_action).getTime() : 0
    const bTime = b.last_admin_action ? new Date(b.last_admin_action).getTime() : 0
    return bTime - aTime
  })

  const onlineCount = staff.filter(s => s.is_active && (s.seconds_since_heartbeat ?? 999) < 120).length

  return (
    <Card className="bg-card border-border overflow-hidden">
      <CardHeader className="pb-0 pt-5 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Shield className="h-5 w-5 text-muted-foreground" />
            Staff Members
            {onlineCount > 0 && (
              <span className="text-xs font-normal text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                {onlineCount} online
              </span>
            )}
          </CardTitle>
          <Button 
            variant="outline" 
            size="sm" 
            className="h-9 gap-1.5" 
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-5 pt-4">
        {sortedStaff.length === 0 ? (
          <div className="py-12 text-center">
            <div className="h-14 w-14 rounded-2xl bg-muted/30 flex items-center justify-center mx-auto mb-3">
              <Shield className="h-7 w-7 text-muted-foreground/40" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">No staff members</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Staff accounts will appear here
            </p>
          </div>
        ) : (
          <div className={cn(
            "grid gap-3 transition-opacity",
            loading && "opacity-50"
          )}>
            {sortedStaff.map((member) => (
              <StaffCard
                key={member.id}
                staff={member}
                onClick={() => onStaffSelect?.(member)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
