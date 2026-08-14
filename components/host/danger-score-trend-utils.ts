import type { HostScoreTrendPoint } from "@/app/api/v3/host/[hostname]/trend/route";

/**
 * Pure helpers behind components/host/danger-score-trend.tsx, split into a
 * plain .ts file (no JSX) so the logic is importable from a vitest suite --
 * tsconfig.json sets "jsx": "preserve" for Next.js's own build pipeline,
 * which vitest's esbuild-based transform can't parse, so a .tsx module with
 * real JSX in it can't be imported from a test at all. Same split as
 * components/admin/features/settings-registry-utils.ts and
 * components/profile/tabs/developer/schedule-time-utils.ts.
 */

/**
 * Same 0-4 safe / 5-7 caution / 8-10 unsafe bands getDangerScore anchors
 * its own tierBase/tierCap to (lib/scanner/safety-rating.ts), reused here
 * so the line color always agrees with what "Risk score" means elsewhere
 * on this page (the Stat pill in components/scanner/scan-summary.tsx).
 */
export function tierColorForScore(score: number): string {
  if (score >= 8) return "hsl(var(--severity-critical))";
  if (score >= 5) return "hsl(var(--severity-medium))";
  return "hsl(var(--success))";
}

export interface TrendChartDatum {
  date: string;
  dangerScore: number;
}

/** Chart-ready {date, dangerScore} pairs, points already in chronological order. */
export function toChartData(points: HostScoreTrendPoint[]): TrendChartDatum[] {
  return points.map((p) => ({
    date: new Date(p.scannedAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
    dangerScore: p.dangerScore,
  }));
}

export interface TrendDelta {
  value: number;
  direction: "up" | "down" | "flat";
}

/**
 * Change from the oldest to the newest point in the window. "up" means the
 * risk score got worse over that span, "down" means it improved. Null when
 * there is nothing to compare (fewer than 2 points).
 */
export function computeTrendDelta(
  points: HostScoreTrendPoint[],
): TrendDelta | null {
  if (points.length < 2) return null;
  const value = points[points.length - 1].dangerScore - points[0].dangerScore;
  return {
    value,
    direction: value > 0 ? "up" : value < 0 ? "down" : "flat",
  };
}
