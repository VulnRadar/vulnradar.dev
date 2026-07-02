"use client";

import { useState, useEffect } from "react";
import { TrendingUp, TrendingDown, ArrowUpRight, ExternalLink } from "lucide-react";
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

// Metric cell for the top strip
function Metric({
  value,
  label,
  warn = false,
  sub,
}: {
  value: number;
  label: string;
  warn?: boolean;
  sub?: string;
}) {
  return (
    <div className="flex flex-col justify-center px-5 py-4 min-w-0">
      <span
        className={cn(
          "text-3xl font-bold tabular-nums leading-none tracking-tight",
          warn && value > 0
            ? "text-[hsl(var(--severity-high))]"
            : "text-foreground",
        )}
      >
        {value}
      </span>
      <span className="text-xs text-muted-foreground mt-1.5 truncate">{label}</span>
      {sub && (
        <span className="text-[10px] text-muted-foreground/50 mt-0.5 truncate">{sub}</span>
      )}
    </div>
  );
}

// Per-scan result badge
function ScanBadge({
  count,
  summary,
}: {
  count: number;
  summary: DashboardData["recentScans"][0]["summary"];
}) {
  if (count === 0) {
    return (
      <span className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        Clean
      </span>
    );
  }
  const c = summary?.critical || 0;
  const h = summary?.high || 0;
  const m = summary?.medium || 0;
  if (c > 0) {
    return (
      <span className="inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-md bg-[hsl(var(--severity-critical))]/10 text-[hsl(var(--severity-critical))]">
        {c} critical
      </span>
    );
  }
  if (h > 0) {
    return (
      <span className="inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-md bg-[hsl(var(--severity-high))]/10 text-[hsl(var(--severity-high))]">
        {h} high
      </span>
    );
  }
  if (m > 0) {
    return (
      <span className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
        {count} issues
      </span>
    );
  }
  return (
    <span className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-md bg-muted/60 text-muted-foreground">
      {count} low/info
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
      <div className="flex items-center gap-2 w-16 shrink-0">
        <span className={cn("w-2 h-2 rounded-full shrink-0", colorClass)} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-700 ease-out", colorClass)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] text-muted-foreground/60 tabular-nums w-8 text-right shrink-0">
        {pct}%
      </span>
      <span className="text-xs font-semibold tabular-nums font-mono w-6 text-right shrink-0 text-foreground">
        {count}
      </span>
    </div>
  );
}

function ActivityChart({ data }: { data: { day: string; scans: number; issues: number }[] }) {
  const maxScans = Math.max(...data.map((d) => d.scans), 1);
  return (
    <div className="space-y-1.5">
      <div className="flex items-end gap-0.5 h-16">
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
                <p className="text-[10px] font-medium">{d.scans} scan{d.scans !== 1 ? "s" : ""}</p>
              </div>
              <div
                className={cn(
                  "w-full rounded-t-sm transition-all duration-300",
                  d.scans > 0
                    ? isToday
                      ? "bg-primary"
                      : "bg-primary/40 group-hover:bg-primary/70"
                    : "bg-muted/20",
                )}
                style={{ height: d.scans > 0 ? `${Math.max(height, 8)}%` : "4%" }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground/50 px-0.5">
        <span>
          {new Date(data[0]?.day + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </span>
        <span>today</span>
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

// Loading skeleton
function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6 pt-8 w-full animate-pulse">
      {/* Metric strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 border border-border/40 rounded-xl overflow-hidden divide-x divide-border/40">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="px-5 py-4">
            <div className="h-8 w-12 rounded-lg bg-muted mb-2" />
            <div className="h-3 w-20 rounded bg-muted" />
          </div>
        ))}
      </div>
      {/* Recent scans */}
      <div className="rounded-xl border border-border/40 overflow-hidden">
        <div className="px-5 py-3 border-b border-border/40 bg-muted/20">
          <div className="h-3 w-20 rounded bg-muted" />
        </div>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-border/30 last:border-0">
            <div className="w-1.5 h-1.5 rounded-full bg-muted shrink-0" />
            <div className="flex-1 h-4 rounded bg-muted" />
            <div className="h-6 w-16 rounded-md bg-muted" />
            <div className="h-3 w-10 rounded bg-muted" />
            <div className="h-3 w-12 rounded bg-muted" />
          </div>
        ))}
      </div>
      {/* Bottom grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="rounded-xl border border-border/40 p-5">
            <div className="h-4 w-32 rounded bg-muted mb-4" />
            <div className="space-y-3">
              {[...Array(5)].map((_, j) => (
                <div key={j} className="flex gap-3 items-center">
                  <div className="w-16 h-3 rounded bg-muted" />
                  <div className="flex-1 h-1.5 rounded-full bg-muted" />
                  <div className="w-12 h-3 rounded bg-muted" />
                </div>
              ))}
            </div>
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
    high: Number(data.severityBreakdown.high) || 0,
    medium: Number(data.severityBreakdown.medium) || 0,
    low: Number(data.severityBreakdown.low) || 0,
    info: Number(data.severityBreakdown.info) || 0,
  };
  const totalIssues = sb.critical + sb.high + sb.medium + sb.low + sb.info;
  const highPlusCritical = sb.critical + sb.high;
  const apiCount = data.sourceBreakdown.find((s) => s.source === "api")?.count || 0;

  const midpoint = Math.floor(data.dailyActivity.length / 2);
  const recentHalf = data.dailyActivity.slice(midpoint).reduce((s, d) => s + (Number(d.scans) || 0), 0);
  const priorHalf = data.dailyActivity.slice(0, midpoint).reduce((s, d) => s + (Number(d.scans) || 0), 0);

  const activity = data.dailyActivity.map((d) => ({
    ...d,
    scans: Number(d.scans) || 0,
    issues: Number(d.issues) || 0,
  }));

  const SEVERITY_ROWS = [
    { label: "Critical", count: sb.critical, colorClass: "bg-[hsl(var(--severity-critical))]" },
    { label: "High",     count: sb.high,     colorClass: "bg-[hsl(var(--severity-high))]" },
    { label: "Medium",   count: sb.medium,   colorClass: "bg-[hsl(var(--severity-medium))]" },
    { label: "Low",      count: sb.low,      colorClass: "bg-[hsl(var(--severity-low))]" },
    { label: "Info",     count: sb.info,     colorClass: "bg-muted-foreground/40" },
  ];

  const ISSUE_SEV_COLORS: Record<string, string> = {
    critical: "bg-[hsl(var(--severity-critical))]",
    high:     "bg-[hsl(var(--severity-high))]",
    medium:   "bg-[hsl(var(--severity-medium))]",
    low:      "bg-[hsl(var(--severity-low))]",
    info:     "bg-muted-foreground/40",
  };

  return (
    <div className="flex flex-col gap-6 pt-8 w-full">

      {/* ── Top metric strip ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 border border-border/50 rounded-xl bg-card/30 overflow-hidden divide-x divide-y sm:divide-y-0 divide-border/40">
        <Metric value={data.totalScans} label="Scans (14 days)" />
        <Metric value={data.uniqueSites} label="Unique sites" />
        <Metric
          value={highPlusCritical}
          label="Critical / High"
          warn
          sub={highPlusCritical > 0 ? "across all scans" : "none found"}
        />
        <Metric value={apiCount} label="Via API" sub={apiCount > 0 ? `${data.totalScans - apiCount} via web` : undefined} />
      </div>

      {/* ── Recent scans table ───────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground">Recent scans</h2>
          <a
            href={ROUTES.HISTORY}
            className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
          >
            View all <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </div>

        <div className="rounded-xl border border-border/50 bg-card/30 overflow-hidden">
          {data.recentScans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
              <div className="w-10 h-10 rounded-xl bg-muted/50 flex items-center justify-center mb-3">
                <ExternalLink className="h-5 w-5 text-muted-foreground/40" />
              </div>
              <p className="text-sm font-medium text-foreground">No scans yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Enter a URL in the field above to run your first scan.
              </p>
            </div>
          ) : (
            <>
              {/* Column headers */}
              <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center px-5 py-2.5 border-b border-border/40 bg-muted/20">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                  Target
                </span>
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide text-right">
                  Result
                </span>
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide text-right">
                  Duration
                </span>
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide text-right w-16">
                  Scanned
                </span>
              </div>

              {/* Rows */}
              {data.recentScans.map((scan) => (
                <a
                  key={scan.id}
                  href={`${ROUTES.HISTORY}?scan=${scan.id}`}
                  className="flex sm:grid sm:grid-cols-[1fr_auto_auto_auto] flex-wrap gap-2 sm:gap-4 items-center px-5 py-3.5 border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors group"
                >
                  {/* Target */}
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0",
                        scan.source === "api" ? "bg-violet-500" : "bg-primary/60",
                      )}
                    />
                    <span className="text-sm font-medium text-foreground truncate">
                      {getHostname(scan.url)}
                    </span>
                    {scan.source === "api" && (
                      <span className="text-[10px] font-medium text-violet-500 bg-violet-500/10 px-1.5 py-0.5 rounded shrink-0 hidden sm:inline">
                        API
                      </span>
                    )}
                  </div>

                  {/* Result */}
                  <div className="sm:text-right">
                    <ScanBadge count={scan.findings_count} summary={scan.summary} />
                  </div>

                  {/* Duration */}
                  <span className="text-xs text-muted-foreground tabular-nums font-mono text-right hidden sm:block">
                    {(scan.duration / 1000).toFixed(1)}s
                  </span>

                  {/* Time */}
                  <span className="text-xs text-muted-foreground tabular-nums text-right w-16 shrink-0">
                    {formatRelativeTime(scan.scanned_at)}
                  </span>
                </a>
              ))}
            </>
          )}
        </div>
      </section>

      {/* ── Severity + Recurring ─────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Severity breakdown */}
        <section className="rounded-xl border border-border/50 bg-card/30 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Severity breakdown</h2>
            <span className="text-xs text-muted-foreground font-mono tabular-nums">
              {totalIssues} total
            </span>
          </div>
          <div className="space-y-0.5">
            {SEVERITY_ROWS.map((row) => (
              <SeverityBar key={row.label} {...row} total={totalIssues} />
            ))}
          </div>
        </section>

        {/* Top recurring issues */}
        <section className="rounded-xl border border-border/50 bg-card/30 p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4">Recurring findings</h2>
          {data.topVulnerabilities.length === 0 ? (
            <div className="flex items-center justify-center py-6">
              <p className="text-xs text-muted-foreground">
                No recurring findings yet. Run a few scans to see patterns.
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {data.topVulnerabilities.slice(0, 7).map((v, i) => (
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

      {/* ── Activity chart ───────────────────────────────────────── */}
      <section className="rounded-xl border border-border/50 bg-card/30 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">Scan activity</h2>
            <span className="text-xs text-muted-foreground">· last 14 days</span>
          </div>
          <TrendBadge current={recentHalf} previous={priorHalf} />
        </div>
        <ActivityChart data={activity} />
      </section>

    </div>
  );
}
