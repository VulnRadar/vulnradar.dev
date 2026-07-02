"use client";

import { useState, useEffect } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  TrendingUp,
  TrendingDown,
  ScanSearch,
} from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { API, ROUTES } from "@/lib/config/constants";

interface DashboardData {
  totalScans: number;
  uniqueSites: number;
  recentScans: {
    id: number;
    url: string;
    summary: {
      critical?: number;
      high?: number;
      medium?: number;
      low?: number;
      info?: number;
      total?: number;
    };
    findings_count: number;
    duration: number;
    scanned_at: string;
    source?: string;
  }[];
  severityBreakdown: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  topVulnerabilities: { title: string; severity: string; count: number }[];
  dailyActivity: { day: string; scans: number; issues: number }[];
  sourceBreakdown: { source: string; count: number }[];
}

function SeverityBar({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="flex items-center gap-2 w-16 shrink-0">
        <span className={cn("w-2 h-2 rounded-full shrink-0", color)} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="flex-1 h-1.5 rounded-full bg-muted/50 overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-700 ease-out",
            color,
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] text-muted-foreground/60 tabular-nums w-7 text-right shrink-0">
        {pct}%
      </span>
      <span className="text-xs font-semibold text-foreground tabular-nums font-mono w-5 text-right shrink-0">
        {count}
      </span>
    </div>
  );
}

function ActivityChart({
  data,
}: {
  data: { day: string; scans: number; issues: number }[];
}) {
  const maxScans = Math.max(...data.map((d) => d.scans), 1);
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-0.5 h-20">
        {data.map((d, i) => {
          const height = (d.scans / maxScans) * 100;
          const dayDate = new Date(d.day + "T12:00:00");
          const isToday = new Date().toDateString() === dayDate.toDateString();
          return (
            <div
              key={i}
              className="flex-1 flex flex-col items-center justify-end h-full group relative"
            >
              <div className="absolute -top-7 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 whitespace-nowrap bg-popover border border-border rounded px-2 py-1 shadow-md">
                <p className="text-[10px] font-medium">
                  {d.scans} scan{d.scans !== 1 ? "s" : ""}
                </p>
              </div>
              <div
                className={cn(
                  "w-full rounded-t transition-all duration-300",
                  d.scans > 0
                    ? isToday
                      ? "bg-primary"
                      : "bg-primary/40 group-hover:bg-primary/60"
                    : "bg-muted/20",
                )}
                style={{ height: d.scans > 0 ? `${Math.max(height, 8)}%` : "4%" }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground/50">
        <span>
          {new Date(data[0]?.day + "T12:00:00").toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </span>
        <span>
          {new Date(data[data.length - 1]?.day + "T12:00:00").toLocaleDateString(
            "en-US",
            { month: "short", day: "numeric" },
          )}
        </span>
      </div>
    </div>
  );
}

function TrendBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return null;
  const delta = current - previous;
  const pct = (delta / previous) * 100;
  if (pct === 0) return null;
  const isUp = delta > 0;
  const Icon = isUp ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums px-1.5 py-0.5 rounded",
        isUp
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-muted/60 text-muted-foreground",
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(API.DASHBOARD)
      .then((r) => {
        if (!r.ok) {
          if (r.status === 401 || r.status === 403) window.location.href = "/login";
          throw new Error("unauthorized");
        }
        return r.json();
      })
      .then((d) => {
        if (d && d.severityBreakdown) setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col gap-8 pt-8 w-full">
        {/* Overview panel skeleton */}
        <div className="rounded-xl border border-border/50 bg-card/30 overflow-hidden">
          <div className="flex flex-col sm:flex-row">
            <div className="sm:w-[44%] shrink-0 grid grid-cols-2">
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "p-5",
                    i < 2 && "border-b border-border/40",
                    i % 2 === 0 && "border-r border-border/40",
                  )}
                >
                  <div className="h-9 w-14 rounded bg-muted animate-pulse mb-2" />
                  <div className="h-3 w-20 rounded bg-muted animate-pulse" />
                </div>
              ))}
            </div>
            <div className="flex-1 border-t sm:border-t-0 sm:border-l border-border/40 p-5">
              <div className="flex justify-between mb-4">
                <div className="h-4 w-24 rounded bg-muted animate-pulse" />
                <div className="h-4 w-16 rounded bg-muted animate-pulse" />
              </div>
              <div className="h-20 rounded-sm bg-muted/30 animate-pulse" />
              <div className="flex justify-between mt-2">
                <div className="h-3 w-12 rounded bg-muted animate-pulse" />
                <div className="h-3 w-12 rounded bg-muted animate-pulse" />
              </div>
            </div>
          </div>
        </div>
        {/* Recent scans skeleton */}
        <div>
          <div className="flex justify-between mb-4">
            <div className="h-4 w-28 rounded bg-muted animate-pulse" />
            <div className="h-4 w-16 rounded bg-muted animate-pulse" />
          </div>
          <div className="rounded-xl border border-border/50 bg-card/30 overflow-hidden">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-4 px-5 py-3.5",
                  i < 4 && "border-b border-border/40",
                )}
              >
                <div className="h-5 w-10 rounded bg-muted animate-pulse shrink-0" />
                <div className="h-4 flex-1 rounded bg-muted animate-pulse" />
                <div className="h-6 w-20 rounded bg-muted animate-pulse shrink-0" />
                <div className="h-4 w-8 rounded bg-muted animate-pulse shrink-0" />
              </div>
            ))}
          </div>
        </div>
        {/* Bottom grid skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="rounded-xl border border-border/50 bg-card/30 p-5">
              <div className="h-4 w-24 rounded bg-muted animate-pulse mb-4" />
              <div className="space-y-3">
                {[...Array(5)].map((_, j) => (
                  <div key={j} className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-muted animate-pulse shrink-0" />
                    <div className="flex-1 h-1.5 rounded bg-muted animate-pulse" />
                    <div className="w-6 h-3 rounded bg-muted animate-pulse shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const sb = {
    critical: Number(data.severityBreakdown.critical) || 0,
    high: Number(data.severityBreakdown.high) || 0,
    medium: Number(data.severityBreakdown.medium) || 0,
    low: Number(data.severityBreakdown.low) || 0,
    info: Number(data.severityBreakdown.info) || 0,
  };
  const totalIssues = sb.critical + sb.high + sb.medium + sb.low + sb.info;
  const highPlusCritical = sb.critical + sb.high;
  const apiCount = data.sourceBreakdown.find((s) => s.source === "api")?.count || 0;

  const midpoint = Math.floor(data.dailyActivity.length / 2);
  const recentWeek = data.dailyActivity
    .slice(midpoint)
    .reduce((sum, d) => sum + (Number(d.scans) || 0), 0);
  const priorWeek = data.dailyActivity
    .slice(0, midpoint)
    .reduce((sum, d) => sum + (Number(d.scans) || 0), 0);

  const activity = data.dailyActivity.map((d) => ({
    ...d,
    scans: Number(d.scans) || 0,
    issues: Number(d.issues) || 0,
  }));

  function getHostname(url: string) {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  function formatRelativeTime(d: string) {
    const diff = Date.now() - new Date(d).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  }

  const sevDotColors: Record<string, string> = {
    critical: "bg-[hsl(var(--severity-critical))]",
    high: "bg-[hsl(var(--severity-high))]",
    medium: "bg-[hsl(var(--severity-medium))]",
    low: "bg-[hsl(var(--severity-low))]",
    info: "bg-muted-foreground/40",
  };

  const statCells = [
    {
      value: data.totalScans,
      label: "total scans",
      color: "text-foreground",
    },
    {
      value: highPlusCritical,
      label: "critical + high",
      color:
        highPlusCritical > 0
          ? "text-[hsl(var(--severity-high))]"
          : "text-foreground",
    },
    {
      value: data.uniqueSites,
      label: "unique sites",
      color: "text-foreground",
    },
    {
      value: apiCount,
      label: "via API",
      color: "text-foreground",
    },
  ];

  return (
    <div className="flex flex-col gap-8 pt-8 w-full">
      {/* Overview: stats + activity chart */}
      <div className="rounded-xl border border-border/50 bg-card/30 overflow-hidden">
        <div className="flex flex-col sm:flex-row">
          {/* 2x2 stat grid */}
          <div className="sm:w-[44%] shrink-0 grid grid-cols-2">
            {statCells.map((cell, i) => (
              <div
                key={i}
                className={cn(
                  "p-5",
                  i < 2 && "border-b border-border/40",
                  i % 2 === 0 && "border-r border-border/40",
                )}
              >
                <p
                  className={cn(
                    "text-3xl font-bold tabular-nums leading-none",
                    cell.color,
                  )}
                >
                  {cell.value}
                </p>
                <p className="text-xs text-muted-foreground mt-2">{cell.label}</p>
              </div>
            ))}
          </div>

          {/* Activity chart */}
          <div className="flex-1 border-t sm:border-t-0 sm:border-l border-border/40 p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-semibold text-foreground">Scan activity</p>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">last 14 days</span>
                <TrendBadge current={recentWeek} previous={priorWeek} />
              </div>
            </div>
            <ActivityChart data={activity} />
          </div>
        </div>
      </div>

      {/* Recent scans */}
      <section aria-label="Recent scans">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground">Recent scans</h2>
          <a
            href={ROUTES.HISTORY}
            className="text-xs text-primary hover:text-primary/80 transition-colors inline-flex items-center gap-0.5"
          >
            View all <ArrowUpRight className="h-3 w-3" />
          </a>
        </div>

        {data.recentScans.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-card/30 py-14 flex flex-col items-center gap-2 text-center">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mb-1">
              <ScanSearch className="h-4 w-4 text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground">No scans yet</p>
            <p className="text-sm text-muted-foreground">
              Paste a URL above to run your first scan.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border/50 bg-card/30 overflow-hidden">
            {data.recentScans.map((scan, i) => {
              const criticalCount = scan.summary?.critical || 0;
              const highCount = scan.summary?.high || 0;
              const mediumCount = scan.summary?.medium || 0;
              const lowCount = scan.summary?.low || 0;
              const hasIssues = scan.findings_count > 0;

              const badgeClass = !hasIssues
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : criticalCount > 0
                  ? "bg-[hsl(var(--severity-critical))]/10 text-[hsl(var(--severity-critical))]"
                  : highCount > 0
                    ? "bg-[hsl(var(--severity-high))]/10 text-[hsl(var(--severity-high))]"
                    : mediumCount > 0
                      ? "bg-[hsl(var(--severity-medium))]/10 text-[hsl(var(--severity-medium))]"
                      : lowCount > 0
                        ? "bg-[hsl(var(--severity-low))]/10 text-[hsl(var(--severity-low))]"
                        : "bg-muted/60 text-muted-foreground";

              return (
                <a
                  key={scan.id}
                  href={`${ROUTES.HISTORY}?scan=${scan.id}`}
                  className={cn(
                    "flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3.5 hover:bg-muted/20 transition-colors group",
                    i < data.recentScans.length - 1 && "border-b border-border/40",
                  )}
                >
                  {/* Source pill */}
                  <span
                    className={cn(
                      "text-[10px] font-semibold tracking-wide shrink-0 px-1.5 py-0.5 rounded",
                      scan.source === "api"
                        ? "bg-violet-500/10 text-violet-500"
                        : "bg-primary/10 text-primary",
                    )}
                  >
                    {scan.source === "api" ? "API" : "WEB"}
                  </span>

                  {/* Hostname — dominant element */}
                  <span className="text-sm font-medium text-foreground flex-1 truncate min-w-0">
                    {getHostname(scan.url)}
                  </span>

                  {/* Duration */}
                  <span className="text-xs text-muted-foreground/50 tabular-nums shrink-0 hidden md:block">
                    {(scan.duration / 1000).toFixed(1)}s
                  </span>

                  {/* Findings badge */}
                  <span
                    className={cn(
                      "text-xs font-semibold tabular-nums px-2 py-1 rounded shrink-0",
                      badgeClass,
                    )}
                  >
                    {hasIssues
                      ? `${scan.findings_count} issue${scan.findings_count !== 1 ? "s" : ""}`
                      : "Clean"}
                  </span>

                  {/* Time */}
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-7 text-right">
                    {formatRelativeTime(scan.scanned_at)}
                  </span>
                </a>
              );
            })}
          </div>
        )}
      </section>

      {/* Severity breakdown + Recurring issues */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section
          aria-label="Severity breakdown"
          className="rounded-xl border border-border/50 bg-card/30 p-5"
        >
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-foreground">By severity</h2>
            <span className="text-xs text-muted-foreground tabular-nums font-mono">
              {totalIssues} total
            </span>
          </div>
          <div>
            <SeverityBar
              label="Critical"
              count={sb.critical}
              total={totalIssues}
              color="bg-[hsl(var(--severity-critical))]"
            />
            <SeverityBar
              label="High"
              count={sb.high}
              total={totalIssues}
              color="bg-[hsl(var(--severity-high))]"
            />
            <SeverityBar
              label="Medium"
              count={sb.medium}
              total={totalIssues}
              color="bg-[hsl(var(--severity-medium))]"
            />
            <SeverityBar
              label="Low"
              count={sb.low}
              total={totalIssues}
              color="bg-[hsl(var(--severity-low))]"
            />
            <SeverityBar
              label="Info"
              count={sb.info}
              total={totalIssues}
              color="bg-muted-foreground/40"
            />
          </div>
        </section>

        {data.topVulnerabilities.length > 0 ? (
          <section
            aria-label="Recurring issues"
            className="rounded-xl border border-border/50 bg-card/30 p-5"
          >
            <div className="flex items-center gap-1.5 mb-3">
              <AlertTriangle className="h-3.5 w-3.5 text-[hsl(var(--severity-high))] shrink-0" />
              <h2 className="text-sm font-semibold text-foreground">Recurring issues</h2>
            </div>
            <div>
              {data.topVulnerabilities.slice(0, 6).map((v, i, arr) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-center gap-3 py-2",
                    i < arr.length - 1 && "border-b border-border/30",
                  )}
                >
                  <span
                    className={cn(
                      "w-2 h-2 rounded-full shrink-0",
                      sevDotColors[v.severity] || "bg-muted-foreground",
                    )}
                  />
                  <span className="text-sm text-foreground truncate flex-1 min-w-0">
                    {v.title}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums font-mono shrink-0">
                    {v.count}x
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <section className="rounded-xl border border-border/50 bg-card/30 p-5 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">No recurring issues found.</p>
          </section>
        )}
      </div>
    </div>
  );
}
