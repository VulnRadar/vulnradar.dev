import { describe, it, expect } from "vitest";
import { todayStamp } from "@/lib/ui/clock";

describe("todayStamp", () => {
  it("is the UTC calendar date, the form export file names use", () => {
    expect(todayStamp(new Date("2026-10-26T23:59:59Z"))).toBe("2026-10-26");
    expect(todayStamp(new Date("2026-10-27T00:00:00Z"))).toBe("2026-10-27");
  });
});
