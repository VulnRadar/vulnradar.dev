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
  it("offers only values the share route accepts", () => {
    expect(EXPIRY_PRESETS.map((p) => p.days)).toEqual([null, 7, 30, 90]);
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

  it("still resolves to a preset for an already-expired link", () => {
    // Negative remaining time is closest to 7, the shortest window, which is
    // what the modal lights up beside its "this link stopped working" copy.
    expect(activePreset(inDays(-3))).toBe(7);
  });

  it("treats an unparseable timestamp as no expiry rather than throwing", () => {
    expect(activePreset("not-a-date")).toBeNull();
  });
});
