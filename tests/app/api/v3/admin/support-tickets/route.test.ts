/**
 * Route tests for GET /api/v3/admin/support-tickets (staff inbox).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockRequirePermission = vi.fn();
vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: () => mockRequirePermission(),
}));

const { GET } = await import("@/app/api/v3/admin/support-tickets/route");

function getRequest(query = "") {
  return new NextRequest(
    `http://localhost/api/v3/admin/support-tickets${query}`,
    { method: "GET" },
  );
}

beforeEach(() => {
  mockQuery.mockReset();
  mockRequirePermission.mockReset();
  mockRequirePermission.mockResolvedValue({ userId: 1, role: "support" });
  mockQuery.mockResolvedValue({ rows: [] });
});

describe("GET /api/v3/admin/support-tickets", () => {
  it("403s without the manage-support permission", async () => {
    mockRequirePermission.mockResolvedValueOnce(null);
    const res = await GET(getRequest());
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns the active queue plus per-status counts by default", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { id: 1, subject: "Help", status: "open", owner_email: "a@b.c" },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { status: "open", n: 3 },
          { status: "resolved", n: 5 },
        ],
      });
    const res = await GET(getRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.tickets).toHaveLength(1);
    expect(body.counts).toEqual({ open: 3, resolved: 5 });
    // Default hides resolved/closed.
    expect(mockQuery.mock.calls[0][0]).toContain("t.status IN");
  });

  it("filters to a single status when asked", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await GET(getRequest("?status=resolved"));
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("WHERE t.status = $1");
    expect(params).toEqual(["resolved"]);
  });

  it("returns everything when status=all", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await GET(getRequest("?status=all"));
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).not.toContain("WHERE t.status");
  });
});
