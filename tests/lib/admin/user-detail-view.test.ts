/**
 * The lookup a panel refresh needs before it may skip a view row. What the
 * predicates select is proved in tests/integration/user-detail-view.test.ts;
 * this pins the binding, so the window and the two ids never become
 * interpolated text.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { hasRecentUserDetailView, USER_DETAIL_VIEW_WINDOW_MINUTES } =
  await import("@/lib/admin/user-detail-view");

beforeEach(() => {
  mockQuery.mockReset();
});

describe("hasRecentUserDetailView", () => {
  it("binds the admin, the account and the window", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ viewed: 1 }] });
    expect(await hasRecentUserDetailView(2, 9)).toBe(true);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toContain("action = 'view_user_detail'");
    expect(String(sql)).toContain("admin_id = $1");
    expect(String(sql)).toContain("target_user_id = $2");
    expect(String(sql)).toContain("make_interval(mins => $3)");
    expect(params).toEqual([2, 9, USER_DETAIL_VIEW_WINDOW_MINUTES]);
  });

  it("answers false when nothing is on record", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await hasRecentUserDetailView(2, 9)).toBe(false);
  });
});
