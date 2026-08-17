import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { extractCheckId, aggregateCheckAccuracy } =
  await import("@/lib/scanner/check-accuracy");

beforeEach(() => {
  mockQuery.mockReset();
});

describe("extractCheckId", () => {
  it("strips everything from the last '--' onward", () => {
    expect(extractCheckId("missing-hsts-header--a1b2c3")).toBe(
      "missing-hsts-header",
    );
  });

  it("uses the LAST occurrence when a check id itself contains '--'", () => {
    expect(extractCheckId("some--weird--id--hash")).toBe("some--weird--id");
  });

  it("returns the input unchanged when there is no '--' separator at all", () => {
    expect(extractCheckId("no-separator-here")).toBe("no-separator-here");
  });
});

describe("aggregateCheckAccuracy", () => {
  it("aggregates verdict counts per check and computes a rounded false-positive rate", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        { finding_id: "missing-hsts--aaa", verdict: "confirmed", count: 7 },
        {
          finding_id: "missing-hsts--bbb",
          verdict: "false_positive",
          count: 3,
        },
        {
          finding_id: "missing-hsts--ccc",
          verdict: "not_applicable",
          count: 2,
        },
      ],
    });

    const result = await aggregateCheckAccuracy();
    const entry = result.get("missing-hsts");
    expect(entry).toEqual({
      confirmed: 7,
      falsePositive: 3,
      notApplicable: 2,
      total: 12,
      falsePositiveRate: 25, // 3/12 = 25.0%
    });
  });

  it("keeps different checks in separate buckets", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        { finding_id: "check-a--x", verdict: "confirmed", count: 1 },
        { finding_id: "check-b--y", verdict: "false_positive", count: 1 },
      ],
    });

    const result = await aggregateCheckAccuracy();
    expect(result.get("check-a")?.falsePositiveRate).toBe(0);
    expect(result.get("check-b")?.falsePositiveRate).toBe(100);
  });

  it("returns an empty map when there is no feedback at all", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const result = await aggregateCheckAccuracy();
    expect(result.size).toBe(0);
  });

  it("rounds the false-positive rate to one decimal place", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        { finding_id: "flaky--a", verdict: "confirmed", count: 2 },
        { finding_id: "flaky--b", verdict: "false_positive", count: 1 },
      ],
    });
    const result = await aggregateCheckAccuracy();
    // 1/3 = 33.333...% -> rounded to one decimal.
    expect(result.get("flaky")?.falsePositiveRate).toBe(33.3);
  });
});
