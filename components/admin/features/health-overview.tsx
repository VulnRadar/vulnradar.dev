"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  RefreshCw,
  ServerCrash,
} from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { HealthListSkeleton } from "@/components/admin/shared";
import {
  buildHealthRows,
  formatGeneratedAt,
  type HealthMetrics,
  type HealthState,
} from "./health-overview-utils";

/**
 * Admin > Overview. AUDIT-014 qols-02: the panel used to land on the user
 * directory behind two rows of headcount counters, none of which can go red,
 * so nothing anywhere answered "is anything wrong right now". This is one
 * status list, worst first, of the signals that can actually indicate a
 * fault: scanner backlog, failed scans, backup age against the configured
 * interval, error volume, mail delivery, unresolved alerts, tickets waiting
 * on staff, staff invites that expired unaccepted, and an available update.
 *
 * A divided list rather than another card grid, per design-language.md D4:
 * these rows are one comparison down a single column (which of these is
 * red), which a list answers and a grid of tiles does not.
 */

const STATE_STYLES: Record<
  HealthState,
  { dot: string; label: string; icon: typeof CheckCircle2 }
> = {
  crit: {
    dot: "bg-destructive",
    label: "text-destructive",
    icon: AlertTriangle,
  },
  warn: {
    dot: "bg-[hsl(var(--warning))]",
    label: "text-[hsl(var(--warning))]",
    icon: AlertTriangle,
  },
  ok: {
    dot: "bg-[hsl(var(--success))]",
    label: "text-muted-foreground",
    icon: CheckCircle2,
  },
  unknown: {
    dot: "bg-muted-foreground/40",
    label: "text-muted-foreground",
    icon: HelpCircle,
  },
};

const STATE_WORD: Record<HealthState, string> = {
  crit: "Critical",
  warn: "Needs attention",
  ok: "Healthy",
  unknown: "Unknown",
};

export function HealthOverview({
  metrics,
  loading,
  refreshing,
  loadFailed,
  updateAvailable,
  onRefresh,
  onNavigate,
}: {
  metrics: HealthMetrics | null;
  loading: boolean;
  refreshing: boolean;
  loadFailed: boolean;
  updateAvailable: boolean;
  onRefresh: () => void;
  onNavigate: (tab: string) => void;
}) {
  const rows = buildHealthRows(metrics, { updateAvailable });
  const worst = rows.length > 0 ? rows[0].state : "ok";
  const problems = rows.filter(
    (r) => r.state === "crit" || r.state === "warn",
  ).length;
  const asOf = formatGeneratedAt(metrics?.generatedAt ?? null);

  return (
    <Card className="border-border/50 bg-card/50 overflow-hidden">
      <CardHeader className="pb-4 pt-5 px-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={cn(
                "p-2 rounded-lg shrink-0",
                worst === "crit"
                  ? "bg-destructive/10"
                  : worst === "warn"
                    ? "bg-[hsl(var(--warning))]/10"
                    : "bg-primary/10",
              )}
            >
              <Activity
                className={cn(
                  "h-4 w-4",
                  worst === "crit"
                    ? "text-destructive"
                    : worst === "warn"
                      ? "text-[hsl(var(--warning))]"
                      : "text-primary",
                )}
                aria-hidden="true"
              />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base font-semibold truncate">
                System Health
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {loading
                  ? "Checking..."
                  : problems === 0
                    ? "Nothing needs attention right now."
                    : `${problems} ${problems === 1 ? "check needs" : "checks need"} attention.`}
                {asOf && !loading ? ` Checked ${asOf}.` : ""}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-9 px-3 gap-2 border-border/40 shrink-0"
            onClick={onRefresh}
            disabled={loading || refreshing}
            aria-label="Refresh system health"
          >
            <RefreshCw
              className={cn("h-4 w-4", refreshing && "animate-spin")}
              aria-hidden="true"
            />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {loading && rows.length === 0 ? (
          // The same row shape the list below renders, not a stat strip: this
          // panel stopped being a row of counters when it became the health
          // list, and a strip here made the card change shape twice on load.
          <HealthListSkeleton rows={6} />
        ) : loadFailed && rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
            <ServerCrash
              className="h-6 w-6 text-destructive"
              aria-hidden="true"
            />
            <p className="text-sm font-medium">
              Couldn&apos;t read the health checks
            </p>
            <p className="max-w-xs text-xs text-muted-foreground">
              The request failed, so this screen cannot tell you whether
              anything is wrong. Retry, then check the error logs.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/50 border-t border-border/50">
            {rows.map((row) => {
              const style = STATE_STYLES[row.state];
              return (
                <li key={row.key}>
                  <a
                    href={`/admin?tab=${row.tab}`}
                    onClick={(e) => {
                      if (!e.ctrlKey && !e.metaKey) {
                        e.preventDefault();
                        onNavigate(row.tab);
                      }
                    }}
                    className="flex items-start gap-3 px-5 py-4 transition-colors hover:bg-muted/20 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <span
                      className={cn(
                        "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                        style.dot,
                      )}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-sm font-medium text-foreground">
                          {row.label}
                        </span>
                        <span
                          className={cn(
                            "font-mono text-xs tabular-nums",
                            style.label,
                          )}
                        >
                          {row.value}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {row.detail}
                      </p>
                    </div>
                    {/* The state word carries the meaning for anyone who
                        cannot use the dot's colour. */}
                    <span className="sr-only">{STATE_WORD[row.state]}</span>
                  </a>
                </li>
              );
            })}
            {rows.length === 0 && (
              <li className="px-5 py-10 text-center text-sm text-muted-foreground">
                Your role does not grant any of the health checks.
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
