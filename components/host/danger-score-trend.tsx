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
import { API } from "@/lib/config/constants";
import { cn } from "@/lib/ui/utils";
import {
  computeTrendDelta,
  tierColorForScore,
  toChartData,
} from "@/components/host/danger-score-trend-utils";
import type { HostScoreTrendPoint } from "@/app/api/v3/host/[hostname]/trend/route";

interface DangerScoreTrendProps {
  hostname: string;
}

const chartConfig = {
  dangerScore: {
    label: "Risk score",
    color: "hsl(var(--primary))",
  },
} satisfies ChartConfig;

/**
 * Risk-score history for a host, across up to the last 30 public/completed
 * scans of it (GET /api/v3/host/[hostname]/trend). Renders nothing while
 * loading or on error (a supplement to the report above it, not worth its own
 * error state), but when the host is known yet has fewer than 2 public scans it
 * shows a short "needs 2+ public scans" note rather than vanishing -- silence
 * there read as the chart being broken.
 */
export function DangerScoreTrend({ hostname }: DangerScoreTrendProps) {
  const [points, setPoints] = useState<HostScoreTrendPoint[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(API.HOST_TREND(hostname));
        if (!res.ok) return;
        const body: { points?: HostScoreTrendPoint[] } = await res.json();
        if (!cancelled) setPoints(body.points ?? []);
      } catch {
        // Supplementary chart -- a failed fetch just means it stays hidden.
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [hostname]);

  // Still loading, or the fetch failed: stay hidden. This chart supplements the
  // report above it and isn't worth its own error state.
  if (!points) return null;

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

      <div className="rounded-md border border-border bg-card p-4 sm:p-5">
        <ChartContainer
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
