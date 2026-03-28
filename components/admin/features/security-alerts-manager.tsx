"use client"

import React, { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle, CheckCircle, RefreshCw } from "lucide-react"
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

const severityColors = {
  low: "bg-blue-500/10 text-blue-700 border-blue-500/20",
  medium: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20",
  high: "bg-orange-500/10 text-orange-700 border-orange-500/20",
  critical: "bg-red-500/10 text-red-700 border-red-500/20",
}

export function SecurityAlertsManager() {
  const [alerts, setAlerts] = useState<SecurityAlert[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedSeverity, setSelectedSeverity] = useState<string>("all")

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

  const handleResolveAlert = async (id: number, action: string) => {
    try {
      await fetch("/api/v2/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resolve",
          section: "security_alerts",
          id,
          action_taken: action,
        }),
      })
      await fetchAlerts()
    } catch (error) {
      console.error("Error resolving alert:", error)
    }
  }

  const unresolvedAlerts = alerts.filter((a) => !a.resolved_at)

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {Object.entries(severityColors).map(([severity, _]) => {
          const count = alerts.filter((a) => a.severity === severity && !a.resolved_at).length
          return (
            <Card key={severity} className="capitalize">
              <CardContent className="pt-6">
                <div className="text-3xl font-bold">{count}</div>
                <p className="text-sm text-muted-foreground mt-2">{severity} alerts</p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Alerts List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Security Alerts</CardTitle>
              <CardDescription>Monitor and respond to suspicious activity</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={fetchAlerts} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {unresolvedAlerts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No unresolved alerts</p>
            ) : (
              unresolvedAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className={cn(
                    "p-4 border rounded-lg",
                    severityColors[alert.severity]
                  )}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                      <h3 className="font-semibold">{alert.alert_type}</h3>
                      <Badge variant="outline" className="text-xs">
                        {alert.severity}
                      </Badge>
                    </div>
                    <p className="text-xs opacity-75">
                      {new Date(alert.created_at).toLocaleString()}
                    </p>
                  </div>
                  <p className="text-sm mb-2">{alert.description}</p>
                  {alert.ip_address && <p className="text-xs opacity-75">IP: {alert.ip_address}</p>}
                  <div className="flex gap-2 mt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleResolveAlert(alert.id, "manual_review")}
                    >
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Resolve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleResolveAlert(alert.id, "block_user")}
                      className="text-destructive"
                    >
                      Block User
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
