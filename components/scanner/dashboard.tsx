"use client";

import { useState, useEffect } from "react";
import {
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ExternalLink,
  BarChart2,
  Globe,
  ShieldAlert,
  Terminal,
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

function getHostname(url: string) {
  try { return new URL(url).hostname; } catch { return url; }
}

function formatRelativeTime(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function StatCard({
  value,
  label,
  warn = false,
  icon: Icon,
}: {
  value: number;
  label: string;
  warn?: boolean;
  icon: React.ElementType;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/30 p-4">
      <div className="flex items-center gap-2 mb-2.5">
        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Icon className="h-3.5 w-3.5 text-primary" />
        </div>
        <p className="text-xs text-muted-foreground truncate">{label}</p>
      </div>
      <p
        className={cn(
          "text-2xl font-bold tabular-nums tracking-tight leading-none",
          warn && value > 0
            ? "text-[hsl(var(--severity-high))]"
            : "text-foreground",
        )}
      >
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function CardHeader({
  title,
  right,
}: {
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-border/40">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {right && <div className="text-xs text-muted-foreground">{right}</div>}
    </div>
  );
}

function ScanBadge({
  count,
  summary,
}: {
  count: number;
  summary: DashboardData["recentScans"][0]["summary"];
}) {
  if (count === 0) {
    return (
      <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
        Clean
      </span>
    );
  }
  const c = summary?.critical || 0;
  const h = summary?.high || 0;
  const m = summary?.medium || 0;
  if (c > 0) {
    return (
      <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full bg-[hsl(var(--severity-critical))]/10 text-[hsl(var(--severity-critical))] shrink-0">
        {count} issues
      </span>
    );
  }
  if (h > 0) {
    return (
      <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full bg-[hsl(var(--severity-high))]/10 text-[hsl(var(--severity-high))] shrink-0">
        {count} issues
      </span>
    );
  }
  if (m > 0) {
    return (
      <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0">
        {count} issues
      </span>
    );
  }
  return (
    <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground shrink-0">
      {count} low
    </span>
  );
}

function SeverityBar({
  label,
  count,
  total,
  colorClass,
}: {
  label: string;
  count: number;
  total: number;
  colorClass: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="flex items-center gap-2 w-14 shrink-0">
        <span className={cn("w-2 h-2 rounded-full shrink-0", colorClass)} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-700 ease-out", colorClass)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-semibold tabular-nums font-mono w-5 text-right shrink-0 text-foreground">
        {count}
      </span>
    </div>
  );
}

function ActivityChart({ data, recentHalf, priorHalf }: {
  data: { day: string; scans: number; issues: number }[];
  recentHalf: number;
  priorHalf: number;
}) {
  const maxScans = Math.max(...data.map((d) => d.scans), 1);
  const midpoint = Math.floor(data.length / 2);

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-0.5 h-16">
        {data.map((d, i) => {
          const height = (d.scans / maxScans) * 100;
          const dayDate = new Date(d.day + "T12:00:00");
          const isToday = new Date().toDateString() === dayDate.toDateString();
          const isRecent = i >= midpoint;
          return (
            <div
              key={i}
              className="flex-1 flex flex-col items-center justify-end h-full group relative"
            >
              <div className="absolute -top-7 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 whitespace-nowrap bg-popover border border-border rounded px-2 py-1 shadow-md">
                <p className="text-[10px] font-medium">{d.scans} scan{d.scans !== 1 ? "s" : ""}</p>
              </div>
              <div
                className={cn(
                  "w-full rounded-t-sm transition-all duration-300",
                  d.scans > 0
                    ? isToday
                      ? "bg-primary"
                      : isRecent
                      ? "bg-primary/50 group-hover:bg-primary/70"
                      : "bg-primary/20 group-hover:bg-primary/40"
                    : "bg-muted/20",
                )}
                style={{ height: d.scans > 0 ? `${Math.max(height, 8)}%` : "4%" }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm bg-primary" />
            Today
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm bg-primary/30" />
            Previous
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {recentHalf + priorHalf} total scans
        </span>
      </div>
    </div>
  );
}

function TrendBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return null;
  const delta = current - previous;
  const pct = (delta / previous) * 100;
  if (Math.abs(pct) < 1) return null;
  const isUp = delta > 0;
  const Icon = isUp ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded tabular-nums",
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

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4 pt-4 w-full animate-pulse">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-xl border border-border/40 bg-card/30 p-4">
            <div className="flex items-center gap-2 mb-2.5">
              <div className="w-7 h-7 rounded-lg bg-muted shrink-0" />
              <div className="h-3 w-16 rounded bg-muted" />
            </div>
            <div className="h-7 w-10 rounded bg-muted" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[...Array(2)].map((_, col) => (
          <div key={col} className="flex flex-col gap-4">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="rounded-xl border border-border/40 bg-card/30 overflow-hidden">
                <div className="flex items-center px-4 py-3.5 border-b border-border/40">
                  <div className="h-3.5 w-28 rounded bg-muted" />
                </div>
                <div className="p-4 space-y-3">
                  {[...Array(4)].map((_, j) => (
                    <div key={j} className="flex gap-3 items-center">
                      <div className="w-8 h-8 rounded-full bg-muted shrink-0" />
                      <div className="flex-1 h-3 rounded bg-muted" />
                      <div className="w-14 h-5 rounded-full bg-muted" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
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

  if (loading) return <DashboardSkeleton />;
  if (!data) return null;

  const sb = {
    critical: Number(data.severityBreakdown.critical) || 0,
    high:     Number(data.severityBreakdown.high)     || 0,
    medium:   Number(data.severityBreakdown.medium)   || 0,
    low:      Number(data.severityBreakdown.low)      || 0,
    info:     Number(data.severityBreakdown.info)     || 0,
  };
  const totalIssues = sb.critical + sb.high + sb.medium + sb.low + sb.info;
  const highPlusCritical = sb.critical + sb.high;
  const apiCount  = data.sourceBreakdown.find((s) => s.source === "api")?.count  || 0;
  const webCount  = data.totalScans - apiCount;

  const midpoint   = Math.floor(data.dailyActivity.length / 2);
  const recentHalf = data.dailyActivity.slice(midpoint).reduce((s, d) => s + (Number(d.scans) || 0), 0);
  const priorHalf  = data.dailyActivity.slice(0, midpoint).reduce((s, d) => s + (Number(d.scans) || 0), 0);

  const activity = data.dailyActivity.map((d) => ({
    ...d,
    scans:  Number(d.scans)  || 0,
    issues: Number(d.issues) || 0,
  }));

  const SEVERITY_ROWS = [
    { label: "Critical", count: sb.critical, colorClass: "bg-[hsl(var(--severity-critical))]" },
    { label: "High",     count: sb.high,     colorClass: "bg-[hsl(var(--severity-high))]"     },
    { label: "Medium",   count: sb.medium,   colorClass: "bg-[hsl(var(--severity-medium))]"   },
    { label: "Low",      count: sb.low,      colorClass: "bg-[hsl(var(--severity-low))]"      },
    { label: "Info",     count: sb.info,     colorClass: "bg-muted-foreground/40"              },
  ];

  const ISSUE_SEV_COLORS: Record<string, string> = {
    critical: "bg-[hsl(var(--severity-critical))]",
    high:     "bg-[hsl(var(--severity-high))]",
    medium:   "bg-[hsl(var(--severity-medium))]",
    low:      "bg-[hsl(var(--severity-low))]",
    info:     "bg-muted-foreground/40",
  };

  return (
    <div className="flex flex-col gap-4 pt-6 w-full">

      {/* ── Stat cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={BarChart2}   value={data.totalScans}   label="Total Scans"    />
        <StatCard icon={Globe}       value={data.uniqueSites}  label="Unique Sites"   />
        <StatCard icon={ShieldAlert} value={highPlusCritical}  label="Critical + High" warn />
        <StatCard icon={Terminal}    value={apiCount}          label="API Scans"      />
      </div>

      {/* ── 2-column grid ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* LEFT: Severity Breakdown + Top Issues */}
        <div className="flex flex-col gap-4">

          {/* Severity breakdown */}
          <section className="rounded-xl border border-border/50 bg-card/30 overflow-hidden">
            <CardHeader
              title="Severity Breakdown"
              right={`${totalIssues} total issues`}
            />
            <div className="px-4 sm:px-5 py-4 space-y-0.5">
              {SEVERITY_ROWS.map((row) => (
                <SeverityBar key={row.label} {...row} total={totalIssues} />
              ))}
            </div>
          </section>

          {/* Top recurring issues */}
          <section className="rounded-xl border border-border/50 bg-card/30 overflow-hidden">
            <CardHeader
              title="Top Issues"
              right={
                data.topVulnerabilities.length > 0
                  ? `${data.topVulnerabilities.length} types`
                  : undefined
              }
            />
            {data.topVulnerabilities.length === 0 ? (
              <div className="flex items-center justify-center py-8 px-5">
                <p className="text-xs text-muted-foreground text-center">
                  No recurring findings yet. Run a few scans to see patterns.
                </p>
              </div>
            ) : (
              <div className="px-4 sm:px-5 py-3 space-y-0.5">
                {data.topVulnerabilities.slice(0, 6).map((v, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 py-1.5 border-b border-border/20 last:border-0"
                  >
                    <span
                      className={cn(
                        "w-2 h-2 rounded-full shrink-0",
                        ISSUE_SEV_COLORS[v.severity] || "bg-muted-foreground/40",
                      )}
                    />
                    <span className="text-xs text-foreground flex-1 truncate min-w-0">
                      {v.title}
                    </span>
                    <span className="text-[11px] text-muted-foreground tabular-nums font-mono shrink-0">
                      {v.count}x
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

        </div>

        {/* RIGHT: Scan Activity + Recent Scans */}
        <div className="flex flex-col gap-4">

          {/* Scan activity chart */}
          <section className="rounded-xl border border-border/50 bg-card/30 overflow-hidden">
            <CardHeader
              title="Scan Activity"
              right={
                <span className="flex items-center gap-1.5">
                  Last 14 days
                  <TrendBadge current={recentHalf} previous={priorHalf} />
                </span>
              }
            />
            <div className="px-4 sm:px-5 py-4">
              <ActivityChart data={activity} recentHalf={recentHalf} priorHalf={priorHalf} />
            </div>
          </section>

          {/* Recent scans */}
          <section className="rounded-xl border border-border/50 bg-card/30 overflow-hidden flex-1">
            <CardHeader
              title="Recent Scans"
              right={
                data.recentScans.length > 0 ? (
                  <a
                    href={ROUTES.HISTORY}
                    className="inline-flex items-center gap-1 text-primary hover:text-primary/80 transition-colors"
                  >
                    View all <ArrowUpRight className="h-3 w-3" />
                  </a>
                ) : undefined
              }
            />
            {data.recentScans.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-5 text-center">
                <div className="w-9 h-9 rounded-xl bg-muted/50 flex items-center justify-center mb-3">
                  <ExternalLink className="h-4 w-4 text-muted-foreground/40" />
                </div>
                <p className="text-sm font-medium text-foreground">No scans yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Enter a URL above to run your first scan.
                </p>
              </div>
            ) : (
              <div>
                {data.recentScans.map((scan) => (
                  <a
                    key={scan.id}
                    href={`${ROUTES.HISTORY}?scan=${scan.id}`}
                    className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors group"
                  >
                    <div className="w-7 h-7 rounded-full bg-muted/50 flex items-center justify-center shrink-0">
                      <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {getHostname(scan.url)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatRelativeTime(scan.scanned_at)}
                      </p>
                    </div>
                    <ScanBadge count={scan.findings_count} summary={scan.summary} />
                  </a>
                ))}
              </div>
            )}
          </section>

        </div>
      </div>
    </div>
  );
}
