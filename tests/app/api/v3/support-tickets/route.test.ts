/**
 * Route tests for GET/POST /api/v3/support-tickets (list own + create).
 * pool and getSession are mocked; the outbound staff notification is stubbed so
 * no email is attempted.
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

const { GET, POST } = await import("@/app/api/v3/support-tickets/route");

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/v3/support-tickets", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({
    userId: 7,
    email: "user@example.com",
    name: "User",
    role: "user",
  });
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("GET /api/v3/support-tickets", () => {
  it("401s when not signed in", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns only the caller's own tickets", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, subject: "Help", status: "open", message_count: 2 }],
    });
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.tickets).toHaveLength(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("WHERE t.user_id = $1");
    // The row cap is a bound parameter now, and the response reports it, so a
    // truncated ticket history is visible instead of just stopping
    // (AUDIT-014#magic-20).
    expect(params).toEqual([7, 100]);
    expect(body.limit).toBe(100);
    expect(body.truncated).toBe(false);
  });
});

describe("POST /api/v3/support-tickets", () => {
  it("401s when not signed in", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await POST(postRequest({ subject: "x", message: "y" }));
    expect(res.status).toBe(401);
  });

  it("400s on a missing subject or message", async () => {
    expect((await POST(postRequest({ message: "hi" }))).status).toBe(400);
    expect((await POST(postRequest({ subject: "hi" }))).status).toBe(400);
  });

  it("400s on an unknown category", async () => {
    const res = await POST(
      postRequest({ subject: "s", message: "m", category: "nope" }),
    );
    expect(res.status).toBe(400);
  });

  it("creates a ticket + first message and returns 201", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ n: 0 }] }) // open-ticket count
      .mockResolvedValueOnce({
        rows: [
          {
            id: 42,
            subject: "Billing help",
            category: "billing",
            status: "open",
          },
        ],
      }) // insert ticket
      .mockResolvedValueOnce({ rows: [] }); // insert message

    const res = await POST(
      postRequest({
        subject: "Billing help",
        message: "I was double charged",
        category: "billing",
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.ticket.id).toBe(42);
    // The first message is stored as a non-staff message by the ticket owner.
    const [msgSql, msgParams] = mockQuery.mock.calls[2];
    expect(msgSql).toContain("INSERT INTO support_ticket_messages");
    expect(msgParams).toEqual([42, 7, "I was double charged"]);
  });

  it("429s when the user already has too many open tickets", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 20 }] });
    const res = await POST(postRequest({ subject: "s", message: "m" }));
    expect(res.status).toBe(429);
  });
});
