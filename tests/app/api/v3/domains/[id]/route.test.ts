/**
 * Route-level tests for PATCH /api/v3/domains/[id], the write path for
 * domains.team_id. Before this route existed the column was read by GET
 * /api/v3/domains and by the scan-authorization scope check, and advertised
 * in the teams docs, but nothing could ever set it (AUDIT-011#drift-22).
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

const mockGetAssignableTeamIds = vi.fn();
vi.mock("@/lib/auth/team-resource-access", () => ({
  getAssignableTeamIds: (...args: unknown[]) =>
    mockGetAssignableTeamIds(...args),
}));

const { PATCH } = await import("@/app/api/v3/domains/[id]/route");

function patchRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/domains/5", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
  mockGetAssignableTeamIds.mockReset();
  mockGetAssignableTeamIds.mockResolvedValue([7]);
});

describe("PATCH /api/v3/domains/[id]", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ teamId: 7 }), params("5"));
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric id", async () => {
    const res = await PATCH(patchRequest({ teamId: 7 }), params("abc"));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a body with nothing to update", async () => {
    const res = await PATCH(patchRequest({}), params("5"));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a teamId that is neither an integer nor null", async () => {
    const res = await PATCH(patchRequest({ teamId: "seven" }), params("5"));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("assigns the domain to a team the caller can write into", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 5, domain: "example.com", team_id: 7 }],
    });

    const res = await PATCH(patchRequest({ teamId: 7 }), params("5"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ team_id: 7 });
    const [sql, values] = mockQuery.mock.calls[0];
    expect(sql).toContain("UPDATE domains SET team_id");
    // Ownership is enforced in the statement itself, not only above it.
    expect(sql).toContain("user_id = $3");
    expect(values).toEqual([7, 5, 42]);
  });

  it("moves a domain back to personal with an explicit null", async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 5, team_id: null }] });
    const res = await PATCH(patchRequest({ teamId: null }), params("5"));
    expect(res.status).toBe(200);
    expect(mockGetAssignableTeamIds).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls[0][1][0]).toBeNull();
  });

  it("refuses a team the caller cannot write into, without touching the row", async () => {
    mockGetAssignableTeamIds.mockResolvedValue([7]);
    const res = await PATCH(patchRequest({ teamId: 99 }), params("5"));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("404s for a domain that is not the caller's own", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await PATCH(patchRequest({ teamId: 7 }), params("5"));
    expect(res.status).toBe(404);
  });
});
