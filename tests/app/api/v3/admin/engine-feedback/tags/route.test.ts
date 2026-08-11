/**
 * Route-level tests for GET /api/v3/admin/engine-feedback/tags: the
 * per-auto-tag-rule dismissal-rate aggregation over scan_tags (source =
 * 'auto') and auto_tag_dismissals (Admin > Engine Feedback panel, Piece 1
 * of the engine feedback/learning loop feature).
 *
 * Auth mocking mirrors tests/app/api/v3/admin/error-logs/route.test.ts.
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

const { GET } = await import("@/app/api/v3/admin/engine-feedback/tags/route");

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
});

describe("GET /api/v3/admin/engine-feedback/tags", () => {
  it("requires a session", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a caller below admin", async () => {
    mockGetSession.mockResolvedValue({ userId: 3 });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 3, role: "support" }] });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("reconstructs totalFired from the still-attached count plus the dismissed count", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({
      rows: [
        // Still attached to 6 scans, dismissed on 4 more -- 10 total fires,
        // 40% dismissal rate.
        { tag: "XSS Risk", applied_count: 6, dismissed_count: 4 },
        // Never dismissed.
        { tag: "Clean", applied_count: 20, dismissed_count: 0 },
      ],
    });

    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);

    const xss = json.tags.find((t: { tag: string }) => t.tag === "XSS Risk");
    expect(xss).toMatchObject({
      totalFired: 10,
      dismissedCount: 4,
      dismissalRate: 40,
    });

    const clean = json.tags.find((t: { tag: string }) => t.tag === "Clean");
    expect(clean).toMatchObject({
      totalFired: 20,
      dismissedCount: 0,
      dismissalRate: 0,
    });
  });

  it("issues a single FULL OUTER JOIN query across scan_tags and auto_tag_dismissals", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await GET();

    const [sql] = mockQuery.mock.calls[1];
    expect(sql).toContain("FROM scan_tags WHERE source = 'auto'");
    expect(sql).toContain("FROM auto_tag_dismissals");
    expect(sql).toContain("FULL OUTER JOIN");
  });

  it("flags a tag rule only when it clears BOTH the threshold and the minimum sample size", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({
      rows: [
        // 3 fires total, 100% dismissed -- below the minimum sample size.
        { tag: "Low Sample Rule", applied_count: 0, dismissed_count: 3 },
        // 10 fires total, 30% dismissed -- clears both.
        { tag: "Noisy Rule", applied_count: 7, dismissed_count: 3 },
      ],
    });

    const res = await GET();
    const json = await res.json();
    const lowSample = json.tags.find(
      (t: { tag: string }) => t.tag === "Low Sample Rule",
    );
    const noisy = json.tags.find(
      (t: { tag: string }) => t.tag === "Noisy Rule",
    );
    expect(lowSample.flagged).toBe(false);
    expect(noisy.flagged).toBe(true);
    expect(json.thresholdPercent).toBe(20);
    expect(json.minSampleSize).toBe(5);
  });

  it("sorts tags by dismissal rate descending", async () => {
    withAdmin();
    mockQuery.mockResolvedValueOnce({
      rows: [
        { tag: "low", applied_count: 9, dismissed_count: 1 },
        { tag: "high", applied_count: 1, dismissed_count: 9 },
      ],
    });

    const res = await GET();
    const json = await res.json();
    expect(json.tags.map((t: { tag: string }) => t.tag)).toEqual([
      "high",
      "low",
    ]);
  });

  it("returns a graceful 500 when the query fails", async () => {
    withAdmin();
    mockQuery.mockRejectedValueOnce(new Error("db exploded"));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
