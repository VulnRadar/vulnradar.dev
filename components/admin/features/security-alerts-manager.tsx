"use client"

import React, { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle, CheckCircle2, RefreshCw, Ban, AlertCircle, Clock } from "lucide-react"
import { SaveConfirmationModal, type ChangeItem } from "@/components/shared/save-confirmation-modal"
import { cn } from "@/lib/utils"

interface SecurityAlert {
  id: number
  user_id: number
  alert_type: string
  severity: "low" | "medium" | "high" | "critical"
  description: string
  ip_address?: string
  user_agent?: string
  resolved_at?: string
  action_taken?: string
  created_at: string
}

const severityConfig = {
  low: { icon: AlertCircle, color: "text-blue-500", bgColor: "bg-blue-500/10", borderColor: "border-blue-500/20", badge: "bg-blue-500/10 text-blue-700 border-blue-500/20" },
  medium: { icon: AlertTriangle, color: "text-yellow-500", bgColor: "bg-yellow-500/10", borderColor: "border-yellow-500/20", badge: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20" },
  high: { icon: AlertTriangle, color: "text-orange-500", bgColor: "bg-orange-500/10", borderColor: "border-orange-500/20", badge: "bg-orange-500/10 text-orange-700 border-orange-500/20" },
  critical: { icon: AlertTriangle, color: "text-destructive", bgColor: "bg-destructive/10", borderColor: "border-destructive/20", badge: "bg-destructive/10 text-destructive border-destructive/20" },
}

export function SecurityAlertsManager() {
  const [alerts, setAlerts] = useState<SecurityAlert[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedSeverity, setSelectedSeverity] = useState<string>("all")
  const [pendingResolve, setPendingResolve] = useState<{ alert: SecurityAlert; action: string } | null>(null)
  const [resolving, setResolving] = useState(false)

  const fetchAlerts = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/v2/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "list",
          section: "security_alerts",
          limit: 100,
          severity: selectedSeverity !== "all" ? selectedSeverity : undefined,
        }),
      })
      const data = await res.json()
      setAlerts(data.alerts || [])
    } catch (error) {
      console.error("Error fetching alerts:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAlerts()
  }, [selectedSeverity])

  const handleResolveAlert = async () => {
    if (!pendingResolve) return
    setResolving(true)
    try {
      await fetch("/api/v2/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resolve",
          section: "security_alerts",
          id: pendingResolve.alert.id,
          action_taken: pendingResolve.action,
        }),
      })
      await fetchAlerts()
    } catch (error) {
      console.error("Error resolving alert:", error)
    } finally {
      setResolving(false)
      setPendingResolve(null)
    }
  }

  const unresolvedAlerts = alerts.filter((a) => !a.resolved_at)
  const severityStats = {
    critical: alerts.filter((a) => a.severity === "critical" && !a.resolved_at).length,
    high: alerts.filter((a) => a.severity === "high" && !a.resolved_at).length,
    medium: alerts.filter((a) => a.severity === "medium" && !a.resolved_at).length,
    low: alerts.filter((a) => a.severity === "low" && !a.resolved_at).length,
  }

  return (
    <>
      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {(["critical", "high", "medium", "low"] as const).map((severity) => {
          const config = severityConfig[severity]
          const Icon = config.icon
          const count = severityStats[severity]
          return (
            <div key={severity} className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-card/30 hover:bg-card/50 hover:border-border/60 transition-colors">
              <div className={cn("p-2 rounded-lg", config.bgColor)}>
                <Icon className={cn("h-4 w-4", config.color)} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-2xl font-bold text-foreground">{count}</p>
                <p className="text-xs text-muted-foreground capitalize">{severity} Alerts</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Alerts List Card */}
      <Card className="border-border/50 bg-card/50 overflow-hidden">
        <div className="border-b border-border/40 bg-muted/30 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Security Alerts</h3>
              <p className="text-xs text-muted-foreground mt-1">Monitor and respond to suspicious activity</p>
            </div>
            <Button variant="outline" size="sm" onClick={fetchAlerts} disabled={loading} className="gap-2 border-border/40 shrink-0">
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>

        {/* Severity Filter */}
        <div className="border-b border-border/40 p-4 flex gap-2 flex-wrap">
          {(["all", "critical", "high", "medium", "low"] as const).map((severity) => (
            <Button
              key={severity}
              variant={selectedSeverity === severity ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedSeverity(severity)}
              className={cn("capitalize border-border/40", selectedSeverity === severity && "bg-primary text-primary-foreground")}
            >
              {severity}
            </Button>
          ))}
        </div>

        {/* Alerts List */}
        <div className="divide-y divide-border/40">
          {unresolvedAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <div className="p-3 rounded-lg bg-muted/50 mb-3">
                <CheckCircle2 className="h-8 w-8 text-muted-foreground/50" />
              </div>
              <p className="text-sm font-medium text-foreground">No Unresolved Alerts</p>
              <p className="text-xs text-muted-foreground mt-1">All security alerts have been addressed</p>
            </div>
          ) : (
            unresolvedAlerts.map((alert) => {
              const config = severityConfig[alert.severity]
              const Icon = config.icon
              return (
                <div key={alert.id} className="p-4 sm:p-5 hover:bg-muted/20 transition-colors group">
                  <div className="flex items-start gap-3">
                    <div className={cn("p-2 rounded-lg flex-shrink-0 mt-0.5", config.bgColor)}>
                      <Icon className={cn("h-4 w-4", config.color)} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-semibold text-sm text-foreground">{alert.alert_type}</h4>
                        <Badge className={cn("text-[10px] px-2 py-0.5 font-medium capitalize", config.badge)}>
                          {alert.severity}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">{alert.description}</p>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mb-3">
                        {alert.ip_address && (
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground/70">IP:</span>
                            <span className="font-mono text-foreground">{alert.ip_address}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(alert.created_at).toLocaleString()}
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setPendingResolve({ alert, action: "manual_review" })}
                          className="h-8 gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity border-border/40"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          <span className="hidden sm:inline">Resolve</span>
                          <span className="sm:hidden">OK</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setPendingResolve({ alert, action: "block_user" })}
                          className="h-8 gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity text-destructive border-border/40"
                        >
                          <Ban className="h-3 w-3" />
                          <span className="hidden sm:inline">Block</span>
                          <span className="sm:hidden">X</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </Card>

      {/* Resolve Alert Confirmation Modal */}
      <SaveConfirmationModal
        isOpen={!!pendingResolve}
        onClose={() => setPendingResolve(null)}
        onConfirm={handleResolveAlert}
        title={pendingResolve?.action === "block_user" ? "Block User & Resolve Alert" : "Resolve Security Alert"}
        description={
          pendingResolve?.action === "block_user"
            ? "This will block the user and mark the alert as resolved."
            : "Mark this alert as resolved after manual review."
        }
        changes={
          pendingResolve
            ? [
                { field: "alert_type", label: "Alert Type", oldValue: pendingResolve.alert.alert_type, newValue: "Resolved" },
                { field: "severity", label: "Severity", oldValue: pendingResolve.alert.severity, newValue: "—" },
                { field: "action", label: "Action Taken", oldValue: "Pending", newValue: pendingResolve.action === "block_user" ? "User Blocked" : "Manual Review" },
              ]
            : []
        }
        loading={resolving}
        confirmText={pendingResolve?.action === "block_user" ? "Block & Resolve" : "Mark Resolved"}
        variant={pendingResolve?.action === "block_user" ? "destructive" : "default"}
      />
    </>
  )
}
