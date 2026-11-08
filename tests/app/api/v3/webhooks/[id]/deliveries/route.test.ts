import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

vi.mock("@/lib/auth", () => ({
  getSession: async () => ({ userId: 7, email: "mate@example.com" }),
}));

const mockAccess = vi.fn();
vi.mock("@/lib/auth/team-resource-access", () => ({
  getTeamResourceAccess: (...args: unknown[]) => mockAccess(...args),
}));

const { GET } = await import("@/app/api/v3/webhooks/[id]/deliveries/route");

const ROW = {
  id: 1,
  event_type: "scan.completed",
  http_status: 404,
  response_snippet: "Cannot POST /hook-secret-path",
  attempted_at: "2026-11-01T00:00:00.000Z",
};

async function read() {
  const res = await GET(
    new NextRequest("http://localhost/api/v3/webhooks/10/deliveries"),
    { params: Promise.resolve({ id: "10" }) },
  );
  return res.json();
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery
    .mockResolvedValueOnce({ rows: [{ user_id: 3, team_id: 5 }] })
    .mockResolvedValueOnce({ rows: [ROW] });
  mockAccess.mockReset();
});

describe("GET /api/v3/webhooks/[id]/deliveries", () => {
  it("gives a teammate who can edit the webhook the response snippet", async () => {
    mockAccess.mockResolvedValue({ canRead: true, canWrite: true });
    expect((await read()).deliveries[0].response_snippet).toBe(
      ROW.response_snippet,
    );
  });

  it("withholds it from a read-only teammate, whose URL view is host only", async () => {
    mockAccess.mockResolvedValue({ canRead: true, canWrite: false });
    const [delivery] = (await read()).deliveries;
    expect(delivery.response_snippet).toBeNull();
    expect(delivery.http_status).toBe(404);
  });
});
