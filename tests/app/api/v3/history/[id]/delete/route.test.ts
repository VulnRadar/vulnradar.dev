/**
 * Route-level tests for DELETE /api/v3/history/[id]/delete, the alternate
 * delete endpoint (session auth only, no Bearer support).
 *
 * Unlike its sibling history/[id]/route.ts (whose DELETE is scoped in SQL
 * with `WHERE id = $1 AND user_id = $2`), this route checks ownership as a
 * separate SELECT followed by a JS-level `if (scan.user_id !== userId)
 * return 403`, and only then issues `DELETE FROM scan_history WHERE id = $1`
 * with NO user_id filter. The tests below prove the JS gate currently
 * prevents that unscoped DELETE from ever running for a non-owner -- see
 * the final report for why this is a defense-in-depth gap worth flagging
 * even though it isn't exploitable today.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const { DELETE } = await import("@/app/api/v3/history/[id]/delete/route");

function params(id = "55") {
  return { params: Promise.resolve({ id }) };
}

function deleteRequest() {
  return new NextRequest("http://localhost/api/v3/history/55/delete", {
    method: "DELETE",
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 7 });
});

describe("DELETE /api/v3/history/[id]/delete", () => {
  it("rejects an unauthenticated request before touching the database", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await DELETE(deleteRequest(), params());

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 404 when the scan doesn't exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await DELETE(deleteRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Scan not found");
  });

  it("blocks a non-owner with 403 and never issues the (unscoped) DELETE", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, user_id: 99 }], // owned by someone else
    });

    const res = await DELETE(deleteRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe("Only the scan owner can delete it");
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(
      mockQuery.mock.calls.some(([sql]) =>
        String(sql).includes("DELETE FROM scan_history"),
      ),
    ).toBe(false);
  });

  it("deletes the scan for its actual owner", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 55, user_id: 7 }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await DELETE(deleteRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);

    const [sql, sqlParams] = mockQuery.mock.calls[1];
    expect(sql).toContain(
      "DELETE FROM scan_history WHERE id = $1 AND user_id = $2",
    );
    expect(sqlParams).toEqual(["55", 7]);
  });

  it("returns 500 when the DELETE itself fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 55, user_id: 7 }] });
    mockQuery.mockRejectedValueOnce(new Error("db down"));

    const res = await DELETE(deleteRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe("Failed to delete scan");
    consoleSpy.mockRestore();
  });
});
