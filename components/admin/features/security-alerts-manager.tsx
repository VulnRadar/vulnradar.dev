"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Ban,
  AlertCircle,
  Clock,
  ShieldAlert,
  X,
} from "lucide-react";
import { SaveConfirmationModal } from "@/components/shared/save-confirmation-modal";
import {
  StatBar,
  EmptyState,
  DataTableSkeleton,
} from "@/components/admin/shared";
import { cn } from "@/lib/ui/utils";

interface SecurityAlert {
  id: number;
  user_id: number;
  alert_type: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  ip_address?: string;
  user_agent?: string;
  resolved_at?: string;
  action_taken?: string;
  created_at: string;
}

const severityConfig = {
  low: {
    icon: AlertCircle,
    color: "text-[hsl(var(--severity-low))]",
    bgColor: "bg-[hsl(var(--severity-low))]/10",
    borderColor: "border-[hsl(var(--severity-low))]/20",
    badge:
      "bg-[hsl(var(--severity-low))]/10 text-[hsl(var(--severity-low))] border-[hsl(var(--severity-low))]/20",
  },
  medium: {
    icon: AlertTriangle,
    color: "text-[hsl(var(--severity-medium))]",
    bgColor: "bg-[hsl(var(--severity-medium))]/10",
    borderColor: "border-[hsl(var(--severity-medium))]/20",
    badge:
      "bg-[hsl(var(--severity-medium))]/10 text-[hsl(var(--severity-medium))] border-[hsl(var(--severity-medium))]/20",
  },
  high: {
    icon: AlertTriangle,
    color: "text-[hsl(var(--severity-high))]",
    bgColor: "bg-[hsl(var(--severity-high))]/10",
    borderColor: "border-[hsl(var(--severity-high))]/20",
    badge:
      "bg-[hsl(var(--severity-high))]/10 text-[hsl(var(--severity-high))] border-[hsl(var(--severity-high))]/20",
  },
  critical: {
    icon: AlertTriangle,
    color: "text-destructive",
    bgColor: "bg-destructive/10",
    borderColor: "border-destructive/20",
    badge: "bg-destructive/10 text-destructive border-destructive/20",
  },
};

export function SecurityAlertsManager() {
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedSeverity, setSelectedSeverity] = useState<string>("all");
  const [pendingResolve, setPendingResolve] = useState<{
    alert: SecurityAlert;
    action: string;
  } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/v3/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "list",
          section: "security_alerts",
          limit: 100,
          // Always fetch every severity; the severity filter is applied
          // client-side below. Filtering on the server made the per-severity
          // counters (computed from this list) show 0 for every severity except
          // the selected one -- so filtering to High hid that criticals exist.
        }),
      });
      if (!res.ok) {
        // A failed fetch must never render as "0 alerts" -- in a security
        // panel specifically, that reads as a false all-clear rather than
        // the load failure it actually is.
        setFetchError("Could not load security alerts.");
        return;
      }
      const data = await res.json();
      setAlerts(data.alerts || []);
    } catch (error) {
      console.error("Error fetching alerts:", error);
      setFetchError("Could not load security alerts.");
    } finally {
      setLoading(false);
    }
    // No selectedSeverity dep: the filter is client-side, so changing it must
    // not refetch (and re-narrow the counters).
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: setState only fires after the request resolves, not synchronously in this effect
    fetchAlerts();
  }, [fetchAlerts]);

  const handleResolveAlert = async () => {
    if (!pendingResolve) return;
    setResolving(true);
    setActionError(null);
    try {
      const res = await fetch("/api/v3/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resolve",
          section: "security_alerts",
          id: pendingResolve.alert.id,
          action_taken: pendingResolve.action,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to resolve alert.");
      }
      await fetchAlerts();
      setPendingResolve(null);
    } catch (error) {
      // Re-thrown so SaveConfirmationModal keeps the dialog open instead of
      // showing "Changes Saved" for an alert that was never resolved.
      console.error("Error resolving alert:", error);
      setActionError(
        error instanceof Error ? error.message : "Failed to resolve alert.",
      );
      throw error;
    } finally {
      setResolving(false);
    }
  };

  // List is filtered client-side by the selected severity; the counters below
  // are always computed from the full unfiltered set so they stay accurate no
  // matter which severity is selected.
  const unresolvedAlerts = alerts.filter(
    (a) =>
      !a.resolved_at &&
      (selectedSeverity === "all" || a.severity === selectedSeverity),
  );
  const severityStats = {
    critical: alerts.filter((a) => a.severity === "critical" && !a.resolved_at)
      .length,
    high: alerts.filter((a) => a.severity === "high" && !a.resolved_at).length,
    medium: alerts.filter((a) => a.severity === "medium" && !a.resolved_at)
      .length,
    low: alerts.filter((a) => a.severity === "low" && !a.resolved_at).length,
  };

  return (
    <>
      {actionError && (
        <div className="flex items-start gap-3 p-4 mb-4 rounded-xl border border-destructive/30 bg-destructive/10">
          <div className="p-2 rounded-lg bg-destructive/20 shrink-0">
            <AlertTriangle
              className="h-4 w-4 text-destructive"
              aria-hidden="true"
            />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-destructive">
              {actionError}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 shrink-0"
            onClick={() => setActionError(null)}
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      )}

      {/* Severity stats, doubling as the severity filter */}
      <StatBar
        className="mb-4"
        items={[
          {
            // Full unresolved count from the unfiltered set -- unresolvedAlerts
            // is narrowed by the active severity filter, so using it here made
            // "All Alerts" show only the selected severity's count.
            label: "All Alerts",
            value: alerts.filter((a) => !a.resolved_at).length,
            icon: ShieldAlert,
            tone: "primary",
            onClick: () => setSelectedSeverity("all"),
            active: selectedSeverity === "all",
          },
          {
            label: "Critical",
            value: severityStats.critical,
            icon: AlertTriangle,
            tone: "destructive",
            onClick: () => setSelectedSeverity("critical"),
            active: selectedSeverity === "critical",
          },
          {
            label: "High",
            value: severityStats.high,
            icon: AlertTriangle,
            tone: "severity-high",
            onClick: () => setSelectedSeverity("high"),
            active: selectedSeverity === "high",
          },
          {
            label: "Medium",
            value: severityStats.medium,
            icon: AlertTriangle,
            tone: "severity-medium",
            onClick: () => setSelectedSeverity("medium"),
            active: selectedSeverity === "medium",
          },
          {
            label: "Low",
            value: severityStats.low,
            icon: AlertCircle,
            tone: "severity-low",
            onClick: () => setSelectedSeverity("low"),
            active: selectedSeverity === "low",
          },
        ]}
      />

      {/* Alerts List Card */}
      <Card className="border-border/50 bg-card/50 overflow-hidden">
        <div className="border-b border-border/40 bg-muted/30 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                Security Alerts
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Monitor and respond to suspicious activity
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchAlerts}
              disabled={loading}
              aria-label="Refresh alerts"
              className="gap-2 border-border/40 shrink-0"
            >
              <RefreshCw
                className={cn("h-4 w-4", loading && "animate-spin")}
                aria-hidden="true"
              />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>

        {/* Alerts List */}
        <div className="divide-y divide-border/40">
          {loading && alerts.length === 0 ? (
            <div className="p-4 sm:p-5">
              <DataTableSkeleton rows={4} />
            </div>
          ) : fetchError ? (
            <EmptyState
              icon={AlertTriangle}
              title="Couldn't load alerts"
              description={fetchError}
            />
          ) : unresolvedAlerts.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="No Unresolved Alerts"
              description="All security alerts have been addressed"
            />
          ) : (
            unresolvedAlerts.map((alert) => {
              const config = severityConfig[alert.severity];
              const Icon = config.icon;
              return (
                <div
                  key={alert.id}
                  className="p-4 sm:p-5 hover:bg-muted/20 transition-colors group"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "p-2 rounded-lg shrink-0 mt-0.5",
                        config.bgColor,
                      )}
                    >
                      <Icon
                        className={cn("h-4 w-4", config.color)}
                        aria-hidden="true"
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-semibold text-sm text-foreground">
                          {alert.alert_type}
                        </h4>
                        <Badge
                          className={cn(
                            "text-[10px] px-2 py-0.5 font-medium capitalize",
                            config.badge,
                          )}
                        >
                          {alert.severity}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">
                        {alert.description}
                      </p>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mb-3">
                        {alert.ip_address && (
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground/70">
                              IP:
                            </span>
                            <span className="font-mono text-foreground">
                              {alert.ip_address}
                            </span>
                          </div>
                        )}
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" aria-hidden="true" />
                          {new Date(alert.created_at).toLocaleString()}
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setPendingResolve({
                              alert,
                              action: "manual_review",
                            })
                          }
                          className="h-8 gap-1.5 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:focus-visible:opacity-100 transition-opacity border-border/40"
                        >
                          <CheckCircle2
                            className="h-3 w-3"
                            aria-hidden="true"
                          />
                          <span className="hidden sm:inline">Resolve</span>
                          <span className="sm:hidden">OK</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setPendingResolve({ alert, action: "block_user" })
                          }
                          className="h-8 gap-1.5 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:focus-visible:opacity-100 transition-opacity text-destructive border-border/40"
                        >
                          <Ban className="h-3 w-3" aria-hidden="true" />
                          <span className="hidden sm:inline">Block</span>
                          <span className="sm:hidden">X</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>

      {/* Resolve Alert Confirmation Modal */}
      <SaveConfirmationModal
        isOpen={!!pendingResolve}
        onClose={() => setPendingResolve(null)}
        onConfirm={handleResolveAlert}
        title={
          pendingResolve?.action === "block_user"
            ? "Block User & Resolve Alert"
            : "Resolve Security Alert"
        }
        description={
          pendingResolve?.action === "block_user"
            ? "This will block the user and mark the alert as resolved."
            : "Mark this alert as resolved after manual review."
        }
        changes={
          pendingResolve
            ? [
                {
                  field: "alert_type",
                  label: "Alert Type",
                  oldValue: pendingResolve.alert.alert_type,
                  newValue: "Resolved",
                },
                {
                  field: "action",
                  label: "Action Taken",
                  oldValue: "Pending",
                  newValue:
                    pendingResolve.action === "block_user"
                      ? "User Blocked"
                      : "Manual Review",
                },
              ]
            : []
        }
        loading={resolving}
        confirmText={
          pendingResolve?.action === "block_user"
            ? "Block & Resolve"
            : "Mark Resolved"
        }
        variant={
          pendingResolve?.action === "block_user" ? "destructive" : "default"
        }
      />
    </>
  );
}
