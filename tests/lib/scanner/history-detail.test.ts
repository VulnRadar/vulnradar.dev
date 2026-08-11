/**
 * Coverage for mapHistoryDetailResponse (lib/scanner/history-detail.ts), the
 * shared mapper extracted after app/history/page.tsx and
 * components/repos/repo-detail.tsx each hand-rolled their own field list
 * from GET /api/v3/history/[id] and both silently dropped `aiSummary` --
 * the field a generated "AI summary" is returned under -- so a newly
 * generated (or previously generated) summary never reached the screen on
 * either page even though the API response carried it.
 */
import { describe, it, expect } from "vitest";
import {
  mapHistoryDetailResponse,
  type HistoryDetailResponse,
} from "@/lib/scanner/history-detail";

function makeResponse(
  overrides: Partial<HistoryDetailResponse> = {},
): HistoryDetailResponse {
  return {
    url: "https://example.com",
    scannedAt: "2026-01-01T00:00:00.000Z",
    duration: 1200,
    summary: { critical: 1, high: 0, medium: 2, low: 0, info: 0, total: 3 },
    findings: [],
    ...overrides,
  };
}

describe("mapHistoryDetailResponse", () => {
  it("carries aiSummary through when the API response has one", () => {
    const result = mapHistoryDetailResponse(
      makeResponse({ aiSummary: "Two medium findings, nothing urgent." }),
    );

    expect(result.aiSummary).toBe("Two medium findings, nothing urgent.");
  });

  it("leaves aiSummary undefined when the scan has never had one generated", () => {
    const result = mapHistoryDetailResponse(makeResponse());

    expect(result.aiSummary).toBeUndefined();
  });

  it("maps every other ScanResult field the response can carry", () => {
    const response = makeResponse({
      responseHeaders: { "x-frame-options": "DENY" },
      authenticated: true,
      checksRun: 42,
      dangerScore: 7,
      engineConfidence: 95,
      incomplete: ["tls"],
    });

    const result = mapHistoryDetailResponse(response);

    expect(result).toMatchObject({
      url: response.url,
      scannedAt: response.scannedAt,
      duration: response.duration,
      summary: response.summary,
      findings: response.findings,
      responseHeaders: response.responseHeaders,
      authenticated: true,
      checksRun: 42,
      dangerScore: 7,
      engineConfidence: 95,
      incomplete: ["tls"],
    });
  });

  it("defaults authenticated to false rather than leaving it undefined", () => {
    const result = mapHistoryDetailResponse(makeResponse());

    expect(result.authenticated).toBe(false);
  });
});
