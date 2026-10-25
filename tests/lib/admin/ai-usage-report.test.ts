import { describe, it, expect, beforeEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockWindow = vi.fn();
vi.mock("@/lib/billing/ai-usage", () => ({
  resolveCurrentWindow: (...a: unknown[]) => mockWindow(...a),
}));

const { getAiUsageReport, AI_USAGE_WINDOWS_SHOWN, AI_USAGE_TOP_USERS } =
  await import("@/lib/admin/ai-usage-report");

const WINDOW_START = new Date("2026-10-10T10:00:00.000Z");

beforeEach(() => {
  mockQuery.mockReset();
  mockWindow.mockReset();
  mockWindow.mockResolvedValue({ windowStart: WINDOW_START, windowHours: 5 });
});

describe("getAiUsageReport", () => {
  it("bounds the history by time, because ai_usage has no window_start index", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await getAiUsageReport();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("WHERE window_start >= $1");
    expect(sql).toContain(`LIMIT ${AI_USAGE_WINDOWS_SHOWN}`);
    // 30 five-hour windows ending at the current one: 29 steps (145 hours) back.
    expect((params[0] as Date).toISOString()).toBe("2026-10-04T09:00:00.000Z");
  });

  it("limits the leaderboard to the one window it names", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await getAiUsageReport();
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain("WHERE a.window_start = $1");
    expect(sql).toContain(`LIMIT ${AI_USAGE_TOP_USERS}`);
    expect(params[0]).toBe(WINDOW_START);
  });

  it("reads the two queries one after the other", async () => {
    const order: string[] = [];
    mockQuery.mockImplementation(async (sql: string) => {
      order.push(sql.includes("GROUP BY") ? "windows:start" : "top:start");
      await Promise.resolve();
      order.push(sql.includes("GROUP BY") ? "windows:end" : "top:end");
      return { rows: [] };
    });
    await getAiUsageReport();
    expect(order).toEqual([
      "windows:start",
      "windows:end",
      "top:start",
      "top:end",
    ]);
  });

  it("coerces the bigint SUM that node-postgres returns as a string", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          window_start: new Date("2026-10-10T10:00:00.000Z"),
          tokens_used: "1234567",
          users: 3,
        },
        {
          window_start: "2026-10-10T05:00:00.000Z",
          tokens_used: "40",
          users: "1",
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 4, email: "a@example.test", name: null, tokens_used: 900 }],
    });
    const report = await getAiUsageReport();
    expect(report.windowHours).toBe(5);
    expect(report.currentWindowStart).toBe("2026-10-10T10:00:00.000Z");
    expect(report.windows).toEqual([
      {
        windowStart: "2026-10-10T10:00:00.000Z",
        tokensUsed: 1234567,
        users: 3,
      },
      { windowStart: "2026-10-10T05:00:00.000Z", tokensUsed: 40, users: 1 },
    ]);
    expect(report.topUsers).toEqual([
      { id: 4, email: "a@example.test", name: null, tokensUsed: 900 },
    ]);
  });
});
