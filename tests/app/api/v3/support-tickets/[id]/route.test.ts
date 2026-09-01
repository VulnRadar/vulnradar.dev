/**
 * Route tests for /api/v3/support-tickets/[id] (thread, reply, status).
 * Uses the REAL hasStaffPermission (a pure role->permissions map), so staff
 * access is driven purely by the mocked session's role.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

// ticket-access.ts imports "server-only", which throws outside a react-server
// build; neutralize it so the real resolveTicketAccess loads under vitest.
vi.mock("server-only", () => ({}));

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({ getSession: () => mockGetSession() }));

/**
 * The route resolves staff status through requirePermission, not the raw
 * session role, so that ENFORCE_STAFF_2FA applies here the same way it does on
 * /api/v3/admin. Model both halves: the REAL role->permission map decides the
 * role half, and `staff2FAGateBlocks` stands in for a staff account the 2FA
 * enforcement is holding out (requirePermission returns null for both cases).
 */
let staff2FAGateBlocks = false;
vi.mock("@/lib/auth/authorization", async () => {
  const { hasStaffPermission } = await import("@/lib/auth/permissions-client");
  type StaffPermission = Parameters<typeof hasStaffPermission>[1];
  return {
    requirePermission: async (permission: StaffPermission) => {
      const session = await mockGetSession();
      if (!session) return null;
      if (!hasStaffPermission(session.role, permission)) return null;
      if (staff2FAGateBlocks) return null;
      return { ...session, id: session.userId };
    },
  };
});

vi.mock("@/lib/support/ticket-notify", () => ({
  notifyStaffOfTicketActivity: vi.fn(),
  notifyUserOfStaffReply: vi.fn(),
}));

// Mock the rate limiter so it never touches the (mocked) db pool and so the
// POST tests' mockQuery call order stays load -> insert -> update. Default:
// allow; a test flips it to deny to assert the 429.
const mockCheckRateLimit = vi.fn(async () => ({
  allowed: true,
  retryAfterSeconds: 0,
}));
vi.mock("@/lib/rate-limiting/rate-limit", () => ({
  checkRateLimit: (..._args: unknown[]) => mockCheckRateLimit(),
  RATE_LIMITS: { api: { limit: "api" } },
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
  staff2FAGateBlocks = false;
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
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

describe("ENFORCE_STAFF_2FA applies to the support surface too", () => {
  it("404s a support account the 2FA enforcement is blocking, instead of handing it the thread", async () => {
    // The one control that is supposed to make a staff account without 2FA
    // harmless. Before this, such an account was locked out of /api/v3/admin
    // entirely but could still read every customer's full thread here.
    staff2FAGateBlocks = true;
    asUser(99, "support");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow()] }) // loadTicket
      .mockResolvedValueOnce({ rows: [] }); // shares lookup: not shared either
    const res = await GET(req("GET"), params);
    expect(res.status).toBe(404);
  });

  it("does not let a blocked support account reply to a customer as Support", async () => {
    staff2FAGateBlocks = true;
    asUser(99, "support");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow()] })
      .mockResolvedValueOnce({ rows: [] }); // shares lookup
    const res = await POST(req("POST", { message: "looking into it" }), params);
    expect(res.status).toBe(404);
    // Nothing was written: no message row, no status change.
    expect(
      mockQuery.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO support_ticket_messages"),
      ),
    ).toBe(false);
  });

  it("still serves the same account once 2FA enforcement is satisfied", async () => {
    staff2FAGateBlocks = false;
    asUser(99, "support");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow()] })
      .mockResolvedValueOnce({ rows: [] }); // messages
    const res = await GET(req("GET"), params);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/v3/support-tickets/[id] (reply)", () => {
  it("429s when the reply rate limit is exceeded, before any DB work", async () => {
    asUser(7, "user");
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 120,
    });
    const res = await POST(req("POST", { message: "spam" }), params);
    expect(res.status).toBe(429);
    // Rate-limited before loading the ticket or inserting anything.
    expect(mockQuery).not.toHaveBeenCalled();
  });

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

describe("shared teammate access", () => {
  // resolveTicketAccess runs a shares lookup when the viewer is neither owner
  // nor staff; a non-empty result grants access.
  it("lets a shared teammate read the thread", async () => {
    asUser(8, "user");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow()] }) // loadTicket
      .mockResolvedValueOnce({ rows: [{ ok: 1 }] }) // shares lookup -> shared
      .mockResolvedValueOnce({ rows: [] }); // messages
    const res = await GET(req("GET"), params);
    expect(res.status).toBe(200);
  });

  it("lets a shared teammate reply as a non-staff participant", async () => {
    asUser(8, "user");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow()] }) // loadTicket
      .mockResolvedValueOnce({ rows: [{ ok: 1 }] }) // shares lookup
      .mockResolvedValueOnce({
        rows: [{ id: 9, is_staff: false, body: "me too", created_at: "x" }],
      }) // insert
      .mockResolvedValueOnce({ rows: [] }); // update
    const res = await POST(req("POST", { message: "me too" }), params);
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.status).toBe("awaiting_staff");
    expect(mockQuery.mock.calls[2][1][2]).toBe(false); // is_staff false
  });

  it("re-checks the teammate relationship at read time, not just when the share was created", async () => {
    // Nothing deletes a support_ticket_shares row when the membership that
    // justified it ends (no team column, so the teams cascade never reaches
    // it). Granting on the bare row let an ex-teammate keep reading and
    // replying to a private ticket forever.
    asUser(8, "user");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow()] }) // loadTicket
      .mockResolvedValueOnce({ rows: [] }); // share row exists but they are no longer teammates
    const res = await GET(req("GET"), params);
    expect(res.status).toBe(404);

    const [sharesSql, sharesParams] = mockQuery.mock.calls[1];
    expect(sharesSql).toContain("support_ticket_shares");
    expect(sharesSql).toContain("JOIN team_members b ON a.team_id = b.team_id");
    // ticketId, viewerId, ticketOwnerId
    expect(sharesParams).toEqual([42, 8, 7]);
  });

  it("forbids a shared teammate from changing status", async () => {
    asUser(8, "user");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow()] }) // loadTicket
      .mockResolvedValueOnce({ rows: [{ ok: 1 }] }); // shares lookup
    const res = await PATCH(req("PATCH", { status: "resolved" }), params);
    expect(res.status).toBe(403);
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

  // Reopening a RESOLVED ticket was already possible for the owner, but only
  // by writing another message (POST sets awaiting_staff). There was no way to
  // say "this is not fixed" on its own (AUDIT-011#drift-21).
  it("lets the owner reopen a ticket they resolved", async () => {
    asUser(7, "user");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow({ status: "resolved" })] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await PATCH(req("PATCH", { status: "awaiting_staff" }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "awaiting_staff" });
  });

  it("does not let the owner reopen a CLOSED ticket", async () => {
    // `closed` stays terminal for the owner: the UI signposts it as final and
    // POST refuses to reply to it, so only staff bring one back.
    asUser(7, "user");
    mockQuery.mockResolvedValueOnce({
      rows: [ticketRow({ status: "closed" })],
    });
    const res = await PATCH(req("PATCH", { status: "awaiting_staff" }), params);
    expect(res.status).toBe(403);
  });

  it("does not let the owner jump an open ticket to a staff-only status", async () => {
    // The reopen arm is scoped to resolved -> awaiting_staff, nothing wider.
    asUser(7, "user");
    mockQuery.mockResolvedValueOnce({ rows: [ticketRow({ status: "open" })] });
    const res = await PATCH(req("PATCH", { status: "awaiting_staff" }), params);
    expect(res.status).toBe(403);
  });

  it("does not let a shared teammate reopen someone else's resolved ticket", async () => {
    asUser(8, "user");
    mockQuery.mockResolvedValueOnce({
      rows: [ticketRow({ status: "resolved" })],
    });
    const res = await PATCH(req("PATCH", { status: "awaiting_staff" }), params);
    // Either "not shared with you" (404) or "owner only" (403); never a write.
    expect([403, 404]).toContain(res.status);
  });
});
