"use client";

import { useEffect, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { API } from "@/lib/config/client-constants";
import { cn } from "@/lib/ui/utils";
import {
  computeTrendDelta,
  tierColorForScore,
  toChartData,
} from "@/components/host/danger-score-trend-utils";
import type { HostScoreTrendPoint } from "@/app/api/v3/host/[hostname]/trend/route";

interface DangerScoreTrendProps {
  hostname: string;
  /**
   * Trend points the caller already fetched. `undefined` means "fetch them
   * yourself" (the standalone behaviour); an array, including an empty one,
   * means the caller's request succeeded; `null` means it failed.
   *
   * This exists because the only consumer, app/host/[hostname]/page.tsx,
   * mounts this component inside its own result gate, so the trend request
   * could not start until the host report had already resolved: two
   * serialized round trips for two endpoints that share nothing but the
   * hostname. The page now issues both with Promise.all and hands the result
   * down.
   */
  points?: HostScoreTrendPoint[] | null;
}

const chartConfig = {
  dangerScore: {
    label: "Risk score",
    color: "hsl(var(--primary))",
  },
} satisfies ChartConfig;

/**
 * Risk-score history for a host, across up to the last 30 public/completed
 * scans of it (GET /api/v3/host/[hostname]/trend).
 *
 * Loading, failed and "not enough data" used to collapse into one silent
 * `return null`, so a broken endpoint was indistinguishable from a host with
 * a clean history: on a security product, "no chart" reads as "nothing to
 * see here", which is the wrong answer when the truth is "we could not ask".
 * Each of the three now has its own rendering, and the loading one reserves
 * the chart's height so the page does not jump when the data lands.
 */
export function DangerScoreTrend({
  hostname,
  points: suppliedPoints,
}: DangerScoreTrendProps) {
  const controlled = suppliedPoints !== undefined;
  const [fetchedPoints, setFetchedPoints] = useState<
    HostScoreTrendPoint[] | null
  >(null);
  const [fetchFailed, setFetchFailed] = useState(false);

  useEffect(() => {
    if (controlled) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(API.HOST_TREND(hostname));
        if (!res.ok) {
          if (!cancelled) setFetchFailed(true);
          return;
        }
        const body: { points?: HostScoreTrendPoint[] } = await res.json();
        if (!cancelled) setFetchedPoints(body.points ?? []);
      } catch {
        if (!cancelled) setFetchFailed(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [hostname, controlled]);

  const points = controlled ? suppliedPoints : fetchedPoints;
  const failed = controlled ? suppliedPoints === null : fetchFailed;

  if (failed && !points) {
    return (
      <div className="flex flex-col gap-2 border-t border-border/50 pt-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Risk score over time
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          The score history for this host could not be loaded. That is a problem
          on our side, not an empty history: reload the page to try again.
        </p>
      </div>
    );
  }

  // Still loading. Reserve the chart's own height so the rest of the report
  // does not shift down when the line appears.
  if (!points) {
    return (
      <div
        className="flex flex-col gap-3 border-t border-border/50 pt-5"
        aria-busy="true"
      >
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Risk score over time
        </h2>
        <div className="h-36 animate-pulse rounded-xl border border-border bg-muted/40 sm:h-40" />
      </div>
    );
  }

  // Known host, but not enough public scans to draw a line yet. Say so plainly
  // instead of rendering nothing, which reads as the chart being broken.
  if (points.length < 2) {
    return (
      <div className="flex flex-col gap-2 border-t border-border/50 pt-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Risk score over time
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {points.length === 1
            ? "Only one public scan of this host on record so far."
            : "No public scans of this host on record yet."}{" "}
          Scan it again and keep the result public to start charting how its
          risk score changes over time.
        </p>
      </div>
    );
  }

  const latest = points[points.length - 1];
  const delta = computeTrendDelta(points);
  const strokeColor = tierColorForScore(latest.dangerScore);
  const data = toChartData(points);

  return (
    <div className="flex flex-col gap-3 border-t border-border/50 pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Risk score over time
        </h2>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {points.length} public scans on record
          {delta && delta.direction !== "flat" && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 font-medium",
                delta.direction === "up"
                  ? "text-[hsl(var(--severity-critical))]"
                  : "text-[hsl(var(--success))]",
              )}
            >
              {delta.direction === "up" ? (
                <TrendingUp aria-hidden className="h-3 w-3" />
              ) : (
                <TrendingDown aria-hidden className="h-3 w-3" />
              )}
              {delta.value > 0 ? "+" : ""}
              {delta.value} since the oldest scan shown
            </span>
          )}
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        {/* The SVG recharts draws carries no text, so without this the whole
            series is unreadable to a screen reader and unreachable from the
            keyboard: the tooltip is the only way to read a value and it is
            mouse-only. The table below is the text alternative; the chart
            itself is then marked presentational so the same numbers are not
            announced twice. */}
        <table className="sr-only">
          <caption>
            Risk score for each of the last {data.length} public scans, on a
            scale of 0 to 10
          </caption>
          <thead>
            <tr>
              <th scope="col">Scan date</th>
              <th scope="col">Risk score</th>
            </tr>
          </thead>
          <tbody>
            {data.map((point) => (
              <tr key={point.date}>
                <th scope="row">{point.date}</th>
                <td>{point.dangerScore}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ChartContainer
          aria-hidden="true"
          config={chartConfig}
          className="aspect-auto h-36 w-full sm:h-40"
        >
          <AreaChart
            data={data}
            margin={{ left: -20, right: 8, top: 8, bottom: 0 }}
          >
            <defs>
              <linearGradient id="dangerScoreFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={strokeColor} stopOpacity={0.3} />
                <stop offset="95%" stopColor={strokeColor} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
            />
            <YAxis
              domain={[0, 10]}
              tickCount={3}
              tickLine={false}
              axisLine={false}
              width={24}
            />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent indicator="line" />}
            />
            <Area
              dataKey="dangerScore"
              type="monotone"
              fill="url(#dangerScoreFill)"
              stroke={strokeColor}
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </div>
    </div>
  );
}
