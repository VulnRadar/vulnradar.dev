/**
 * The gift expiry field, for an admin who is not in UTC.
 *
 * The field is a datetime-local input, which reads its string as local
 * wall-clock time. The modal filled it with `toISOString().slice(0, 16)`, so a
 * gift ending 15:30 UTC opened as 15:30 local and, saved untouched, ended five
 * hours later in New York. Every open-and-save of an existing gift moved the
 * expiry by the admin's own UTC offset.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/New_York";
});
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

const {
  giftEndDateInputValue,
  giftEndDateIsPast,
  giftEndDateToIso,
  giftMinInputValue,
} = await import("@/components/admin/users/gift-dates");

describe("gift expiry round trip under America/New_York", () => {
  it("fills the field with local wall-clock time", () => {
    // December: EST, UTC-5.
    expect(giftEndDateInputValue("2026-12-25T15:30:00.000Z")).toBe(
      "2026-12-25T10:30",
    );
    // July: EDT, UTC-4.
    expect(giftEndDateInputValue("2026-07-04T15:30:00.000Z")).toBe(
      "2026-07-04T11:30",
    );
  });

  it("saving an untouched field sends the instant that was stored", () => {
    for (const stored of [
      "2026-12-25T15:30:00.000Z",
      "2026-07-04T15:30:00.000Z",
      "2026-03-08T07:00:00.000Z",
    ]) {
      expect(giftEndDateToIso(giftEndDateInputValue(stored))).toBe(stored);
    }
  });

  it("is not the UTC slice the old code used", () => {
    const stored = "2026-12-25T15:30:00.000Z";
    expect(giftEndDateInputValue(stored)).not.toBe(stored.slice(0, 16));
  });

  it("is empty for no gift and for an unreadable date", () => {
    expect(giftEndDateInputValue(null)).toBe("");
    expect(giftEndDateInputValue(undefined)).toBe("");
    expect(giftEndDateInputValue("not a date")).toBe("");
  });
});

describe("the minimum and the past check", () => {
  const now = Date.parse("2026-12-25T15:30:45.000Z");

  it("sets min to the current minute in local time", () => {
    expect(giftMinInputValue(now)).toBe("2026-12-25T10:30");
  });

  it("refuses an expiry that is not in the future", () => {
    expect(giftEndDateIsPast("2026-12-25T10:00", now)).toBe(true);
    expect(giftEndDateIsPast("2026-12-25T10:30", now)).toBe(true);
    expect(giftEndDateIsPast("2026-12-25T11:00", now)).toBe(false);
    expect(giftEndDateIsPast("", now)).toBe(true);
  });
});
