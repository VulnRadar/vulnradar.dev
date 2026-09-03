/**
 * The share modal's expiry presets have to line up with what the route will
 * actually accept: ALLOWED_EXPIRY_DAYS in
 * app/api/v3/history/[id]/share/route.ts is exactly {7, 30, 90}, plus null for
 * "never". Offering anything else in the picker produces a 400 the user cannot
 * act on, so the two lists are asserted against each other here.
 */
import { describe, it, expect } from "vitest";
import {
  EXPIRY_PRESETS,
  activePreset,
} from "@/components/scanner/share-expiry";

const DAY_MS = 86_400_000;

function inDays(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

describe("EXPIRY_PRESETS", () => {
  // Order changed from [null, 7, 30, 90]: "never" is the unbounded end of the
  // same scale the other three sit on, and the first slot in a radiogroup is
  // where reflex clicks and keyboard focus land, which is the wrong home for
  // "this link to a security report never stops working". The set of values is
  // unchanged and still exactly what the route accepts.
  it("offers only values the share route accepts, shortest window first", () => {
    expect(EXPIRY_PRESETS.map((p) => p.days)).toEqual([7, 30, 90, null]);
  });
});

describe("activePreset", () => {
  it("selects nothing for a share with no expiry", () => {
    expect(activePreset(null)).toBeNull();
  });

  it("selects the preset a freshly set expiry was created from", () => {
    expect(activePreset(inDays(7))).toBe(7);
    expect(activePreset(inDays(30))).toBe(30);
    expect(activePreset(inDays(90))).toBe(90);
  });

  it("reports the closest preset to what is actually left as the link ages", () => {
    // A 90-day link with 25 days to run reads as the 30-day preset: the
    // original choice is not recoverable from the stored timestamp, so the
    // control reflects the remaining window rather than inventing history.
    expect(activePreset(inDays(25))).toBe(30);
    expect(activePreset(inDays(4))).toBe(7);
  });

  // Was: "still resolves to a preset for an already-expired link", asserting
  // 7. That behaviour was the bug. Negative remaining time is arithmetically
  // nearest 7, so the modal drew "7 days" as the checked radio beside copy
  // telling the reader to pick a new window, and the modal skipped its change
  // handler for the checked radio: the obvious button on that screen did
  // nothing at all. An expired link matches no window, so it claims none and
  // every button is live.
  it("claims no preset for an already-expired link", () => {
    expect(activePreset(inDays(-3))).toBeNull();
    expect(activePreset(inDays(-400))).toBeNull();
  });

  // Same rule at the other end. The route will only ever issue 7, 30 or 90,
  // so a longer expiry came from a legacy row or a direct database write, and
  // "90 days" would be a flat misstatement of what the link carries.
  it("claims no preset for an expiry longer than any window", () => {
    expect(activePreset(inDays(200))).toBeNull();
  });

  it("still claims 90 for a freshly issued 90-day link despite clock skew", () => {
    // The server resolves now + 90 days and the browser reads it back against
    // its own clock, so the remaining time can round a hair over 90.
    expect(activePreset(inDays(90.2))).toBe(90);
  });

  it("treats an unparseable timestamp as no expiry rather than throwing", () => {
    expect(activePreset("not-a-date")).toBeNull();
  });
});
