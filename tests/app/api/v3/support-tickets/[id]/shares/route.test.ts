/**
 * Route tests for /api/v3/support-tickets/[id]/shares (owner-only sharing with
 * specific teammates).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

// ticket-access.ts imports "server-only"; neutralize it under vitest.
vi.mock("server-only", () => ({}));

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({ getSession: () => mockGetSession() }));

const { GET, POST, DELETE } =
  await import("@/app/api/v3/support-tickets/[id]/shares/route");

const params = { params: Promise.resolve({ id: "42" }) };

function req(method: string, body?: unknown, query = "") {
  return new NextRequest(
    `http://localhost/api/v3/support-tickets/42/shares${query}`,
    { method, ...(body ? { body: JSON.stringify(body) } : {}) },
  );
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({
    userId: 7,
    email: "owner@example.com",
    name: "Owner",
    role: "user",
  });
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("GET shares", () => {
  it("returns current shares and eligible teammates for the owner", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 7 }] }) // requireOwner
      .mockResolvedValueOnce({
        rows: [{ user_id: 5, email: "a@x.com", name: "Alice" }],
      }) // current shares
      .mockResolvedValueOnce({
        rows: [{ id: 6, email: "b@x.com", name: "Bob" }],
      }); // eligible
    const res = await GET(req("GET"), params);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.shares[0].userId).toBe(5);
    expect(body.eligible[0].userId).toBe(6);
  });

  it("403s for a non-owner", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 999 }] }); // owned by someone else
    const res = await GET(req("GET"), params);
    expect(res.status).toBe(403);
  });
});

describe("POST shares", () => {
  it("shares with a teammate", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 7 }] }) // requireOwner
      .mockResolvedValueOnce({ rows: [{ ok: 1 }] }) // areTeammates -> yes
      .mockResolvedValueOnce({ rows: [] }); // insert
    const res = await POST(req("POST", { userId: 6 }), params);
    expect(res.status).toBe(201);
    expect(mockQuery.mock.calls[2][0]).toContain(
      "INSERT INTO support_ticket_shares",
    );
  });

  it("refuses to share with a non-teammate", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 7 }] }) // requireOwner
      .mockResolvedValueOnce({ rows: [] }); // areTeammates -> no
    const res = await POST(req("POST", { userId: 6 }), params);
    expect(res.status).toBe(400);
  });

  it("403s when a non-owner tries to share", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 999 }] });
    const res = await POST(req("POST", { userId: 6 }), params);
    expect(res.status).toBe(403);
  });
});

describe("DELETE shares", () => {
  it("removes a share for the owner", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 7 }] }) // requireOwner
      .mockResolvedValueOnce({ rows: [] }); // delete
    const res = await DELETE(req("DELETE", undefined, "?userId=5"), params);
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[1][0]).toContain(
      "DELETE FROM support_ticket_shares",
    );
  });
});

describe("the ticket id in the path", () => {
  const refused = [
    "12.png",
    "12.svg",
    "12abc",
    "1e3",
    "0x10",
    "1.5",
    "012",
    "0",
    "-5",
    "2147483648",
  ];

  function withId(id: string) {
    return { params: Promise.resolve({ id }) };
  }

  it.each(refused)("refuses %j on GET, POST and DELETE", async (id) => {
    for (const [handler, request] of [
      [GET, req("GET")],
      [POST, req("POST", { userId: 6 })],
      [DELETE, req("DELETE", undefined, "?userId=5")],
    ] as const) {
      const res = await handler(request, withId(id));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Invalid ticket id.");
    }
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("still serves a plain numeric id", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 7 }] }) // requireOwner
      .mockResolvedValueOnce({ rows: [] }) // current shares
      .mockResolvedValueOnce({ rows: [] }); // eligible
    const res = await GET(req("GET"), withId("12"));
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual([12]);
  });
});
