import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Vulnerability } from "@/lib/scanner/types";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSetting = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

const { applyAdaptiveConfidence, _resetCheckAccuracyCacheForTests } =
  await import("@/lib/scanner/adaptive-confidence");

function finding(overrides: Partial<Vulnerability> = {}): Vulnerability {
  return {
    id: "missing-hsts--abc123",
    title: "Missing HSTS header",
    severity: "medium",
    category: "headers",
    description: "d",
    evidence: "e",
    riskImpact: "r",
    explanation: "x",
    fixSteps: [],
    codeExamples: [],
    confidence: 90,
    ...overrides,
  };
}

function settings(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    ADAPTIVE_CONFIDENCE_ENABLED: true,
    ENGINE_FEEDBACK_MIN_SAMPLE_SIZE: 5,
    ENGINE_FEEDBACK_NOISE_THRESHOLD_PERCENT: 20,
    ...overrides,
  };
  mockGetSetting.mockImplementation(async (key: string) => defaults[key]);
}

function feedbackRows(
  rows: { finding_id: string; verdict: string; count: number }[],
) {
  mockQuery.mockResolvedValue({ rows });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSetting.mockReset();
  _resetCheckAccuracyCacheForTests();
  settings();
  feedbackRows([]);
});

describe("applyAdaptiveConfidence", () => {
  it("returns findings unchanged (same array) when there are none", async () => {
    const result = await applyAdaptiveConfidence([]);
    expect(result).toEqual([]);
    expect(mockGetSetting).not.toHaveBeenCalled();
  });

  it("leaves findings untouched when ADAPTIVE_CONFIDENCE_ENABLED is off", async () => {
    settings({ ADAPTIVE_CONFIDENCE_ENABLED: false });
    const input = [finding()];
    const result = await applyAdaptiveConfidence(input);
    expect(result).toBe(input);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("leaves a finding's confidence untouched when its check has no feedback at all", async () => {
    feedbackRows([]);
    const result = await applyAdaptiveConfidence([finding({ confidence: 90 })]);
    expect(result[0].confidence).toBe(90);
  });

  it("leaves confidence untouched when feedback exists but sample size is below the threshold", async () => {
    feedbackRows([
      { finding_id: "missing-hsts--x", verdict: "false_positive", count: 4 },
    ]); // total = 4, below ENGINE_FEEDBACK_MIN_SAMPLE_SIZE (5)
    const result = await applyAdaptiveConfidence([finding({ confidence: 90 })]);
    expect(result[0].confidence).toBe(90);
  });

  it("leaves confidence untouched when the false-positive rate is below the noise threshold", async () => {
    feedbackRows([
      { finding_id: "missing-hsts--x", verdict: "confirmed", count: 9 },
      { finding_id: "missing-hsts--y", verdict: "false_positive", count: 1 },
    ]); // total = 10, FP rate = 10%, below 20% threshold
    const result = await applyAdaptiveConfidence([finding({ confidence: 90 })]);
    expect(result[0].confidence).toBe(90);
  });

  it("discounts confidence proportionally to the false-positive rate once a check is flagged", async () => {
    feedbackRows([
      { finding_id: "missing-hsts--x", verdict: "confirmed", count: 6 },
      { finding_id: "missing-hsts--y", verdict: "false_positive", count: 4 },
    ]); // total = 10 (>= 5), FP rate = 40% (>= 20%) -> flagged
    const result = await applyAdaptiveConfidence([finding({ confidence: 90 })]);
    // 90 * (1 - 0.4) = 54
    expect(result[0].confidence).toBe(54);
  });

  it("never floors confidence below 0", async () => {
    feedbackRows([
      { finding_id: "missing-hsts--x", verdict: "false_positive", count: 10 },
    ]); // 100% false-positive rate
    const result = await applyAdaptiveConfidence([finding({ confidence: 5 })]);
    expect(result[0].confidence).toBe(0);
  });

  it("leaves a finding with no confidence set at all completely alone", async () => {
    feedbackRows([
      { finding_id: "missing-hsts--x", verdict: "false_positive", count: 10 },
    ]);
    const input = [finding({ confidence: undefined })];
    const result = await applyAdaptiveConfidence(input);
    expect(result[0]).toBe(input[0]);
    expect(result[0].confidence).toBeUndefined();
  });

  it("only adjusts findings for the flagged check, leaving other checks' findings alone", async () => {
    feedbackRows([
      { finding_id: "missing-hsts--x", verdict: "false_positive", count: 10 },
    ]);
    const result = await applyAdaptiveConfidence([
      finding({ id: "missing-hsts--abc", confidence: 90 }),
      finding({
        id: "reflected-input-xss--def",
        confidence: 95,
        title: "Reflected XSS",
      }),
    ]);
    expect(result[0].confidence).toBe(0); // flagged, 100% FP rate
    expect(result[1].confidence).toBe(95); // untouched, no feedback for this check
  });

  it("queries scan_finding_feedback only once across multiple applyAdaptiveConfidence calls within the cache TTL", async () => {
    feedbackRows([
      { finding_id: "missing-hsts--x", verdict: "confirmed", count: 5 },
    ]);
    await applyAdaptiveConfidence([finding()]);
    await applyAdaptiveConfidence([finding()]);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("fails open (returns findings unmodified) when the settings lookup throws", async () => {
    mockGetSetting.mockRejectedValue(new Error("settings resolver down"));
    const input = [finding({ confidence: 90 })];
    const result = await applyAdaptiveConfidence(input);
    expect(result).toBe(input);
  });

  it("fails open when the feedback query itself throws, without crashing the whole pass", async () => {
    mockQuery.mockRejectedValue(new Error("db down"));
    const input = [finding({ confidence: 90 })];
    const result = await applyAdaptiveConfidence(input);
    expect(result[0].confidence).toBe(90);
  });
});
