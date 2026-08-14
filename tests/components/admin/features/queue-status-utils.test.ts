/**
 * Unit tests for the pure helpers in
 * components/admin/features/queue-status-utils.ts (formatAge,
 * computeBackedUp), consumed by queue-status-manager.tsx. The manager
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
  formatAge,
  computeBackedUp,
} from "@/components/admin/features/queue-status-utils";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("formatAge", () => {
  it("returns null for a null age", () => {
    expect(formatAge(null)).toBeNull();
  });

  it("reads as a duration, not a timestamp with 'ago' suffix", () => {
    expect(formatAge(5_000)).toBe("just now");
    expect(formatAge(3 * 60_000)).toBe("3m");
    expect(formatAge(2 * 60 * 60_000)).toBe("2h");
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
