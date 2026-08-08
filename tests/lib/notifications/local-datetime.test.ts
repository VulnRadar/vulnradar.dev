import { describe, it, expect, afterEach } from "vitest";
import { toLocalDatetimeInputValue } from "@/lib/notifications/local-datetime";

/**
 * toLocalDatetimeInputValue is the fix for a real, twice-shipped regression:
 * components/admin/notifications/notifications-manager.tsx's "Starts at" /
 * "Ends at" fields have shipped with `date.toISOString().slice(0, 16)`
 * feeding an <input type="datetime-local"> instead. That input treats
 * whatever string it's given as local wall-clock time with no conversion,
 * but toISOString() returns UTC, so the value the field shows (and the
 * value handleSave later re-parses with `new Date(value)`, which again
 * reads it as local time) is off by the admin's UTC offset.
 *
 * For anyone west of UTC that shifts the computed `starts_at` into the
 * future. GET /api/v3/notifications/active requires `starts_at <= now`
 * (app/api/v3/notifications/active/route.ts), so the notification the admin
 * just created silently does not appear until real time catches up to the
 * erroneously shifted timestamp: "I created it and it just doesn't show up."
 *
 * These tests pin the fix against negative and positive UTC offsets so a
 * third revert back to toISOString().slice(0, 16) fails immediately.
 */
describe("toLocalDatetimeInputValue", () => {
  const originalOffset = Date.prototype.getTimezoneOffset;

  function withTimezoneOffsetMinutes(minutes: number, fn: () => void) {
    Date.prototype.getTimezoneOffset = () => minutes;
    try {
      fn();
    } finally {
      Date.prototype.getTimezoneOffset = originalOffset;
    }
  }

  afterEach(() => {
    Date.prototype.getTimezoneOffset = originalOffset;
  });

  it("keeps the local wall-clock time for a negative UTC offset (e.g. US Eastern, UTC-5)", () => {
    // getTimezoneOffset() is positive west of UTC (UTC-5 => +300).
    withTimezoneOffsetMinutes(300, () => {
      // 2026-01-15T12:00:00Z is 07:00 local time at UTC-5.
      const date = new Date("2026-01-15T12:00:00.000Z");
      expect(toLocalDatetimeInputValue(date)).toBe("2026-01-15T07:00");
    });
  });

  it("keeps the local wall-clock time for a positive UTC offset (e.g. Central Europe, UTC+1)", () => {
    // getTimezoneOffset() is negative east of UTC (UTC+1 => -60).
    withTimezoneOffsetMinutes(-60, () => {
      // 2026-01-15T12:00:00Z is 13:00 local time at UTC+1.
      const date = new Date("2026-01-15T12:00:00.000Z");
      expect(toLocalDatetimeInputValue(date)).toBe("2026-01-15T13:00");
    });
  });

  it("does not regress to the UTC-based toISOString().slice(0, 16) implementation", () => {
    withTimezoneOffsetMinutes(300, () => {
      const date = new Date("2026-01-15T12:00:00.000Z");
      const buggyUtcValue = date.toISOString().slice(0, 16);
      expect(toLocalDatetimeInputValue(date)).not.toBe(buggyUtcValue);
    });
  });
});
