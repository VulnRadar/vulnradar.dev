/**
 * Route-level tests for GET /api/v3/admin/teams/[id] (team detail + member
 * list). Same local checkAdminAccess gate (admin/moderator only) as the
 * collection route. This route is GET-only: editing/deleting a team is only
 * reachable via teamId in the body on the collection route, not a mutation
 * aimed at this per-id endpoint.
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

const routeModule = await import("@/app/api/v3/admin/teams/[id]/route");
const { GET } = routeModule;

function withRole(role: string) {
  mockGetSession.mockResolvedValue({ userId: 1 });
  mockQuery.mockResolvedValueOnce({ rows: [{ role }] });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function getRequest(): Request {
  return new Request("http://localhost/api/v3/admin/teams/1");
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
});

describe("GET /api/v3/admin/teams/[id]", () => {
  it("rejects an unauthenticated caller", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET(getRequest(), ctx("1"));
    expect(res.status).toBe(401);
  });

  it("rejects a support-tier caller", async () => {
    withRole("support");
    const res = await GET(getRequest(), ctx("1"));
    expect(res.status).toBe(403);
  });

  it("rejects a non-numeric id", async () => {
    withRole("moderator");
    const res = await GET(getRequest(), ctx("not-a-number"));
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown team", async () => {
    withRole("moderator");
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await GET(getRequest(), ctx("999"));
    expect(res.status).toBe(404);
  });

  it("returns team detail and members for a moderator", async () => {
    withRole("moderator");
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, name: "Acme" }] }); // team
    mockQuery.mockResolvedValueOnce({
      rows: [{ user_id: 9, role: "owner", email: "owner@example.com" }],
    }); // members
    const res = await GET(getRequest(), ctx("1"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.team.name).toBe("Acme");
    expect(json.members).toHaveLength(1);
  });

  it("allows a super_admin to view team detail (passes every admin-or-higher check)", async () => {
    withRole("super_admin");
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, name: "Acme" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await GET(getRequest(), ctx("1"));
    expect(res.status).toBe(200);
  });
});

describe("module shape", () => {
  it("does not export PATCH, DELETE, or POST — a mutation cannot be aimed at this per-id route", () => {
    const mod = routeModule as unknown as Record<string, unknown>;
    expect(mod.PATCH).toBeUndefined();
    expect(mod.DELETE).toBeUndefined();
    expect(mod.POST).toBeUndefined();
  });
});
