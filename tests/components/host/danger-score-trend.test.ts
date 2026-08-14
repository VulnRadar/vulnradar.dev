/**
 * Unit tests for the pure helpers behind components/host/danger-score-trend.tsx,
 * split into danger-score-trend-utils.ts (plain .ts, no JSX) specifically so
 * they're importable here: tsconfig.json sets "jsx": "preserve" for
 * Next.js's own build pipeline, which vitest's esbuild-based transform can't
 * parse, so a .tsx file with real JSX in it can't be imported from a test
 * at all. Same split as tests/components/admin/features/settings-registry-utils.test.ts.
 */
import { describe, it, expect } from "vitest";
import {
  tierColorForScore,
  toChartData,
  computeTrendDelta,
} from "@/components/host/danger-score-trend-utils";
import type { HostScoreTrendPoint } from "@/app/api/v3/host/[hostname]/trend/route";

function point(
  overrides: Partial<HostScoreTrendPoint> = {},
): HostScoreTrendPoint {
  return {
    scanId: 1,
    scannedAt: "2026-01-01T00:00:00.000Z",
    dangerScore: 0,
    ...overrides,
  };
}

describe("tierColorForScore", () => {
  it("uses the success color for the safe band (0-4)", () => {
    expect(tierColorForScore(0)).toBe("hsl(var(--success))");
    expect(tierColorForScore(4)).toBe("hsl(var(--success))");
  });

  it("uses the medium-severity color for the caution band (5-7)", () => {
    expect(tierColorForScore(5)).toBe("hsl(var(--severity-medium))");
    expect(tierColorForScore(7)).toBe("hsl(var(--severity-medium))");
  });

  it("uses the critical-severity color for the unsafe band (8-10)", () => {
    expect(tierColorForScore(8)).toBe("hsl(var(--severity-critical))");
    expect(tierColorForScore(10)).toBe("hsl(var(--severity-critical))");
  });
});

describe("toChartData", () => {
  it("maps each point to a formatted date and its danger score", () => {
    const data = toChartData([
      point({ scannedAt: "2026-01-05T12:00:00.000Z", dangerScore: 3 }),
      point({ scannedAt: "2026-02-10T12:00:00.000Z", dangerScore: 7 }),
    ]);
    expect(data).toHaveLength(2);
    expect(data[0].dangerScore).toBe(3);
    expect(data[1].dangerScore).toBe(7);
    // Locale-formatted date strings are environment-dependent in exact
    // wording, but both a month name fragment and the day number must
    // survive the format.
    expect(data[0].date).toMatch(/5/);
    expect(data[1].date).toMatch(/10/);
  });

  it("returns an empty array for an empty input", () => {
    expect(toChartData([])).toEqual([]);
  });
});

describe("computeTrendDelta", () => {
  it("returns null for fewer than 2 points", () => {
    expect(computeTrendDelta([])).toBeNull();
    expect(computeTrendDelta([point()])).toBeNull();
  });

  it("is 'up' when the newest score is higher than the oldest (got worse)", () => {
    const delta = computeTrendDelta([
      point({ dangerScore: 2 }),
      point({ dangerScore: 6 }),
    ]);
    expect(delta).toEqual({ value: 4, direction: "up" });
  });

  it("is 'down' when the newest score is lower than the oldest (improved)", () => {
    const delta = computeTrendDelta([
      point({ dangerScore: 8 }),
      point({ dangerScore: 1 }),
    ]);
    expect(delta).toEqual({ value: -7, direction: "down" });
  });

  it("is 'flat' when the score hasn't changed", () => {
    const delta = computeTrendDelta([
      point({ dangerScore: 5 }),
      point({ dangerScore: 5 }),
    ]);
    expect(delta).toEqual({ value: 0, direction: "flat" });
  });

  it("only compares the oldest and newest point, ignoring the middle", () => {
    const delta = computeTrendDelta([
      point({ dangerScore: 1 }),
      point({ dangerScore: 9 }),
      point({ dangerScore: 3 }),
    ]);
    expect(delta).toEqual({ value: 2, direction: "up" });
  });
});
