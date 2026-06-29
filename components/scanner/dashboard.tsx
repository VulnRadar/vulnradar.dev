/**
 * Dashboard idle state.
 *
 * Power-user tool. Activity snapshot up top, then a 2x2 grid of severity,
 * recent activity, top recurring issues, and recent scans. No section
 * eyebrows, no marketing-style hero — this is a working surface.
 */
"use client";

import { useState, useEffect } from "react";
import {
  Layers,
  Shield,
  Clock,
  Globe,
  AlertTriangle,
  Terminal,
  Monitor,
  ArrowUpRight,
  Activity,
  Target,
  ChevronRight,
  ScanSearch,
  ArrowRight,
  TrendingUp,
  TrendingDown,
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

function StatCard({
  value,
  label,
  icon: Icon,
  color = "text-primary",
}: {
  value: string | number;
  label: string;
  icon: React.ElementType;
  color?: string;
}) {
  const bgColorMap: Record<string, string> = {
    "text-primary": "bg-primary/10",
    "text-cyan-500": "bg-cyan-500/10",
    "text-violet-500": "bg-violet-500/10",
    "text-amber-500": "bg-amber-500/10",
    "text-emerald-500": "bg-emerald-500/10",
  };
  const ringColorMap: Record<string, string> = {
    "text-primary": "ring-primary/20",
    "text-cyan-500": "ring-cyan-500/20",
    "text-violet-500": "ring-violet-500/20",
    "text-amber-500": "ring-amber-500/20",
    "text-emerald-500": "ring-emerald-500/20",
  };
  const bgColor = bgColorMap[color] || "bg-primary/10";
  const ringColor = ringColorMap[color] || "ring-primary/20";

  return (
    <div className="group relative flex items-center gap-3 p-3.5 sm:p-4 rounded-xl border border-border/50 bg-card/30 hover:bg-card/60 hover:border-border transition-all duration-200">
      <div
        className={cn(
          "p-2 sm:p-2.5 rounded-lg shrink-0 ring-1 transition-transform duration-200 group-hover:scale-105",
          bgColor,
          ringColor,
        )}
      >
        <Icon className={cn("h-4 w-4 sm:h-5 sm:w-5", color)} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xl sm:text-2xl font-bold tracking-tight tabular-nums leading-none">
          {value}
        </p>
        <p className="text-[11px] sm:text-xs text-muted-foreground truncate mt-1">
          {label}
        </p>
      </div>
    </div>
  );
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
    <div className="group flex items-center gap-3 py-1.5 px-2 -mx-2 rounded-md hover:bg-muted/30 transition-colors">
      <div className="flex items-center gap-1.5 w-16">
        <span className={cn("w-2 h-2 rounded-full shrink-0", color)} />
        <span className="text-xs text-muted-foreground capitalize">
          {label}
        </span>
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
      <span className="text-xs font-semibold text-foreground w-8 text-right tabular-nums">
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
              <div className="absolute -top-7 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 whitespace-nowrap bg-popover border border-border rounded-md px-2 py-1 shadow-xl">
                <p className="text-[10px] font-medium text-foreground">
                  {d.scans} scan{d.scans !== 1 ? "s" : ""}
                </p>
              </div>

              <div
                className={cn(
                  "w-full rounded-t-sm transition-all duration-300 cursor-pointer",
                  d.scans > 0
                    ? isToday
                      ? "bg-primary"
                      : "bg-primary/50 group-hover:bg-primary/70"
                    : "bg-muted/30",
                )}
                style={{
                  height: d.scans > 0 ? `${Math.max(height, 8)}%` : "4%",
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="flex justify-between text-[9px] text-muted-foreground px-0.5">
        <span>
          {new Date(data[0]?.day + "T12:00:00").toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </span>
        <span>
          {new Date(
            data[data.length - 1]?.day + "T12:00:00",
          ).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </span>
      </div>
    </div>
  );
}

function CardShell({
  title,
  subtitle,
  icon: Icon,
  iconClass,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: React.ElementType;
  iconClass: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="p-4 sm:p-5 rounded-xl border border-border/50 bg-card/30 hover:border-border transition-colors flex flex-col">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={cn("p-1.5 rounded-md ring-1 shrink-0", iconClass)}>
            <Icon className="h-3.5 w-3.5" />
          </div>
          <div className="flex flex-col min-w-0">
            <h3 className="text-sm font-semibold text-foreground truncate">
              {title}
            </h3>
            {subtitle && (
              <span className="text-[10px] text-muted-foreground truncate">
                {subtitle}
              </span>
            )}
          </div>
        </div>
        {action}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </section>
  );
}

function TrendBadge({
  current,
  previous,
}: {
  current: number;
  previous: number;
}) {
  if (previous === 0) return null;
  const delta = current - previous;
  const pct = previous > 0 ? (delta / previous) * 100 : 0;
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
          if (r.status === 401 || r.status === 403) {
            window.location.href = "/login";
          }
          throw new Error("unauthorized");
        }
        return r.json();
      })
      .then((d) => {
        if (d && d.severityBreakdown) {
          setData(d);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col gap-5 pt-8 w-full">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-muted animate-pulse" />
            <div className="h-4 w-20 rounded bg-muted animate-pulse" />
            <div className="h-3 w-48 rounded bg-muted animate-pulse" />
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 p-4 rounded-xl border border-border/50 bg-card/30"
            >
              <div className="w-10 h-10 rounded-lg bg-muted animate-pulse shrink-0" />
              <div className="space-y-2 min-w-0 flex-1">
                <div className="h-6 w-14 rounded bg-muted animate-pulse" />
                <div className="h-3 w-20 rounded bg-muted animate-pulse" />
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="p-5 rounded-xl border border-border/50 bg-card/30"
            >
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-7 h-7 rounded-md bg-muted animate-pulse" />
                <div className="space-y-1.5 flex-1">
                  <div className="h-3.5 w-32 rounded bg-muted animate-pulse" />
                  <div className="h-2.5 w-20 rounded bg-muted animate-pulse" />
                </div>
              </div>
              <div className="space-y-2">
                {[...Array(i === 1 ? 1 : 3)].map((_, j) => (
                  <div
                    key={j}
                    className={cn(
                      "rounded bg-muted animate-pulse",
                      i === 1 ? "h-20" : "h-3",
                    )}
                    style={{ width: i === 1 ? "100%" : `${90 - j * 10}%` }}
                  />
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

  const apiCount =
    data.sourceBreakdown.find((s) => s.source === "api")?.count || 0;
  const webCount =
    data.sourceBreakdown.find((s) => s.source === "web")?.count || 0;

  // Previous-week scan count for trend badge
  const midpoint = Math.floor(data.dailyActivity.length / 2);
  const recentWeek = data.dailyActivity
    .slice(midpoint)
    .reduce((sum, d) => sum + (Number(d.scans) || 0), 0);
  const priorWeek = data.dailyActivity
    .slice(0, midpoint)
    .reduce((sum, d) => sum + (Number(d.scans) || 0), 0);

  const highPlusCritical = sb.critical + sb.high;

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
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  const activity = data.dailyActivity.map((d) => ({
    ...d,
    scans: Number(d.scans) || 0,
    issues: Number(d.issues) || 0,
  }));

  return (
    <div className="flex flex-col gap-5 pt-8 w-full">
      {/* Activity section header */}
      <section aria-label="Activity overview" className="flex flex-col gap-1">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h2 className="text-base font-semibold text-foreground">
            Your activity
          </h2>
          <TrendBadge current={recentWeek} previous={priorWeek} />
        </div>
        <p className="text-xs text-muted-foreground">
          {data.totalScans} scan{data.totalScans !== 1 ? "s" : ""} across{" "}
          {data.uniqueSites} site{data.uniqueSites !== 1 ? "s" : ""} in the last
          14 days.
        </p>
      </section>

      {/* Stats row */}
      <section aria-label="Scan stats">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 min-w-0">
          <StatCard
            value={data.totalScans}
            label="Total scans"
            icon={Layers}
            color="text-primary"
          />
          <StatCard
            value={data.uniqueSites}
            label="Unique sites"
            icon={Globe}
            color="text-cyan-500"
          />
          <StatCard
            value={apiCount}
            label="API scans"
            icon={Terminal}
            color="text-violet-500"
          />
          <StatCard
            value={webCount}
            label="Web scans"
            icon={Monitor}
            color="text-amber-500"
          />
        </div>
      </section>

      {/* 2x2 grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
        {/* Severity breakdown */}
        <CardShell
          title="Severity breakdown"
          subtitle={`${totalIssues} issue${totalIssues !== 1 ? "s" : ""} across all scans`}
          icon={Shield}
          iconClass="bg-primary/10 ring-primary/20 text-primary"
        >
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
              color="bg-muted-foreground/50"
            />
          </div>
        </CardShell>

        {/* Scan Activity */}
        <CardShell
          title="Scan activity"
          subtitle="Last 14 days"
          icon={Activity}
          iconClass="bg-primary/10 ring-primary/20 text-primary"
        >
          <ActivityChart data={activity} />
        </CardShell>

        {/* Top Issues */}
        <CardShell
          title="Top recurring issues"
          subtitle={
            data.topVulnerabilities.length > 0
              ? `${data.topVulnerabilities.length} type${data.topVulnerabilities.length === 1 ? "" : "s"}`
              : undefined
          }
          icon={AlertTriangle}
          iconClass="bg-[hsl(var(--severity-high))]/10 ring-[hsl(var(--severity-high))]/20 text-[hsl(var(--severity-high))]"
        >
          {data.topVulnerabilities.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center mb-2">
                <Target className="h-4 w-4 text-muted-foreground/40" />
              </div>
              <p className="text-xs font-medium text-foreground">
                No issues yet
              </p>
              <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                Run a scan to surface findings.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {data.topVulnerabilities.map((v, i) => {
                const severityColors: Record<string, string> = {
                  critical: "bg-[hsl(var(--severity-critical))]",
                  high: "bg-[hsl(var(--severity-high))]",
                  medium: "bg-[hsl(var(--severity-medium))]",
                  low: "bg-[hsl(var(--severity-low))]",
                  info: "bg-muted-foreground/50",
                };
                return (
                  <div
                    key={i}
                    className="flex items-center gap-2 py-1.5 px-2 -mx-2 rounded-md hover:bg-muted/30 transition-colors group"
                  >
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0",
                        severityColors[v.severity] || "bg-muted-foreground",
                      )}
                    />
                    <span className="text-xs text-foreground truncate flex-1 min-w-0">
                      {v.title}
                    </span>
                    <span className="text-[10px] font-medium text-muted-foreground tabular-nums bg-muted/50 px-1.5 py-0.5 rounded shrink-0">
                      {v.count}x
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardShell>

        {/* Recent Scans */}
        <CardShell
          title="Recent scans"
          subtitle={
            data.recentScans.length > 0
              ? `${data.recentScans.length} of your latest`
              : undefined
          }
          icon={Clock}
          iconClass="bg-primary/10 ring-primary/20 text-primary"
          action={
            <a
              href={ROUTES.HISTORY}
              className="inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors px-2 py-1 rounded-md hover:bg-primary/10"
            >
              View all
              <ArrowUpRight className="h-3 w-3" />
            </a>
          }
        >
          {data.recentScans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center mb-2">
                <ScanSearch className="h-4 w-4 text-muted-foreground/40" />
              </div>
              <p className="text-xs font-medium text-foreground">
                No scans yet
              </p>
              <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                Enter a domain above to run your first scan.
              </p>
              <a
                href={ROUTES.DASHBOARD}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80 transition-colors mt-2.5"
              >
                Start scanning
                <ArrowRight className="h-3 w-3" />
              </a>
            </div>
          ) : (
            <div className="space-y-0.5">
              {data.recentScans.map((scan) => (
                <a
                  key={scan.id}
                  href={`${ROUTES.HISTORY}?scan=${scan.id}`}
                  className="flex items-center gap-2 py-2 px-2 -mx-2 rounded-md hover:bg-muted/30 transition-colors group"
                >
                  <div className="flex items-center justify-center w-7 h-7 rounded-md bg-muted/50 shrink-0">
                    {scan.source === "api" ? (
                      <Terminal className="h-3 w-3 text-violet-500" />
                    ) : (
                      <Globe className="h-3 w-3 text-cyan-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">
                      {getHostname(scan.url)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatRelativeTime(scan.scanned_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={cn(
                        "text-[10px] font-medium px-1.5 py-0.5 rounded tabular-nums",
                        scan.findings_count > 0
                          ? scan.findings_count >= highPlusCritical &&
                            highPlusCritical > 0
                            ? "text-[hsl(var(--severity-critical))] bg-[hsl(var(--severity-critical))]/10"
                            : "text-[hsl(var(--severity-high))] bg-[hsl(var(--severity-high))]/10"
                          : "text-emerald-500 bg-emerald-500/10",
                      )}
                    >
                      {scan.findings_count > 0
                        ? `${scan.findings_count}`
                        : "Clean"}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </a>
              ))}
            </div>
          )}
        </CardShell>
      </div>
    </div>
  );
}
