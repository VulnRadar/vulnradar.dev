/**
 * Route-level tests for PUT /api/v3/history/[id]/share/publicly-listed --
 * the per-share override for the Public Scans directory listing, flipped
 * from the Shared page's row menu. Same ownership + team-admin access rule
 * as POST/DELETE /api/v3/history/[id]/share (mirrored deliberately).
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

const { PUT } =
  await import("@/app/api/v3/history/[id]/share/publicly-listed/route");

function params(id = "55") {
  return { params: Promise.resolve({ id }) };
}

function putRequest(body?: unknown) {
  return new NextRequest(
    "http://localhost/api/v3/history/55/share/publicly-listed",
    {
      method: "PUT",
      ...(body !== undefined
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    },
  );
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 7 });
});

describe("PUT /api/v3/history/[id]/share/publicly-listed", () => {
  it("rejects an unauthenticated request before touching the database", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await PUT(putRequest({ publiclyListed: true }), params());

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean publiclyListed value before touching the database", async () => {
    const res = await PUT(putRequest({ publiclyListed: "yes" }), params());
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/publiclyListed/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a missing publiclyListed value", async () => {
    const res = await PUT(putRequest({}), params());
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 404 when the scan doesn't exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await PUT(putRequest({ publiclyListed: true }), params());

    expect(res.status).toBe(404);
  });

  it("returns 400 when the scan has no active share link", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, share_token: null, user_id: 7 }],
    });

    const res = await PUT(putRequest({ publiclyListed: true }), params());
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/no active share link/);
  });

  it("flips the flag for the owner", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, share_token: "tok", user_id: 7 }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await PUT(putRequest({ publiclyListed: false }), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.publiclyListed).toBe(false);
    const [sql, sqlParams] = mockQuery.mock.calls[1];
    expect(sql).toContain("UPDATE scan_history SET share_publicly_listed = $1");
    expect(sqlParams).toEqual([false, "55"]);
  });

  it("lets a team admin flip the flag on behalf of the scan owner", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, share_token: "tok", user_id: 99 }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "admin" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await PUT(putRequest({ publiclyListed: true }), params());

    expect(res.status).toBe(200);
    const [teamSql, teamParams] = mockQuery.mock.calls[1];
    expect(teamSql).toContain("role IN ('owner', 'admin')");
    expect(teamParams).toEqual([7, 99]);
  });

  it("blocks a team viewer and an unrelated user alike with 404, not 403", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, share_token: "tok", user_id: 99 }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await PUT(putRequest({ publiclyListed: true }), params());
    const json = await res.json();

    expect(res.status).not.toBe(403);
    expect(res.status).toBe(404);
    expect(json.error).toBe("Scan not found");
  });
});
