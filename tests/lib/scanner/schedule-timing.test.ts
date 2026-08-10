import { describe, it, expect } from "vitest";
import {
  FREQUENCIES,
  SCHEDULE_FREQUENCIES,
  isScheduleFrequency,
  jitterCapMinutes,
  jitterMinutesForSchedule,
  computeNextRunAt,
} from "@/lib/scanner/schedule-timing";

describe("FREQUENCIES / isScheduleFrequency", () => {
  it("declares all five frequencies with hours matching their cadence", () => {
    expect(FREQUENCIES.hourly.hours).toBe(1);
    expect(FREQUENCIES["6hourly"].hours).toBe(6);
    expect(FREQUENCIES.daily.hours).toBe(24);
    expect(FREQUENCIES.weekly.hours).toBe(24 * 7);
    expect(FREQUENCIES.monthly.hours).toBe(24 * 30);
  });

  it("gates hourly behind elite and 6hourly behind pro, leaving daily/weekly/monthly ungated", () => {
    expect(FREQUENCIES.hourly.minPlan).toBe("elite_supporter");
    expect(FREQUENCIES["6hourly"].minPlan).toBe("pro_supporter");
    expect(FREQUENCIES.daily.minPlan).toBeUndefined();
    expect(FREQUENCIES.weekly.minPlan).toBeUndefined();
    expect(FREQUENCIES.monthly.minPlan).toBeUndefined();
  });

  it("SCHEDULE_FREQUENCIES lists exactly the FREQUENCIES keys", () => {
    expect(SCHEDULE_FREQUENCIES.sort()).toEqual(
      Object.keys(FREQUENCIES).sort(),
    );
  });

  it("accepts every real frequency and rejects garbage", () => {
    for (const freq of SCHEDULE_FREQUENCIES) {
      expect(isScheduleFrequency(freq)).toBe(true);
    }
    expect(isScheduleFrequency("biweekly")).toBe(false);
    expect(isScheduleFrequency(null)).toBe(false);
    expect(isScheduleFrequency(42)).toBe(false);
  });
});

describe("jitterCapMinutes", () => {
  it("caps hourly (60 min interval) at a quarter of the interval", () => {
    expect(jitterCapMinutes(1)).toBe(15);
  });

  it("caps everything 6-hourly and slower at 59 minutes", () => {
    expect(jitterCapMinutes(6)).toBe(59);
    expect(jitterCapMinutes(24)).toBe(59);
    expect(jitterCapMinutes(24 * 7)).toBe(59);
    expect(jitterCapMinutes(24 * 30)).toBe(59);
  });

  it("never returns a negative cap", () => {
    expect(jitterCapMinutes(0)).toBe(0);
  });
});

describe("jitterMinutesForSchedule (determinism)", () => {
  it("is a pure function of the schedule id: same id always yields the same offset", () => {
    for (const id of [1, 2, 42, 1000, 999999]) {
      const first = jitterMinutesForSchedule(id, 59);
      const second = jitterMinutesForSchedule(id, 59);
      const third = jitterMinutesForSchedule(id, 59);
      expect(second).toBe(first);
      expect(third).toBe(first);
    }
  });

  it("stays within [0, capMinutes] inclusive across a wide range of ids", () => {
    for (let id = 1; id <= 500; id++) {
      const jitter = jitterMinutesForSchedule(id, 14);
      expect(jitter).toBeGreaterThanOrEqual(0);
      expect(jitter).toBeLessThanOrEqual(14);
    }
  });

  it("returns 0 whenever the cap is 0 or negative, for any id", () => {
    expect(jitterMinutesForSchedule(1, 0)).toBe(0);
    expect(jitterMinutesForSchedule(12345, 0)).toBe(0);
    expect(jitterMinutesForSchedule(7, -5)).toBe(0);
  });

  it("spreads different ids across more than one offset (not a constant function)", () => {
    const offsets = new Set(
      Array.from({ length: 50 }, (_, i) => jitterMinutesForSchedule(i + 1, 59)),
    );
    // With 50 ids over a 0-59 range, a real hash should produce well more
    // than one distinct value -- guards against an accidental `return 0`
    // or a hash that collapses to a single bucket.
    expect(offsets.size).toBeGreaterThan(5);
  });
});

describe("computeNextRunAt", () => {
  // Fixed reference instant: Wednesday 2026-08-12T10:00:00Z.
  const now = new Date("2026-08-12T10:00:00.000Z");

  it("hourly always lands on the next top of the UTC hour, regardless of preferredHourUtc", () => {
    const next = computeNextRunAt(
      1,
      {
        frequency: "hourly",
        preferredHourUtc: 5, // irrelevant for hourly
        preferredDayOfWeek: 1,
        preferredDayOfMonth: 1,
      },
      now,
    );
    expect(next.getTime()).toBeGreaterThan(now.getTime());
    // Next top-of-hour after 10:00 is 11:00, plus jitter (0-15 min for a
    // 60-min interval) -- so it must land within the 11:00-11:15 window.
    expect(next.getUTCHours()).toBe(11);
    expect(next.getUTCMinutes()).toBeLessThanOrEqual(15);
  });

  it("6hourly steps forward in 6-hour multiples of preferredHourUtc", () => {
    const next = computeNextRunAt(
      2,
      {
        frequency: "6hourly",
        preferredHourUtc: 2, // 2, 8, 14, 20
        preferredDayOfWeek: 1,
        preferredDayOfMonth: 1,
      },
      now,
    );
    // now is 10:00; next slot >= now among {2,8,14,20} is 14:00.
    expect(next.getUTCHours()).toBeGreaterThanOrEqual(14);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });

  it("daily lands on the next occurrence of preferredHourUtc, today if it hasn't passed yet", () => {
    const next = computeNextRunAt(
      3,
      {
        frequency: "daily",
        preferredHourUtc: 23,
        preferredDayOfWeek: 1,
        preferredDayOfMonth: 1,
      },
      now,
    );
    expect(next.getUTCDate()).toBe(now.getUTCDate());
    expect(next.getUTCHours()).toBe(23);
  });

  it("daily rolls to tomorrow when preferredHourUtc has already passed today", () => {
    const next = computeNextRunAt(
      4,
      {
        frequency: "daily",
        preferredHourUtc: 3,
        preferredDayOfWeek: 1,
        preferredDayOfMonth: 1,
      },
      now,
    );
    expect(next.getUTCDate()).toBe(now.getUTCDate() + 1);
    expect(next.getUTCHours()).toBe(3);
  });

  it("weekly lands on the next occurrence of preferredDayOfWeek at preferredHourUtc", () => {
    // now is Wednesday (getUTCDay() === 3). Ask for Friday (5) at 09:00.
    const next = computeNextRunAt(
      5,
      {
        frequency: "weekly",
        preferredHourUtc: 9,
        preferredDayOfWeek: 5,
        preferredDayOfMonth: 1,
      },
      now,
    );
    expect(next.getUTCDay()).toBe(5);
    expect(next.getUTCHours()).toBe(9);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
    // Wednesday -> Friday is 2 days away.
    const daysAhead = Math.round(
      (next.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
    );
    expect(daysAhead).toBeGreaterThanOrEqual(1);
    expect(daysAhead).toBeLessThanOrEqual(2);
  });

  it("weekly wraps to next week when the target day/hour already passed this week", () => {
    // Ask for Wednesday (today) at 08:00 -- already passed (now is 10:00).
    const next = computeNextRunAt(
      6,
      {
        frequency: "weekly",
        preferredHourUtc: 8,
        preferredDayOfWeek: 3,
        preferredDayOfMonth: 1,
      },
      now,
    );
    expect(next.getUTCDay()).toBe(3);
    const daysAhead = Math.round(
      (next.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
    );
    expect(daysAhead).toBeGreaterThanOrEqual(6);
    expect(daysAhead).toBeLessThanOrEqual(7);
  });

  it("monthly lands on preferredDayOfMonth at preferredHourUtc, capped at 28", () => {
    const next = computeNextRunAt(
      7,
      {
        frequency: "monthly",
        preferredHourUtc: 12,
        preferredDayOfWeek: 1,
        preferredDayOfMonth: 28,
      },
      now,
    );
    expect(next.getUTCDate()).toBe(28);
    expect(next.getUTCHours()).toBe(12);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });

  it("monthly treats an out-of-range preferredDayOfMonth as day 28, never crashing", () => {
    const next = computeNextRunAt(
      8,
      {
        frequency: "monthly",
        preferredHourUtc: 0,
        preferredDayOfWeek: 1,
        preferredDayOfMonth: 99,
      },
      now,
    );
    expect(next.getUTCDate()).toBe(28);
  });

  it("always returns an instant strictly after `now`", () => {
    for (const frequency of SCHEDULE_FREQUENCIES) {
      const next = computeNextRunAt(
        99,
        {
          frequency,
          preferredHourUtc: now.getUTCHours(),
          preferredDayOfWeek: now.getUTCDay(),
          preferredDayOfMonth: now.getUTCDate(),
        },
        now,
      );
      expect(next.getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it("is deterministic: same schedule id + prefs + now always produces the same instant", () => {
    const prefs = {
      frequency: "daily" as const,
      preferredHourUtc: 14,
      preferredDayOfWeek: 1,
      preferredDayOfMonth: 1,
    };
    const a = computeNextRunAt(123, prefs, now);
    const b = computeNextRunAt(123, prefs, now);
    expect(a.getTime()).toBe(b.getTime());
  });

  it("different schedule ids with identical prefs can land in different minutes (jitter applied)", () => {
    const prefs = {
      frequency: "daily" as const,
      preferredHourUtc: 14,
      preferredDayOfWeek: 1,
      preferredDayOfMonth: 1,
    };
    const times = new Set(
      Array.from({ length: 30 }, (_, i) =>
        computeNextRunAt(i + 1, prefs, now).getTime(),
      ),
    );
    expect(times.size).toBeGreaterThan(1);
  });
});
