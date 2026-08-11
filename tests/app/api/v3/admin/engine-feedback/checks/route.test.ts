/**
 * Route-level tests for GET /api/v3/admin/engine-feedback/checks: the
 * per-check false-positive-rate aggregation over scan_finding_feedback
 * (Admin > Engine Feedback panel, Piece 2 of the engine feedback/learning
 * loop feature).
 *
 * Auth goes through the shared requireAdmin() (lib/auth/authorization.ts),
 * which itself calls getSession() and a pool.query role lookup -- both
 * mocked here, the same "mock at the getSession/db boundary" approach
 * tests/app/api/v3/admin/error-logs/route.test.ts uses. getSetting and
 * getCheckDef are mocked at their own module boundaries so this file
 * doesn't depend on the real settings table or the full check registry.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const SETTING_DEFAULTS: Record<string, number> = {
  ENGINE_FEEDBACK_NOISE_THRESHOLD_PERCENT: 20,
  ENGINE_FEEDBACK_MIN_SAMPLE_SIZE: 5,
};
const mockGetSetting = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

const mockGetCheckDef = vi.fn();
vi.mock("@/lib/scanner/registry", () => ({
  getCheckDef: (...args: unknown[]) => mockGetCheckDef(...args),
}));

const { GET } = await import("@/app/api/v3/admin/engine-feedback/checks/route");

function withAdmin(userId = 7, role = "admin") {
  mockGetSession.mockResolvedValue({ userId });
  mockQuery.mockResolvedValueOnce({ rows: [{ id: userId, role }] });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSetting.mockReset();
  mockGetSetting.mockImplementation(
    async (key: string) => SETTING_DEFAULTS[key],
  );
  mockGetCheckDef.mockReset();
  mockGetCheckDef.mockReturnValue(undefined);
});

describe("GET /api/v3/admin/engine-feedback/checks", () => {
  it("requires a session", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a caller below admin (e.g. support)", async () => {
    mockGetSession.mockResolvedValue({ userId: 3 });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 3, role: "support" }] });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("groups feedback by finding_id's checkId (everything before the last --) and sums verdicts", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          finding_id: "cors-wildcard--ab12",
          verdict: "false_positive",
          count: 3,
        },
        { finding_id: "cors-wildcard--cd34", verdict: "confirmed", count: 2 },
        {
          finding_id: "cors-wildcard--ef56",
          verdict: "not_applicable",
          count: 1,
        },
        { finding_id: "hsts-missing--gh78", verdict: "confirmed", count: 4 },
      ],
    });
    mockGetCheckDef.mockImplementation((id: string) =>
      id === "cors-wildcard"
        ? { title: "CORS Wildcard", category: "headers", severity: "medium" }
        : { title: "HSTS Missing", category: "headers", severity: "high" },
    );

    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.checks).toHaveLength(2);

    const cors = json.checks.find(
      (c: { checkId: string }) => c.checkId === "cors-wildcard",
    );
    expect(cors).toMatchObject({
      title: "CORS Wildcard",
      category: "headers",
      severity: "medium",
      confirmed: 2,
      falsePositive: 3,
      notApplicable: 1,
      total: 6,
    });
    // 3/6 = 50%
    expect(cors.falsePositiveRate).toBe(50);

    const hsts = json.checks.find(
      (c: { checkId: string }) => c.checkId === "hsts-missing",
    );
    expect(hsts.total).toBe(4);
    expect(hsts.falsePositiveRate).toBe(0);
  });

  it("flags a check only when it clears BOTH the threshold and the minimum sample size", async () => {
    withAdmin();
    mockGetSetting.mockImplementation(async (key: string) =>
      key === "ENGINE_FEEDBACK_NOISE_THRESHOLD_PERCENT" ? 20 : 5,
    );
    mockQuery.mockResolvedValueOnce({
      rows: [
        // 1 sample, 100% false positive -- below the minimum sample size,
        // must NOT be flagged despite a high rate.
        { finding_id: "low-sample--aa", verdict: "false_positive", count: 1 },
        // 5 samples, 40% false positive -- clears both, must be flagged.
        { finding_id: "noisy-check--bb", verdict: "false_positive", count: 2 },
        { finding_id: "noisy-check--cc", verdict: "confirmed", count: 3 },
      ],
    });

    const res = await GET();
    const json = await res.json();
    const lowSample = json.checks.find(
      (c: { checkId: string }) => c.checkId === "low-sample",
    );
    const noisy = json.checks.find(
      (c: { checkId: string }) => c.checkId === "noisy-check",
    );
    expect(lowSample.flagged).toBe(false);
    expect(noisy.flagged).toBe(true);
    expect(json.thresholdPercent).toBe(20);
    expect(json.minSampleSize).toBe(5);
  });

  it("falls back to the raw checkId as the title when the registry has no matching check", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({
      rows: [
        { finding_id: "retired-check--zz", verdict: "confirmed", count: 1 },
      ],
    });
    mockGetCheckDef.mockReturnValue(undefined);

    const res = await GET();
    const json = await res.json();
    expect(json.checks[0]).toMatchObject({
      checkId: "retired-check",
      title: "retired-check",
      category: null,
      severity: null,
    });
  });

  it("sorts checks by false-positive rate descending", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({
      rows: [
        { finding_id: "a--1", verdict: "confirmed", count: 10 },
        { finding_id: "a--2", verdict: "false_positive", count: 1 },
        { finding_id: "b--1", verdict: "false_positive", count: 9 },
        { finding_id: "b--2", verdict: "confirmed", count: 1 },
      ],
    });

    const res = await GET();
    const json = await res.json();
    expect(json.checks.map((c: { checkId: string }) => c.checkId)).toEqual([
      "b",
      "a",
    ]);
  });

  it("returns a graceful 500 when the query fails", async () => {
    withAdmin();
    mockQuery.mockRejectedValueOnce(new Error("db exploded"));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
