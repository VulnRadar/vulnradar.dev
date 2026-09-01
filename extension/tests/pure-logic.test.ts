import { describe, expect, it } from "vitest";

import {
  formatDuration,
  formatRelative,
  meetsThreshold,
  severityRank,
  truncateUrl,
} from "../src/lib/format";
import { CATEGORIES, CATEGORIES_BY_ID } from "../src/lib/categories";
import { planLabel } from "../src/lib/plans";
import type { NotificationThreshold, Severity } from "../src/lib/types";

/**
 * The extension is a shipped Chrome and Firefox Web Store product whose
 * rollback cycle is measured in days, and until recently its whole CI gate was
 * typecheck + format + build. These cover the pure modules where a regression
 * is both cheap to catch and expensive to ship.
 *
 * See vitest.config.ts for why these live here and how they run, and
 * tests/extension/pure-modules.test.ts in the repo root for the suites that
 * cross-check the extension against the app (URL patterns, scan-target
 * classification, the severity token ramp).
 */

const SEVERITIES: readonly Severity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

describe("notification threshold rule", () => {
  // background/service-worker.ts's shouldNotify() used to re-declare this rule
  // with its own severity rank map (info: 0 .. critical: 4). It calls
  // meetsThreshold now, so this table is the single description of what the
  // Notifications dropdown actually does.
  it('never notifies on "off", always notifies on "all"', () => {
    for (const s of SEVERITIES) {
      expect(meetsThreshold(s, "off"), s).toBe(false);
      expect(meetsThreshold(s, "all"), s).toBe(true);
    }
  });

  it("notifies at or above the chosen level and stays quiet below it", () => {
    const expected: Record<
      Exclude<NotificationThreshold, "off" | "all">,
      readonly Severity[]
    > = {
      critical: ["critical"],
      high: ["critical", "high"],
      medium: ["critical", "high", "medium"],
    };
    for (const [threshold, notifying] of Object.entries(expected)) {
      for (const s of SEVERITIES) {
        expect(
          meetsThreshold(s, threshold as NotificationThreshold),
          `${s} at threshold ${threshold}`,
        ).toBe(notifying.includes(s));
      }
    }
  });

  it("ranks severities strictly descending, which is what the rule leans on", () => {
    for (let i = 1; i < SEVERITIES.length; i++) {
      expect(severityRank(SEVERITIES[i - 1]!)).toBeGreaterThan(
        severityRank(SEVERITIES[i]!),
      );
    }
  });
});

describe("format helpers", () => {
  it("prints sub-second durations in ms and longer ones in s / m", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(999)).toBe("999ms");
    expect(formatDuration(1_000)).toBe("1.0s");
    expect(formatDuration(9_500)).toBe("9.5s");
    // At and above 10 the fraction is dropped, so a scan reads "12s" not
    // "12.3s".
    expect(formatDuration(12_300)).toBe("12s");
    expect(formatDuration(60_000)).toBe("1.0m");
    expect(formatDuration(630_000)).toBe("11m");
  });

  it("steps formatRelative through each unit against a fixed now", () => {
    const now = Date.parse("2026-08-29T12:00:00.000Z");
    const ago = (ms: number) => new Date(now - ms).toISOString();
    expect(formatRelative(ago(5_000), now)).toBe("5s ago");
    expect(formatRelative(ago(5 * 60_000), now)).toBe("5m ago");
    expect(formatRelative(ago(5 * 3_600_000), now)).toBe("5h ago");
    expect(formatRelative(ago(3 * 86_400_000), now)).toBe("3d ago");
  });

  it("returns an unparseable timestamp unchanged instead of NaN", () => {
    expect(formatRelative("not a date", Date.now())).toBe("not a date");
  });

  it("truncates only past the limit, and the ellipsis counts toward it", () => {
    expect(truncateUrl("https://example.com", 48)).toBe("https://example.com");
    const long = `https://example.com/${"a".repeat(80)}`;
    const cut = truncateUrl(long, 48);
    expect(cut).toHaveLength(48);
    expect(cut.endsWith("…")).toBe(true);
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
  });
});

describe("category catalog", () => {
  it("indexes every category exactly once", () => {
    expect(Object.keys(CATEGORIES_BY_ID)).toHaveLength(CATEGORIES.length);
    for (const c of CATEGORIES) {
      expect(CATEGORIES_BY_ID[c.id]).toBe(c);
    }
  });

  it("keeps active-probes off by default", () => {
    // This is the only family that writes real requests to the target and
    // requires domain verification, so it must never default on in the
    // options page's family list.
    const probes = CATEGORIES.find((c) => c.id === "active-probes");
    expect(probes).toBeDefined();
    expect(probes!.defaultEnabled).toBe(false);
  });
});

describe("plan labels", () => {
  it("names every known plan and passes an unknown id through", () => {
    expect(planLabel("free")).toBe("Free");
    expect(planLabel("elite_supporter")).toBe("Elite Supporter");
    // The API can add a plan before the extension knows about it; the pill
    // should show the raw id rather than "undefined".
    expect(planLabel("enterprise" as never)).toBe("enterprise");
  });
});
