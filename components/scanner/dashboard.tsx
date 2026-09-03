"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Clock,
  Globe,
  ListOrdered,
  ShieldAlert,
  Terminal,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/ui/utils";
import { pluralize } from "@/lib/ui/plural";
import { formatRelativeTime } from "@/lib/ui/relative-time";
import { API, ROUTES } from "@/lib/config/client-constants";
import {
  SEVERITY_ORDER,
  SEVERITY_TONE,
  severityTone,
} from "@/components/scanner/severity-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { StatStrip, StatStripSkeleton } from "@/components/shared/stat-strip";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CONFIG_DASHBOARD_WIDGET_LIMIT } from "@/lib/config/config-values";
import type { Severity } from "@/lib/scanner/types";

/**
 * How many rows each list widget holds. The API caps both the recent-scans and
 * the top-findings queries at DASHBOARD_WIDGET_LIMIT, so the skeleton reads the
 * same default rather than hardcoding a row count that could drift from it, and
 * the loaded list slices to it rather than to a separate literal 6.
 */
const WIDGET_ROWS = CONFIG_DASHBOARD_WIDGET_LIMIT;

interface DashboardData {
  totalScans: number;
  uniqueSites: number;
  recentScans: {
    // Opaque public_id (the dashboard API aliases public_id AS id), carried
    // straight into the ?scan= link the History tab resolves.
    id: string;
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
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function fmtDay(day: string) {
  return new Date(day + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Worst severity present on a scan, used to colour its row marker. */
function worstSeverity(
  summary: DashboardData["recentScans"][0]["summary"],
): Severity | null {
  if (summary?.critical) return "critical";
  if (summary?.high) return "high";
  if (summary?.medium) return "medium";
  if (summary?.low) return "low";
  if (summary?.info) return "info";
  return null;
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
  const pct = (delta / previous) * 100;
  if (Math.abs(pct) < 1) return null;
  const isUp = delta > 0;
  const Icon = isUp ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
        isUp ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
      )}
    >
      <Icon aria-hidden className="h-2.5 w-2.5" />
      {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="flex w-full animate-pulse flex-col gap-4 pt-6">
      {/* The loaded state puts the strip inside a card that also carries the
          14-day activity row underneath it. The skeleton used to draw a bare
          bordered strip and nothing else, so the whole page below it jumped
          down by the height of that row the moment the fetch landed. */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <StatStripSkeleton bordered={false} />
        <div className="flex items-center gap-3 border-t border-border bg-muted/30 px-4 py-2.5">
          <div className="h-3 w-12 shrink-0 rounded bg-muted" />
          <div className="h-8 flex-1 rounded bg-muted/60" />
          <div className="h-3 w-14 shrink-0 rounded bg-muted" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        {/* The three panels used to be blank h-72/h-32/h-36 rectangles, and
            none of the three guesses was close: the real severity panel is
            nearer 190px and the findings panel nearer 210px, so the grid grew
            by well over a hundred pixels the moment data landed. Mirroring the
            actual header bar and row counts means the height falls out of the
            same structure instead of being guessed at. */}
        <SkeletonPanel rows={WIDGET_ROWS} rowClassName="h-[38px]" withAction />
        <div className="flex flex-col gap-4">
          <SkeletonPanel rows={SEVERITY_ORDER.length} withAction />
          <SkeletonPanel rows={WIDGET_ROWS} />
        </div>
      </div>
    </div>
  );
}

/** One dashboard widget: the muted header bar plus its rows. */
function SkeletonPanel({
  rows,
  rowClassName = "h-4",
  withAction = false,
}: {
  rows: number;
  rowClassName?: string;
  /** Panels whose header carries a trailing link or total on the right. */
  withAction?: boolean;
}) {
  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
        <div className="h-4 w-32 rounded bg-muted" />
        {withAction && <div className="h-4 w-16 rounded bg-muted" />}
      </div>
      <div className="flex flex-1 flex-col justify-center gap-3 px-4 py-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className={cn("w-full rounded bg-muted", rowClassName)}
          />
        ))}
      </div>
    </section>
  );
}

function FirstRunPanel() {
  return (
    <div className="mt-6 rounded-xl border border-dashed border-border bg-card/50 p-5 sm:p-6">
      <h2 className="text-base font-semibold text-foreground">
        No scans on this account yet
      </h2>
      <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted-foreground">
        Put a hostname in the box above and hit Scan. The first run takes a few
        seconds and lands in your history automatically, so you can diff it
        against the next one.
      </p>
      <ol className="mt-4 flex flex-col gap-2 text-sm text-muted-foreground">
        <li className="flex gap-3">
          <span className="shrink-0 font-mono text-xs text-muted-foreground/70">
            01
          </span>
          Findings arrive sorted by severity, with the evidence that triggered
          each one.
        </li>
        <li className="flex gap-3">
          <span className="shrink-0 font-mono text-xs text-muted-foreground/70">
            02
          </span>
          Export the report as JSON, CSV or PDF, or hand out a read-only share
          link.
        </li>
        <li className="flex gap-3">
          <span className="shrink-0 font-mono text-xs text-muted-foreground/70">
            03
          </span>
          Rescan from history whenever you ship, and watch the counts move.
        </li>
      </ol>
    </div>
  );
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    fetch(API.DASHBOARD)
      .then((r) => {
        if (!r.ok) {
          if (r.status === 401 || r.status === 403)
            window.location.href = ROUTES.LOGIN;
          throw new Error("unauthorized");
        }
        return r.json();
      })
      .then((d) => {
        if (d && d.severityBreakdown) setData(d);
        else setFailed(true);
        setLoading(false);
      })
      .catch(() => {
        setFailed(true);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: setState only fires once the request resolves, not synchronously here
    load();
  }, [load]);

  if (loading) return <DashboardSkeleton />;
  // A failed /api/v3/dashboard used to return null, leaving the scan form
  // followed by blank space with no message and no way to retry.
  if (failed || !data) {
    return (
      <EmptyState
        className="mt-6"
        icon={AlertTriangle}
        title="Couldn't load your scan activity"
        description="Your scans are unaffected. This is the summary above the scanner, not the scanner itself."
        action={
          <Button
            variant="outline"
            size="sm"
            className="bg-transparent"
            onClick={load}
          >
            Retry
          </Button>
        }
      />
    );
  }
  if (data.totalScans === 0) return <FirstRunPanel />;

  // Every array below was read unguarded while only severityBreakdown was
  // ever checked, so a partial payload (one field missing, an older API, a
  // truncated proxy response) threw straight into app/dashboard/error.tsx and
  // took out the whole route. Default each one instead.
  const severityBreakdown = data.severityBreakdown ?? {};
  const sb: Record<Severity, number> = {
    critical: Number(severityBreakdown.critical) || 0,
    high: Number(severityBreakdown.high) || 0,
    medium: Number(severityBreakdown.medium) || 0,
    low: Number(severityBreakdown.low) || 0,
    info: Number(severityBreakdown.info) || 0,
  };
  const totalIssues = SEVERITY_ORDER.reduce((sum, s) => sum + sb[s], 0);
  const highPlusCritical = sb.critical + sb.high;
  const sourceBreakdown = Array.isArray(data.sourceBreakdown)
    ? data.sourceBreakdown
    : [];
  const topVulnerabilities = Array.isArray(data.topVulnerabilities)
    ? data.topVulnerabilities
    : [];
  const recentScans = Array.isArray(data.recentScans) ? data.recentScans : [];
  const apiCount = sourceBreakdown.find((s) => s.source === "api")?.count || 0;

  const activity = (
    Array.isArray(data.dailyActivity) ? data.dailyActivity : []
  ).map((d) => ({
    ...d,
    scans: Number(d.scans) || 0,
    issues: Number(d.issues) || 0,
  }));
  const midpoint = Math.floor(activity.length / 2);
  const recentHalf = activity.slice(midpoint).reduce((s, d) => s + d.scans, 0);
  const priorHalf = activity
    .slice(0, midpoint)
    .reduce((s, d) => s + d.scans, 0);
  const maxScans = Math.max(...activity.map((d) => d.scans), 1);
  const topCount = Math.max(...topVulnerabilities.map((v) => v.count), 1);

  return (
    <div className="flex w-full flex-col gap-4 pt-6">
      {/* Inline stat bar. One strip, not four cards. Bordered by the card
          around it, which also carries the activity sparkline below. */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <StatStrip
          bordered={false}
          items={[
            {
              value: data.totalScans,
              label: "Scans run",
              icon: BarChart3,
              iconTone: "primary",
            },
            {
              value: data.uniqueSites,
              label: "Hosts covered",
              icon: Globe,
              iconTone: "primary",
            },
            {
              value: highPlusCritical,
              label: "Critical and high",
              icon: ShieldAlert,
              iconTone: "severity-high",
            },
            {
              value: apiCount,
              label: "Started from the API",
              icon: Terminal,
              iconTone: "purple",
            },
          ]}
        />

        {/* 14-day activity, as a slim strip rather than its own card. */}
        {activity.length > 0 && (
          <div className="flex items-center gap-3 border-t border-border bg-muted/30 px-4 py-2.5">
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {pluralize(activity.length, "day")}
            </span>
            <TooltipProvider delayDuration={100}>
              <div
                className="flex h-8 flex-1 items-end gap-px"
                role="img"
                aria-label={`Scan activity from ${fmtDay(activity[0].day)} to ${fmtDay(
                  activity[activity.length - 1].day,
                )}, ${pluralize(recentHalf + priorHalf, "scan")} total`}
              >
                {activity.map((d, i) => (
                  <Tooltip key={i}>
                    <TooltipTrigger asChild>
                      <span
                        className={cn(
                          "min-w-0 flex-1 rounded-sm transition-colors",
                          d.scans > 0
                            ? "bg-primary/60 hover:bg-primary/80"
                            : "bg-muted hover:bg-muted-foreground/20",
                        )}
                        style={{
                          height:
                            d.scans > 0
                              ? `${Math.max((d.scans / maxScans) * 100, 8)}%`
                              : "8%",
                        }}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">
                      <p className="font-medium">{fmtDay(d.day)}</p>
                      <p className="text-muted-foreground">
                        {pluralize(d.scans, "scan")}
                        {d.scans > 0 && ` · ${pluralize(d.issues, "issue")}`}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </TooltipProvider>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground">
              {pluralize(recentHalf + priorHalf, "scan")}
              <TrendBadge current={recentHalf} previous={priorHalf} />
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        {/* Recent scans: the list people actually click. */}
        <section className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
            <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Clock aria-hidden className="h-3.5 w-3.5" />
              Recent scans
            </h2>
            {recentScans.length > 0 && (
              <a
                href={ROUTES.HISTORY}
                className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary transition-colors hover:text-primary/80 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                All history
                <ArrowUpRight aria-hidden className="h-3 w-3" />
              </a>
            )}
          </div>

          {recentScans.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Nothing in the last window. Run a scan above and it lands here.
            </p>
          ) : (
            <ul className="flex flex-1 flex-col divide-y divide-border">
              {recentScans.slice(0, WIDGET_ROWS).map((scan) => {
                const worst = worstSeverity(scan.summary);
                const tone = worst ? SEVERITY_TONE[worst] : null;
                return (
                  <li key={scan.id} className="flex-1">
                    <a
                      href={`${ROUTES.HISTORY}?scan=${scan.id}`}
                      className="group relative flex h-full items-center gap-3 py-2 pl-4 pr-4 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "absolute inset-y-0 left-0 w-[3px]",
                          tone ? tone.solid : "bg-[hsl(var(--success))]",
                        )}
                      />
                      <span className="min-w-0 flex-1 leading-tight">
                        <span className="block truncate font-mono text-sm text-foreground group-hover:text-primary">
                          {getHostname(scan.url)}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {formatRelativeTime(scan.scanned_at)}
                          {scan.source === "api" && " via API"}
                        </span>
                      </span>
                      {scan.findings_count === 0 ? (
                        <span className="shrink-0 text-xs font-medium text-[hsl(var(--success))]">
                          Clean
                        </span>
                      ) : (
                        <span
                          className={cn(
                            "shrink-0 text-xs font-semibold tabular-nums",
                            tone?.text || "text-muted-foreground",
                          )}
                        >
                          {scan.findings_count}{" "}
                          <span className="font-normal text-muted-foreground">
                            {scan.findings_count === 1 ? "finding" : "findings"}
                          </span>
                        </span>
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="flex flex-col gap-4">
          {/* Severity totals across every scan */}
          <section className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
              <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
                Findings by severity
              </h2>
              <span className="text-xs tabular-nums text-muted-foreground">
                {totalIssues.toLocaleString()} total
              </span>
            </div>
            <ul className="flex flex-col px-4 py-2">
              {SEVERITY_ORDER.map((sev) => {
                const count = sb[sev];
                const tone = SEVERITY_TONE[sev];
                const pct = totalIssues > 0 ? (count / totalIssues) * 100 : 0;
                return (
                  <li key={sev} className="flex items-center gap-3 py-1.5">
                    <span className="w-14 shrink-0 text-xs text-muted-foreground">
                      {tone.label}
                    </span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className={cn("block h-full rounded-full", tone.solid)}
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                    <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-foreground">
                      {count}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Most common findings, ranked */}
          <section className="flex flex-col rounded-xl border border-border bg-card">
            <div className="border-b border-border bg-muted/30 px-4 py-2.5">
              <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <ListOrdered aria-hidden className="h-3.5 w-3.5" />
                Most common findings
              </h2>
            </div>
            {topVulnerabilities.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                Patterns show up here once a few more scans are on record.
              </p>
            ) : (
              <ol className="flex flex-col px-4 py-2">
                {topVulnerabilities.map((v, i) => {
                  const tone = severityTone(v.severity);
                  return (
                    <li
                      key={`${v.title}-${i}`}
                      className="flex items-center gap-3 py-1.5"
                    >
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/70">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      {/* A check title comes out of our own catalogue, so the
                          row can be sized to hold it. On a 320px phone the
                          index, the count column and the gaps leave about
                          185px, and "Missing Content-Security-Policy header"
                          measures roughly 260px, so `truncate` here cut the
                          finding's name in half on the one screen that is
                          meant to tell you what keeps going wrong. */}
                      <span className="min-w-0 flex-1 text-sm leading-snug text-foreground">
                        {v.title}
                      </span>
                      <span className="hidden h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted sm:block">
                        <span
                          className={cn(
                            "block h-full rounded-full",
                            tone.solid,
                          )}
                          style={{ width: `${(v.count / topCount) * 100}%` }}
                        />
                      </span>
                      <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {v.count}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
