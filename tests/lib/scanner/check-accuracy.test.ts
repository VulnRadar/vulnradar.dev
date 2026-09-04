import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const {
  extractCheckId,
  aggregateCheckAccuracy,
  assessCheckAccuracy,
  wilsonLowerBound,
  neverConfirmedFloor,
  fetchCheckFeedbackVerdicts,
} = await import("@/lib/scanner/check-accuracy");

const RULE = { thresholdPercent: 20, minSampleSize: 5 };

function counts(
  confirmed: number,
  falsePositive: number,
  notApplicable = 0,
): {
  confirmed: number;
  falsePositive: number;
  notApplicable: number;
  total: number;
  falsePositiveRate: number;
} {
  const total = confirmed + falsePositive + notApplicable;
  return {
    confirmed,
    falsePositive,
    notApplicable,
    total,
    falsePositiveRate:
      total > 0 ? Math.round((falsePositive / total) * 1000) / 10 : 0,
  };
}

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

describe("wilsonLowerBound", () => {
  it("ranks a single 100% report below a well-evidenced 60%", () => {
    // The whole point: raw rate says 100% > 60%, which put every n=1
    // report at the top of the admin panel.
    expect(wilsonLowerBound(1, 1)).toBeLessThan(wilsonLowerBound(6, 10));
  });

  it("rises with more of the same evidence", () => {
    expect(wilsonLowerBound(1, 1)).toBeLessThan(wilsonLowerBound(5, 5));
    expect(wilsonLowerBound(5, 5)).toBeLessThan(wilsonLowerBound(50, 50));
  });

  it("is zero with no samples and with no false positives", () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
    expect(wilsonLowerBound(0, 10)).toBe(0);
  });
});

describe("neverConfirmedFloor", () => {
  it("needs one report for critical and high, two otherwise", () => {
    expect(neverConfirmedFloor("critical")).toBe(1);
    expect(neverConfirmedFloor("high")).toBe(1);
    expect(neverConfirmedFloor("medium")).toBe(2);
    expect(neverConfirmedFloor("low")).toBe(2);
    expect(neverConfirmedFloor("info")).toBe(2);
    // Unknown severity gets the cautious floor, not the loud one.
    expect(neverConfirmedFloor(null)).toBe(2);
    expect(neverConfirmedFloor("bogus")).toBe(2);
  });
});

describe("assessCheckAccuracy", () => {
  it("leaves the configured threshold + sample-size rule exactly as it was", () => {
    // 20% of 5 samples: the existing rule, still flagged.
    expect(assessCheckAccuracy(counts(3, 1, 1), "low", RULE).flagged).toBe(
      true,
    );
    // Same rate, one sample short.
    expect(assessCheckAccuracy(counts(3, 1), "low", RULE).flagged).toBe(false);
    // Enough samples, under the rate.
    expect(assessCheckAccuracy(counts(9, 1), "low", RULE).flagged).toBe(false);
  });

  it("surfaces a critical that has never been confirmed at a single report", () => {
    // The real case from production: credit-card-pattern, 0 confirmed,
    // 1 false positive. Invisible to the sample-size rule.
    const critical = assessCheckAccuracy(counts(0, 1), "critical", RULE);
    expect(critical.flagged).toBe(false);
    expect(critical.neverConfirmed).toBe(true);

    const high = assessCheckAccuracy(counts(0, 1), "high", RULE);
    expect(high.neverConfirmed).toBe(true);
  });

  it("does not surface a single unconfirmed report on a low check", () => {
    // This is the n=1 noise the floor exists to keep off the page.
    expect(assessCheckAccuracy(counts(0, 1), "low", RULE).neverConfirmed).toBe(
      false,
    );
    // Two reports and still never confirmed does surface, whatever the
    // severity: csp-incompatible-directives, 0 confirmed / 2 false.
    expect(assessCheckAccuracy(counts(0, 2), "low", RULE).neverConfirmed).toBe(
      true,
    );
  });

  it("never calls a check unconfirmed once someone has confirmed it", () => {
    expect(
      assessCheckAccuracy(counts(1, 9), "critical", RULE).neverConfirmed,
    ).toBe(false);
  });

  it("ranks a never-confirmed critical above a low check sitting at the old threshold", () => {
    // The exact inversion the flat rule produced: vary-header-missing
    // (low, 3 confirmed / 1 false / 5 total) was flagged, while
    // credit-card-pattern (critical, 0 confirmed / 1 false) was not even
    // visible.
    const criticalNeverConfirmed = assessCheckAccuracy(
      counts(0, 1),
      "critical",
      RULE,
    );
    const lowAtThreshold = assessCheckAccuracy(counts(3, 1, 1), "low", RULE);
    expect(criticalNeverConfirmed.priority).toBeGreaterThan(
      lowAtThreshold.priority,
    );
  });

  it("ranks ten reports at 60% above one report at 100% at the same severity", () => {
    const evidenced = assessCheckAccuracy(counts(4, 6), "medium", RULE);
    const anecdote = assessCheckAccuracy(counts(0, 1), "medium", RULE);
    expect(evidenced.priority).toBeGreaterThan(anecdote.priority);
    // ...and the anecdote is still visible rather than sorted to zero.
    expect(anecdote.priority).toBeGreaterThan(0);
  });

  it("gives a clean check no priority at all", () => {
    expect(assessCheckAccuracy(counts(10, 0), "critical", RULE).priority).toBe(
      0,
    );
  });
});

describe("fetchCheckFeedbackVerdicts", () => {
  it("groups rows under the check id and truncates nothing that fits", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: 2,
          finding_id: "credit-card-pattern--aa",
          finding_url: "https://shop.example.com/orders/12345",
          verdict: "false_positive",
          notes: "  that is an order number, not a card  ",
          created_at: "2026-09-01T10:00:00Z",
        },
        {
          id: 1,
          finding_id: "other-check--bb",
          finding_url: "https://example.com/",
          verdict: "confirmed",
          notes: null,
          created_at: "2026-08-31T10:00:00Z",
        },
      ],
    });

    const result = await fetchCheckFeedbackVerdicts(
      ["credit-card-pattern", "other-check"],
      25,
    );
    expect(result.get("credit-card-pattern")).toEqual([
      {
        id: 2,
        checkId: "credit-card-pattern",
        findingUrl: "https://shop.example.com/orders/12345",
        verdict: "false_positive",
        notes: "that is an order number, not a card",
        createdAt: "2026-09-01T10:00:00.000Z",
      },
    ]);
    expect(result.get("other-check")?.[0].notes).toBe("");
  });

  it("caps each check independently so one noisy check cannot crowd out another", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        ...Array.from({ length: 5 }, (_, i) => ({
          id: i + 10,
          finding_id: `noisy--${i}`,
          finding_url: "https://example.com/",
          verdict: "false_positive",
          notes: "",
          created_at: "2026-09-01T10:00:00Z",
        })),
        {
          id: 1,
          finding_id: "quiet--a",
          finding_url: "https://example.com/",
          verdict: "confirmed",
          notes: "",
          created_at: "2026-08-01T10:00:00Z",
        },
      ],
    });

    const result = await fetchCheckFeedbackVerdicts(["noisy", "quiet"], 2);
    expect(result.get("noisy")).toHaveLength(2);
    expect(result.get("quiet")).toHaveLength(1);
  });

  it("escapes LIKE metacharacters in a check id and keeps requested ids as keys", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await fetchCheckFeedbackVerdicts(["odd_check%name"], 10);
    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(params[1]).toEqual([String.raw`odd\_check\%name--%`]);
  });

  it("does not touch the database when there is nothing to ask for", async () => {
    const result = await fetchCheckFeedbackVerdicts([], 25);
    expect(result.size).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("ignores rows whose real check id was not requested", async () => {
    // `a--b--c` extracts to `a--b`, which a naive `a--%` LIKE would also
    // match; the JS regroup is what keeps a neighbouring check's rows out.
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: 1,
          finding_id: "a--b--c",
          finding_url: "https://example.com/",
          verdict: "confirmed",
          notes: "",
          created_at: "2026-09-01T10:00:00Z",
        },
      ],
    });
    const result = await fetchCheckFeedbackVerdicts(["a"], 25);
    expect(result.get("a")).toEqual([]);
  });
});
