"use client";

import { useState, useEffect } from "react";
import { AlertTriangle, ArrowUpRight, TrendingUp, TrendingDown } from "lucide-react";
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
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="flex items-center gap-1.5 w-14 shrink-0">
        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", color)} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="flex-1 h-1 rounded-full bg-muted/50 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-700 ease-out", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-medium text-foreground w-7 text-right tabular-nums font-mono shrink-0">
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
    <div className="space-y-1.5">
      <div className="flex items-end gap-px h-10">
        {data.map((d, i) => {
          const height = (d.scans / maxScans) * 100;
          const dayDate = new Date(d.day + "T12:00:00");
          const isToday = new Date().toDateString() === dayDate.toDateString();
          return (
            <div
              key={i}
              className="flex-1 flex flex-col items-center justify-end h-full group relative"
            >
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 whitespace-nowrap bg-popover border border-border rounded px-1.5 py-0.5 shadow-md">
                <p className="text-[10px] font-medium">{d.scans}</p>
              </div>
              <div
                className={cn(
                  "w-full rounded-t-sm transition-all duration-300",
                  d.scans > 0
                    ? isToday
                      ? "bg-primary"
                      : "bg-primary/40 group-hover:bg-primary/60"
                    : "bg-muted/20",
                )}
                style={{ height: d.scans > 0 ? `${Math.max(height, 10)}%` : "4%" }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground/60">
        <span>
          {new Date(data[0]?.day + "T12:00:00").toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </span>
        <span>
          {new Date(data[data.length - 1]?.day + "T12:00:00").toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
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
  const positive = delta < 0;
  const Icon = positive ? TrendingDown : TrendingUp;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums px-1.5 py-0.5 rounded",
        positive
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
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
      <div className="flex flex-col gap-6 pt-6 w-full">
        <div className="grid grid-cols-4 border border-border/40 rounded-lg bg-card/20 overflow-hidden divide-x divide-border/40">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex flex-col items-center px-4 py-2.5 gap-1.5">
              <div className="h-5 w-8 rounded bg-muted animate-pulse" />
              <div className="h-2.5 w-12 rounded bg-muted animate-pulse" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 lg:gap-5">
          <div className="lg:col-span-3">
            <div className="h-4 w-24 rounded bg-muted animate-pulse mb-3" />
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-2.5 border-b border-border/30">
                <div className="w-1.5 h-1.5 rounded-full bg-muted animate-pulse shrink-0" />
                <div className="h-3 flex-1 rounded bg-muted animate-pulse" />
                <div className="h-5 w-16 rounded bg-muted animate-pulse" />
                <div className="h-3 w-8 rounded bg-muted animate-pulse" />
              </div>
            ))}
          </div>
          <div className="lg:col-span-2">
            <div className="h-4 w-20 rounded bg-muted animate-pulse mb-3" />
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-1.5">
                <div className="w-14 h-3 rounded bg-muted animate-pulse shrink-0" />
                <div className="flex-1 h-1 rounded bg-muted animate-pulse" />
                <div className="w-6 h-3 rounded bg-muted animate-pulse shrink-0" />
              </div>
            ))}
          </div>
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

  const sevColors: Record<string, string> = {
    critical: "bg-[hsl(var(--severity-critical))]",
    high: "bg-[hsl(var(--severity-high))]",
    medium: "bg-[hsl(var(--severity-medium))]",
    low: "bg-[hsl(var(--severity-low))]",
    info: "bg-muted-foreground/50",
  };

  const stats = [
    { value: data.totalScans, label: "scans" },
    { value: data.uniqueSites, label: "sites" },
    { value: highPlusCritical, label: "critical + high", warn: true },
    { value: apiCount, label: "via api" },
  ];

  return (
    <div className="flex flex-col gap-6 pt-6 w-full">
      {/* Stats strip — numbers in a row, no icon cards */}
      <div className="grid grid-cols-4 border border-border/40 rounded-lg bg-card/20 overflow-hidden divide-x divide-border/40">
        {stats.map((stat, i) => (
          <div key={i} className="flex flex-col items-center px-3 py-2.5">
            <span
              className={cn(
                "text-xl font-bold tabular-nums font-mono leading-none",
                stat.warn && highPlusCritical > 0
                  ? "text-[hsl(var(--severity-high))]"
                  : "text-foreground",
              )}
            >
              {stat.value}
            </span>
            <span className="text-[10px] text-muted-foreground mt-1 whitespace-nowrap">
              {stat.label}
            </span>
          </div>
        ))}
      </div>

      {/* Main grid: 3/5 recent scans | 2/5 severity + recurring */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 lg:gap-6 items-start">
        {/* Recent scans — wider column */}
        <section className="lg:col-span-3" aria-label="Recent scans">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">Recent scans</h2>
            <a
              href={ROUTES.HISTORY}
              className="text-xs text-primary hover:text-primary/80 transition-colors inline-flex items-center gap-0.5"
            >
              All history <ArrowUpRight className="h-3 w-3" />
            </a>
          </div>

          {data.recentScans.length === 0 ? (
            <div className="py-10 border border-dashed border-border/40 rounded-lg flex flex-col items-center gap-1.5">
              <p className="text-sm text-muted-foreground">No scans yet.</p>
              <p className="text-xs text-muted-foreground/60">
                Enter a domain above to run your first scan.
              </p>
            </div>
          ) : (
            <div>
              {data.recentScans.map((scan, i) => {
                const hasIssues = scan.findings_count > 0;
                const isHighSeverity =
                  (scan.summary?.critical || 0) + (scan.summary?.high || 0) > 0;
                return (
                  <a
                    key={scan.id}
                    href={`${ROUTES.HISTORY}?scan=${scan.id}`}
                    className={cn(
                      "flex items-center gap-3 py-2.5 hover:bg-muted/20 -mx-2 px-2 rounded transition-colors group",
                      i < data.recentScans.length - 1 && "border-b border-border/30",
                    )}
                  >
                    {/* Source dot: violet = API, cyan = web */}
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0",
                        scan.source === "api" ? "bg-violet-500" : "bg-primary/60",
                      )}
                    />
                    {/* Hostname */}
                    <span className="font-mono text-xs text-foreground flex-1 truncate min-w-0">
                      {getHostname(scan.url)}
                    </span>
                    {/* Duration */}
                    <span className="text-[10px] text-muted-foreground/50 tabular-nums font-mono shrink-0 hidden sm:block">
                      {(scan.duration / 1000).toFixed(1)}s
                    </span>
                    {/* Findings badge */}
                    <span
                      className={cn(
                        "text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded shrink-0",
                        !hasIssues
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : isHighSeverity
                            ? "bg-[hsl(var(--severity-high))]/10 text-[hsl(var(--severity-high))]"
                            : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                      )}
                    >
                      {hasIssues
                        ? `${scan.findings_count} issue${scan.findings_count !== 1 ? "s" : ""}`
                        : "Clean"}
                    </span>
                    {/* Time */}
                    <span className="text-[10px] text-muted-foreground tabular-nums font-mono shrink-0 w-7 text-right">
                      {formatRelativeTime(scan.scanned_at)}
                    </span>
                  </a>
                );
              })}
            </div>
          )}
        </section>

        {/* Severity breakdown + recurring issues — narrower column */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <section aria-label="Severity breakdown">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-foreground">By severity</h2>
              <span className="text-[10px] text-muted-foreground font-mono">
                {totalIssues} total
              </span>
            </div>
            <div className="space-y-0.5">
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

          {data.topVulnerabilities.length > 0 && (
            <>
              <div className="border-t border-border/40" />
              <section aria-label="Recurring issues">
                <div className="flex items-center gap-1.5 mb-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-[hsl(var(--severity-high))] shrink-0" />
                  <h2 className="text-sm font-semibold text-foreground">Recurring</h2>
                </div>
                <div className="flex flex-col">
                  {data.topVulnerabilities.slice(0, 6).map((v, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 py-1.5 border-b border-border/20 last:border-0"
                    >
                      <span
                        className={cn(
                          "w-1.5 h-1.5 rounded-full shrink-0",
                          sevColors[v.severity] || "bg-muted-foreground",
                        )}
                      />
                      <span className="text-xs text-foreground truncate flex-1 min-w-0">
                        {v.title}
                      </span>
                      <span className="text-[10px] text-muted-foreground tabular-nums font-mono shrink-0">
                        {v.count}x
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      {/* Activity chart — full width, no card wrapper */}
      <div className="border-t border-border/30 pt-4">
        <div className="flex items-center gap-2 mb-3">
          <p className="text-[11px] text-muted-foreground">
            Scan activity · last 14 days
          </p>
          <TrendBadge current={recentWeek} previous={priorWeek} />
        </div>
        <ActivityChart data={activity} />
      </div>
    </div>
  );
}
