/**
 * Unit tests for the pure helpers in
 * components/admin/features/queue-status-utils.ts (formatAgeMs,
 * computeBackedUp, groupFailures and the failure-count wording), consumed by
 * queue-status-manager.tsx. The manager
 * itself is a polling "use client" fetch/render component with no other
 * business logic to exercise, and this project has no DOM-rendering test
 * setup (no jsdom/@testing-library/react anywhere in package.json, and
 * esbuild can't strip JSX from a .tsx file under this repo's
 * "jsx": "preserve" tsconfig) -- these functions live in a plain .ts
 * sibling file for exactly that reason, mirroring
 * settings-registry-utils.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  formatAgeMs,
  computeBackedUp,
  groupFailures,
  describeOtherEndings,
  endedWithoutResultCount,
  otherEndedCount,
  ranForLabel,
  adminUserHref,
  type FailedScan,
  type QueueCounts,
} from "@/components/admin/features/queue-status-utils";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("formatAgeMs", () => {
  it("returns null for a null age", () => {
    expect(formatAgeMs(null)).toBeNull();
  });

  it("reads as a duration, not a timestamp with 'ago' suffix", () => {
    expect(formatAgeMs(5_000)).toBe("just now");
    expect(formatAgeMs(3 * 60_000)).toBe("3m");
    expect(formatAgeMs(2 * 60 * 60_000)).toBe("2h");
  });
});

describe("computeBackedUp", () => {
  it("is false when there is no data yet", () => {
    expect(computeBackedUp(null)).toBe(false);
  });

  it("is false for an empty, healthy queue", () => {
    expect(
      computeBackedUp({
        counts: {
          pending: 0,
          running: 0,
          completedLast24h: 10,
          failedLast24h: 0,
        },
        oldestPendingAgeMs: null,
        oldestRunningAgeMs: null,
      }),
    ).toBe(false);
  });

  it("is false when pending rows exist but are still fresh", () => {
    expect(
      computeBackedUp({
        counts: {
          pending: 2,
          running: 0,
          completedLast24h: 0,
          failedLast24h: 0,
        },
        oldestPendingAgeMs: 5_000, // well under the 60s staleness bar
        oldestRunningAgeMs: null,
      }),
    ).toBe(false);
  });

  it("is true when the oldest pending row has waited past the staleness bar", () => {
    expect(
      computeBackedUp({
        counts: {
          pending: 1,
          running: 0,
          completedLast24h: 0,
          failedLast24h: 0,
        },
        oldestPendingAgeMs: 90_000, // > 60s
        oldestRunningAgeMs: null,
      }),
    ).toBe(true);
  });

  it("ignores a stale age when the count for that status is zero", () => {
    // Defensive: a status with count 0 shouldn't be able to flag "backed
    // up" off a stale leftover age value.
    expect(
      computeBackedUp({
        counts: {
          pending: 0,
          running: 0,
          completedLast24h: 0,
          failedLast24h: 0,
        },
        oldestPendingAgeMs: 999_999_999,
        oldestRunningAgeMs: 999_999_999,
      }),
    ).toBe(false);
  });

  it("is true when a running scan has exceeded the longest configured scan timeout", () => {
    expect(
      computeBackedUp({
        counts: {
          pending: 0,
          running: 1,
          completedLast24h: 0,
          failedLast24h: 0,
        },
        oldestPendingAgeMs: null,
        oldestRunningAgeMs: 31 * 60 * 1000, // > 1800s bulk scan timeout
      }),
    ).toBe(true);
  });

  it("is false when a running scan is still within the longest scan timeout", () => {
    expect(
      computeBackedUp({
        counts: {
          pending: 0,
          running: 1,
          completedLast24h: 0,
          failedLast24h: 0,
        },
        oldestPendingAgeMs: null,
        oldestRunningAgeMs: 5 * 60 * 1000,
      }),
    ).toBe(false);
  });
});

function counts(overrides: Partial<QueueCounts> = {}): QueueCounts {
  return {
    pending: 0,
    running: 0,
    completedLast24h: 0,
    failedLast24h: 0,
    cancelledLast24h: 0,
    refusedLast24h: 0,
    notRunLast24h: 0,
    targetFailedLast24h: 0,
    ...overrides,
  };
}

function failed(overrides: Partial<FailedScan> = {}): FailedScan {
  return {
    id: 1,
    userId: 4,
    url: "https://example.com/",
    error: "boom",
    kind: "internal",
    source: "web",
    durationMs: 2500,
    failedAt: "2026-08-13T11:58:03.000Z",
    ...overrides,
  };
}

describe("the counts beside Failed", () => {
  it("totals everything that ended without a result, whatever the reason", () => {
    const c = counts({
      failedLast24h: 2,
      cancelledLast24h: 9,
      refusedLast24h: 3,
      notRunLast24h: 30,
      targetFailedLast24h: 5,
    });
    expect(otherEndedCount(c)).toBe(47);
    expect(endedWithoutResultCount(c)).toBe(49);
  });

  it("says the non-zero parts in words, and says nothing on a good day", () => {
    expect(describeOtherEndings(counts())).toBeNull();
    expect(
      describeOtherEndings(
        counts({ cancelledLast24h: 12, notRunLast24h: 40, refusedLast24h: 3 }),
      ),
    ).toBe("12 cancelled, 3 refused by a limit, 40 never ran");
    expect(describeOtherEndings(counts({ targetFailedLast24h: 2 }))).toBe(
      "2 stopped by the target",
    );
  });

  it("never uses an em dash in what an operator reads", () => {
    const text = describeOtherEndings(
      counts({
        cancelledLast24h: 1,
        refusedLast24h: 1,
        notRunLast24h: 1,
        targetFailedLast24h: 1,
      }),
    );
    expect(text).not.toContain(String.fromCharCode(0x2014));
  });
});

describe("groupFailures", () => {
  it("groups by why first, so the scanner breaking is not buried under cancels", () => {
    const groups = groupFailures([
      failed({ id: 1, kind: "cancelled", error: "Cancelled" }),
      failed({ id: 2, kind: "cancelled", error: "Cancelled" }),
      failed({ id: 3, kind: "cancelled", error: "Cancelled" }),
      failed({ id: 4, kind: "internal", error: "detector exploded" }),
    ]);

    // The engine's kind leads even though cancels outnumber it three to one.
    expect(groups.map((g) => g.kind)).toEqual(["internal", "cancelled"]);
    expect(groups[0]).toMatchObject({
      engine: true,
      label: "Internal error",
      count: 1,
    });
    expect(groups[1]).toMatchObject({
      engine: false,
      label: "Cancelled by the user",
      count: 3,
    });
  });

  it("orders the groups outside the engine's by size", () => {
    const groups = groupFailures([
      failed({ id: 1, kind: "quota_refused" }),
      failed({ id: 2, kind: "not_run" }),
      failed({ id: 3, kind: "not_run" }),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["not_run", "quota_refused"]);
  });

  it("groups the same error text within a kind and puts the dominant text first", () => {
    const groups = groupFailures([
      failed({ id: 1, error: "timed out" }),
      failed({ id: 2, error: "connection terminated" }),
      failed({ id: 3, error: "connection terminated" }),
      failed({ id: 4, error: "connection terminated" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].byText.map((t) => [t.error, t.count])).toEqual([
      ["connection terminated", 3],
      ["timed out", 1],
    ]);
  });

  it("keeps the newest first among ties, because the query already sorts that way", () => {
    const groups = groupFailures([
      failed({ id: 10, error: "a" }),
      failed({ id: 11, error: "b" }),
    ]);
    expect(groups[0].byText.map((t) => t.error)).toEqual(["a", "b"]);
  });

  it("files a row with no recorded kind as the engine's, under its own label", () => {
    const groups = groupFailures([failed({ id: 1, kind: null })]);
    expect(groups[0]).toMatchObject({
      kind: null,
      engine: true,
      label: "Reason not recorded",
    });
  });

  it("treats a kind from a newer build as unrecorded rather than inventing a label", () => {
    const groups = groupFailures([failed({ kind: "a_kind_from_the_future" })]);
    expect(groups[0].kind).toBeNull();
  });

  it("gives a blank error a name", () => {
    const groups = groupFailures([
      failed({ error: "  " }),
      failed({ error: null }),
    ]);
    expect(groups[0].byText).toEqual([
      expect.objectContaining({
        error: "No error message recorded",
        count: 2,
      }),
    ]);
  });

  it("returns nothing for nothing", () => {
    expect(groupFailures([])).toEqual([]);
  });
});

describe("ranForLabel", () => {
  // The panel used to subtract started_at from scanned_at, which were never
  // apart for a failed row, so every failure said "ran 0.0s".
  it("reads the duration the failure recorded", () => {
    expect(ranForLabel(failed({ durationMs: 4200 }))).toBe("ran 4.2s");
    expect(ranForLabel(failed({ durationMs: 0 }))).toBe("ran 0.0s");
  });

  it("says nothing for a scan that never ran, whose duration is queue time", () => {
    expect(
      ranForLabel(failed({ kind: "quota_refused", durationMs: 90_000 })),
    ).toBeNull();
    expect(
      ranForLabel(failed({ kind: "not_run", durationMs: 90_000 })),
    ).toBeNull();
  });

  it("still says it for a cancel or a timeout, which did run", () => {
    expect(ranForLabel(failed({ kind: "cancelled", durationMs: 12_000 }))).toBe(
      "ran 12.0s",
    );
    expect(ranForLabel(failed({ kind: "timeout", durationMs: 300_000 }))).toBe(
      "ran 300.0s",
    );
  });

  it("says nothing for a duration it cannot read", () => {
    expect(ranForLabel(failed({ durationMs: -1 }))).toBeNull();
    expect(ranForLabel(failed({ durationMs: Number.NaN }))).toBeNull();
  });
});

describe("adminUserHref", () => {
  it("is the deep link the support inbox and the audit log already use", () => {
    expect(adminUserHref(42)).toBe("/admin?tab=users&user=42");
  });
});
