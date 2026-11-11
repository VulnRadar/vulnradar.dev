/**
 * GET /api/v3/ai/info: whether AI is set up, and whether the signed-in
 * caller switched it off. The chat widget, the dashboard and the scan menu
 * hide their AI actions on `aiDisabled`, so a failed read of the switch has to
 * answer "off" rather than offering AI to someone who turned it off.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const { GET } = await import("@/app/api/v3/ai/info/route");

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 7 });
});

describe("GET /api/v3/ai/info", () => {
  it("reports the caller's own switch", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ai_disabled: true }] });
    const json = await (await GET()).json();
    expect(json.aiDisabled).toBe(true);
    expect(mockQuery.mock.calls[0][1]).toEqual([7]);
  });

  it("reports AI as on for an account with no saved setting", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const json = await (await GET()).json();
    expect(json.aiDisabled).toBe(false);
  });

  it("reports AI as off when the switch cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockQuery.mockRejectedValueOnce(new Error("connection reset"));
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.aiDisabled).toBe(true);
  });

  it("does not read any setting for an anonymous caller", async () => {
    mockGetSession.mockResolvedValue(null);
    const json = await (await GET()).json();
    expect(json.aiDisabled).toBe(false);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
