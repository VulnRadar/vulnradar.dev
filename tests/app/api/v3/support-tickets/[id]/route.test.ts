/**
 * Route tests for /api/v3/support-tickets/[id] (thread, reply, status).
 * Uses the REAL hasStaffPermission (a pure role->permissions map), so staff
 * access is driven purely by the mocked session's role.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({ getSession: () => mockGetSession() }));

vi.mock("@/lib/support/ticket-notify", () => ({
  notifyStaffOfTicketActivity: vi.fn(),
  notifyUserOfStaffReply: vi.fn(),
}));

const { GET, POST, PATCH } =
  await import("@/app/api/v3/support-tickets/[id]/route");

function ticketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    user_id: 7,
    subject: "Billing help",
    category: "billing",
    status: "open",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    last_message_at: "2026-01-01T00:00:00.000Z",
    owner_email: "owner@example.com",
    owner_name: "Owner",
    ...overrides,
  };
}

function req(method: string, body?: unknown) {
  return new NextRequest("http://localhost/api/v3/support-tickets/42", {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
const params = { params: Promise.resolve({ id: "42" }) };

function asUser(userId = 7, role = "user") {
  mockGetSession.mockResolvedValue({
    userId,
    email: `u${userId}@example.com`,
    name: `U${userId}`,
    role,
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("GET /api/v3/support-tickets/[id]", () => {
  it("lets the owner read their ticket, without exposing staff identity or owner email", async () => {
    asUser(7, "user");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow()] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            is_staff: true,
            body: "hi",
            created_at: "x",
            author_name: "Agent Smith",
          },
        ],
      });
    const res = await GET(req("GET"), params);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.viewerIsStaff).toBe(false);
    expect(body.ticket.ownerEmail).toBeUndefined();
    // Staff replies show as "Support" (no name) to the owner.
    expect(body.messages[0].authorName).toBeNull();
  });

  it("404s (not 403) for a different non-staff user, leaking nothing", async () => {
    asUser(8, "user");
    mockQuery.mockResolvedValueOnce({ rows: [ticketRow()] });
    const res = await GET(req("GET"), params);
    expect(res.status).toBe(404);
  });

  it("lets staff read any ticket and see the owner email + staff names", async () => {
    asUser(99, "support");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow()] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            is_staff: true,
            body: "hi",
            created_at: "x",
            author_name: "Agent Smith",
          },
        ],
      });
    const res = await GET(req("GET"), params);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.viewerIsStaff).toBe(true);
    expect(body.ticket.ownerEmail).toBe("owner@example.com");
    expect(body.messages[0].authorName).toBe("Agent Smith");
  });
});

describe("POST /api/v3/support-tickets/[id] (reply)", () => {
  it("owner reply moves the ticket to awaiting_staff and stores a non-staff message", async () => {
    asUser(7, "user");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow({ status: "awaiting_user" })] }) // load
      .mockResolvedValueOnce({
        rows: [{ id: 5, is_staff: false, body: "thanks", created_at: "x" }],
      }) // insert msg
      .mockResolvedValueOnce({ rows: [] }); // update status
    const res = await POST(req("POST", { message: "thanks" }), params);
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.status).toBe("awaiting_staff");
    const [insSql, insParams] = mockQuery.mock.calls[1];
    expect(insSql).toContain("INSERT INTO support_ticket_messages");
    expect(insParams[2]).toBe(false); // is_staff
  });

  it("staff reply to someone else's ticket moves it to awaiting_user and stores a staff message", async () => {
    asUser(99, "support");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow()] })
      .mockResolvedValueOnce({
        rows: [
          { id: 6, is_staff: true, body: "looking into it", created_at: "x" },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    const res = await POST(req("POST", { message: "looking into it" }), params);
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.status).toBe("awaiting_user");
    expect(mockQuery.mock.calls[1][1][2]).toBe(true); // is_staff true
  });

  it("409s on a reply to a closed ticket", async () => {
    asUser(7, "user");
    mockQuery.mockResolvedValueOnce({
      rows: [ticketRow({ status: "closed" })],
    });
    const res = await POST(req("POST", { message: "still broken" }), params);
    expect(res.status).toBe(409);
  });

  it("400s on an empty message", async () => {
    asUser(7, "user");
    const res = await POST(req("POST", { message: "   " }), params);
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/v3/support-tickets/[id] (status)", () => {
  it("lets the owner resolve their own ticket", async () => {
    asUser(7, "user");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow()] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await PATCH(req("PATCH", { status: "resolved" }), params);
    expect(res.status).toBe(200);
  });

  it("forbids the owner from setting a staff-only status", async () => {
    asUser(7, "user");
    mockQuery.mockResolvedValueOnce({ rows: [ticketRow()] });
    const res = await PATCH(req("PATCH", { status: "awaiting_user" }), params);
    expect(res.status).toBe(403);
  });

  it("lets staff move a ticket to any status", async () => {
    asUser(99, "support");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow()] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await PATCH(req("PATCH", { status: "awaiting_user" }), params);
    expect(res.status).toBe(200);
  });
});
