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
const mockLogAction = vi.fn(async (..._args: unknown[]) => {});
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
    logAction: (...args: unknown[]) => mockLogAction(...args),
  };
});

// getClientIp reads next/headers, which has no request scope under vitest.
vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: async () => "203.0.113.9",
}));

const mockNotifyStaff = vi.fn(async (..._args: unknown[]) => {});
const mockNotifyUserOfStatus = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/support/ticket-notify", () => ({
  notifyStaffOfTicketActivity: (...args: unknown[]) => mockNotifyStaff(...args),
  notifyUserOfStaffReply: vi.fn(),
  confirmTicketToUser: vi.fn(),
  notifyUserOfTicketStatus: (...args: unknown[]) =>
    mockNotifyUserOfStatus(...args),
}));

// Mock the rate limiter so it never touches the (mocked) db pool and so the
// POST tests' mockQuery call order stays load -> insert -> update. Default:
// allow; a test flips it to deny to assert the 429. The args are forwarded so
// a test can read which bucket a route asked for.
const mockCheckRateLimit = vi.fn(async (..._args: unknown[]) => ({
  allowed: true,
  retryAfterSeconds: 0,
}));
vi.mock("@/lib/rate-limiting/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  RATE_LIMITS: {
    api: { limit: "api" },
    supportTicketStatus: { limit: "supportTicketStatus" },
  },
}));

const { GET, POST, PATCH } =
  await import("@/app/api/v3/support-tickets/[id]/route");

/** The route fires notifications from queueMicrotask; let them settle. */
async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

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
    assigned_to: null,
    assigned_to_name: null,
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
  mockLogAction.mockReset();
  mockLogAction.mockResolvedValue(undefined);
  mockNotifyStaff.mockClear();
  mockNotifyUserOfStatus.mockClear();
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
    expect(body.ticket.ownerId).toBeUndefined();
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
    // The account link in the inbox keys off this, so it survives the ticket
    // dropping out of the list (resolved while the Active filter is on).
    expect(body.ticket.ownerId).toBe(7);
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

  it("does not let the owner un-close a closed ticket by resolving it", async () => {
    // The gap the sibling test below could not see. The guard branched only
    // on the REQUESTED status, so asking for "resolved" on a closed ticket
    // collapsed the whole condition: not-resolved was false, no 403, and the
    // write went through. The reply box then renders again and POST accepts
    // it, landing the thread back in the staff queue. Closing is how staff
    // end an abusive thread, which is why only they may undo it.
    asUser(7, "user");
    mockQuery.mockResolvedValueOnce({
      rows: [ticketRow({ status: "closed" })],
    });
    const res = await PATCH(req("PATCH", { status: "resolved" }), params);
    expect(res.status).toBe(403);
    // And nothing was written on the way to the refusal.
    const writes = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("UPDATE support_tickets"),
    );
    expect(writes).toEqual([]);
  });

  it("lets staff reopen a closed ticket", async () => {
    asUser(9, "support");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow({ status: "closed" })] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await PATCH(req("PATCH", { status: "awaiting_staff" }), params);
    expect(res.status).toBe(200);
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

describe("PATCH /api/v3/support-tickets/[id] abuse limits", () => {
  it("limits the owner's status changes per account in the supportTicketStatus bucket", async () => {
    asUser(7, "user");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow()] })
      .mockResolvedValueOnce({ rows: [] });
    await PATCH(req("PATCH", { status: "resolved" }), params);
    expect(mockCheckRateLimit).toHaveBeenCalledWith({
      key: "ticket-status:7",
      limit: "supportTicketStatus",
    });
  });

  it("429s an owner who is changing status too fast, without writing the change", async () => {
    asUser(7, "user");
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 600,
    });
    mockQuery.mockResolvedValueOnce({ rows: [ticketRow()] });
    const res = await PATCH(req("PATCH", { status: "resolved" }), params);
    expect(res.status).toBe(429);
    const writes = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("UPDATE support_tickets"),
    );
    expect(writes).toEqual([]);
  });

  it("does not limit staff working somebody else's ticket", async () => {
    // A support agent clears a queue all day. The loop this limit exists for
    // is the owner's: resolve, reopen, resolve, reopen.
    asUser(99, "support");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow()] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await PATCH(req("PATCH", { status: "resolved" }), params);
    expect(res.status).toBe(200);
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });

  it("does not spend the owner's budget on a request that was refused anyway", async () => {
    asUser(7, "user");
    mockQuery.mockResolvedValueOnce({ rows: [ticketRow({ status: "open" })] });
    const res = await PATCH(req("PATCH", { status: "awaiting_staff" }), params);
    expect(res.status).toBe(403);
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });

  it("emails staff about a reopen, then holds the next one back for the hour", async () => {
    // Resolve and reopen are both open to the owner, so the pair looped for
    // one staff email per two requests. The status change still happens each
    // time; only the notice is debounced, per ticket.
    asUser(7, "user");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow({ status: "resolved" })] })
      .mockResolvedValueOnce({ rows: [] });
    mockCheckRateLimit
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0 }) // status bucket
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0 }); // first notice
    await PATCH(req("PATCH", { status: "awaiting_staff" }), params);
    await flushMicrotasks();
    expect(mockNotifyStaff).toHaveBeenCalledTimes(1);
    expect(mockCheckRateLimit).toHaveBeenLastCalledWith({
      key: "ticket-reopen-notice:42",
      maxAttempts: 1,
      windowSeconds: 3600,
    });

    mockNotifyStaff.mockClear();
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow({ status: "resolved" })] })
      .mockResolvedValueOnce({ rows: [] });
    mockCheckRateLimit
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0 }) // status bucket
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 3000 }); // second notice
    const second = await PATCH(
      req("PATCH", { status: "awaiting_staff" }),
      params,
    );
    await flushMicrotasks();
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ status: "awaiting_staff" });
    expect(mockNotifyStaff).not.toHaveBeenCalled();
    // The ticket did go back to the queue: only the email was held.
    expect(
      mockQuery.mock.calls.filter(([sql]) =>
        String(sql).includes("UPDATE support_tickets SET status"),
      ),
    ).toHaveLength(2);
  });

  it("still sends the reopen notice when the debounce cannot be checked, and logs why", async () => {
    asUser(7, "user");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow({ status: "resolved" })] })
      .mockResolvedValueOnce({ rows: [] });
    mockCheckRateLimit
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0 })
      .mockRejectedValueOnce(new Error("rate_limits unavailable"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await PATCH(
        req("PATCH", { status: "awaiting_staff" }),
        params,
      );
      await flushMicrotasks();
      expect(res.status).toBe(200);
      expect(mockNotifyStaff).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toBe(
        "[support] reopen notice debounce failed",
      );
      expect(spy.mock.calls[0][1]).toEqual({ ticketId: 42 });
    } finally {
      spy.mockRestore();
    }
  });

  it("does not send a notice for a plain resolve", async () => {
    asUser(7, "user");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow()] })
      .mockResolvedValueOnce({ rows: [] });
    await PATCH(req("PATCH", { status: "resolved" }), params);
    await flushMicrotasks();
    expect(mockNotifyStaff).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v3/support-tickets/[id] audit", () => {
  it("records who changed a ticket's status when staff do it", async () => {
    asUser(99, "support");
    mockQuery
      .mockResolvedValueOnce({
        rows: [ticketRow({ status: "awaiting_staff" })],
      })
      .mockResolvedValueOnce({ rows: [] });
    const res = await PATCH(req("PATCH", { status: "closed" }), params);
    expect(res.status).toBe(200);
    // Actor, the ticket's owner as the target, the registered action, a
    // details string of ids and statuses only, and the caller's address.
    expect(mockLogAction).toHaveBeenCalledWith(
      99,
      7,
      "ticket_status_changed",
      "Ticket #42: awaiting_staff -> closed",
      "203.0.113.9",
    );
  });

  it("does not audit an owner changing their own ticket", async () => {
    asUser(7, "user");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow()] })
      .mockResolvedValueOnce({ rows: [] });
    await PATCH(req("PATCH", { status: "closed" }), params);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("does not audit a staff PATCH that changes nothing", async () => {
    asUser(99, "support");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow({ status: "resolved" })] })
      .mockResolvedValueOnce({ rows: [] });
    await PATCH(req("PATCH", { status: "resolved" }), params);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("does not audit a request that was refused", async () => {
    asUser(8, "user");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow()] })
      .mockResolvedValueOnce({ rows: [{ ok: 1 }] });
    const res = await PATCH(req("PATCH", { status: "closed" }), params);
    expect(res.status).toBe(403);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("keeps a status change that happened when its audit row cannot be written, and logs the miss", async () => {
    // The change is already made by the time the audit write runs, so a 500
    // here would invite a retry of something that worked.
    asUser(99, "support");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow()] })
      .mockResolvedValueOnce({ rows: [] });
    mockLogAction.mockRejectedValueOnce(new Error("audit table locked"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await PATCH(req("PATCH", { status: "resolved" }), params);
      expect(res.status).toBe(200);
      expect(spy.mock.calls[0][0]).toBe(
        "[support] could not write the ticket audit row",
      );
      expect(spy.mock.calls[0][1]).toEqual({
        ticketId: 42,
        userId: 99,
        change: "status",
      });
    } finally {
      spy.mockRestore();
    }
  });
});

describe("PATCH /api/v3/support-tickets/[id] assignment", () => {
  it("lets staff take a ticket and records it", async () => {
    asUser(99, "support");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow()] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await PATCH(req("PATCH", { assign: "me" }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "open", assignedTo: 99 });
    const update = mockQuery.mock.calls[1];
    expect(update[0]).toContain("SET assigned_to = $1");
    expect(update[1]).toEqual([99, 42]);
    expect(mockLogAction).toHaveBeenCalledWith(
      99,
      7,
      "ticket_assigned",
      "Ticket #42: nobody -> #99",
      "203.0.113.9",
    );
  });

  it("changes only the assignee when only an assignee is sent", async () => {
    // No status in the body means no status write, no audit row for one, and
    // no email to the customer saying their ticket changed.
    asUser(99, "support");
    mockQuery
      .mockResolvedValueOnce({
        rows: [ticketRow({ status: "awaiting_staff" })],
      })
      .mockResolvedValueOnce({ rows: [] });
    const res = await PATCH(req("PATCH", { assign: "me" }), params);
    await flushMicrotasks();
    expect((await res.json()).status).toBe("awaiting_staff");
    expect(
      mockQuery.mock.calls.some(([sql]) =>
        String(sql).includes("SET status = $1"),
      ),
    ).toBe(false);
    expect(mockNotifyUserOfStatus).not.toHaveBeenCalled();
    expect(mockLogAction.mock.calls.map((c) => c[2])).toEqual([
      "ticket_assigned",
    ]);
  });

  it("lets staff take a ticket another staffer holds, naming both in the audit row", async () => {
    asUser(99, "support");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow({ assigned_to: 5 })] })
      .mockResolvedValueOnce({ rows: [] });
    await PATCH(req("PATCH", { assign: "me" }), params);
    expect(mockLogAction.mock.calls[0][3]).toBe("Ticket #42: #5 -> #99");
  });

  it("releases a ticket back to the shared queue", async () => {
    asUser(99, "support");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow({ assigned_to: 99 })] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await PATCH(req("PATCH", { assign: "none" }), params);
    expect(await res.json()).toEqual({ status: "open", assignedTo: null });
    expect(mockQuery.mock.calls[1][1]).toEqual([null, 42]);
    expect(mockLogAction.mock.calls[0][3]).toBe("Ticket #42: #99 -> nobody");
  });

  it("does not audit taking a ticket you already hold", async () => {
    asUser(99, "support");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow({ assigned_to: 99 })] })
      .mockResolvedValueOnce({ rows: [] });
    await PATCH(req("PATCH", { assign: "me" }), params);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("can change status and assignee in one request", async () => {
    asUser(99, "support");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await PATCH(
      req("PATCH", { status: "awaiting_user", assign: "me" }),
      params,
    );
    expect(await res.json()).toEqual({
      status: "awaiting_user",
      assignedTo: 99,
    });
    expect(mockLogAction.mock.calls.map((c) => c[2])).toEqual([
      "ticket_status_changed",
      "ticket_assigned",
    ]);
  });

  it("refuses the ticket's owner, who is not staff on their own ticket", async () => {
    asUser(7, "user");
    mockQuery.mockResolvedValueOnce({ rows: [ticketRow()] });
    const res = await PATCH(req("PATCH", { assign: "me" }), params);
    expect(res.status).toBe(403);
    expect(
      mockQuery.mock.calls.filter(([sql]) =>
        String(sql).includes("UPDATE support_tickets"),
      ),
    ).toEqual([]);
  });

  it("refuses a staffer assigning a ticket they own themselves", async () => {
    asUser(7, "support");
    mockQuery.mockResolvedValueOnce({ rows: [ticketRow()] });
    const res = await PATCH(req("PATCH", { assign: "me" }), params);
    expect(res.status).toBe(403);
  });

  it("refuses a shared teammate", async () => {
    asUser(8, "user");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow()] })
      .mockResolvedValueOnce({ rows: [{ ok: 1 }] });
    const res = await PATCH(req("PATCH", { assign: "me" }), params);
    expect(res.status).toBe(403);
  });

  it("rejects an assignment it does not know", async () => {
    asUser(99, "support");
    // Nobody can be assigned a ticket by id from the client: the only targets
    // are the caller and no one.
    const res = await PATCH(req("PATCH", { assign: 5 }), params);
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("still rejects a body with neither a status nor an assignment", async () => {
    asUser(99, "support");
    const res = await PATCH(req("PATCH", { note: "hello" }), params);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v3/support-tickets/[id] assignment", () => {
  it("shows staff who holds a ticket, and whether it is them", async () => {
    asUser(99, "support");
    mockQuery
      .mockResolvedValueOnce({
        rows: [ticketRow({ assigned_to: 99, assigned_to_name: "Agent" })],
      })
      .mockResolvedValueOnce({ rows: [] });
    const body = await (await GET(req("GET"), params)).json();
    expect(body.ticket.assignedTo).toEqual({
      id: 99,
      name: "Agent",
      mine: true,
    });
  });

  it("shows staff an unassigned ticket as null", async () => {
    asUser(99, "support");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow()] })
      .mockResolvedValueOnce({ rows: [] });
    const body = await (await GET(req("GET"), params)).json();
    expect(body.ticket.assignedTo).toBeNull();
  });

  it("never tells the customer which staffer is working their ticket", async () => {
    asUser(7, "user");
    mockQuery
      .mockResolvedValueOnce({
        rows: [ticketRow({ assigned_to: 99, assigned_to_name: "Agent" })],
      })
      .mockResolvedValueOnce({ rows: [] });
    const body = await (await GET(req("GET"), params)).json();
    expect(body.ticket).not.toHaveProperty("assignedTo");
    expect(JSON.stringify(body)).not.toContain("Agent");
  });
});

describe("withErrorHandling", () => {
  it("answers a failing write with a 500 instead of throwing out of the route", async () => {
    asUser(99, "support");
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow()] })
      .mockRejectedValueOnce(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await PATCH(req("PATCH", { status: "resolved" }), params);
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("GET /api/v3/support-tickets/[id] languages", () => {
  /** The thread query's rows, then the viewer's saved locale. */
  function threadOf(viewerLocale: string, messages: Record<string, unknown>[]) {
    mockQuery
      .mockResolvedValueOnce({ rows: [ticketRow()] })
      .mockResolvedValueOnce({
        rows: messages.map((m, i) => ({
          id: i + 1,
          is_staff: false,
          body: "text",
          created_at: "x",
          author_name: null,
          translations: {},
          ...m,
        })),
      })
      .mockResolvedValueOnce({ rows: [{ locale: viewerLocale }] });
  }

  it("names a language only when the reader does not read it, so a message they can read gets no Translate button", async () => {
    asUser(7, "user");
    threadOf("en", [
      { body_locale: "en" },
      { body_locale: "de", translations: { en: "hello" } },
      { body_locale: null },
    ]);
    const body = await (await GET(req("GET"), params)).json();
    expect(body.messages[0].bodyLocale).toBeNull();
    expect(body.messages[0].translation).toBeNull();
    expect(body.messages[1].bodyLocale).toBe("de");
    expect(body.messages[1].translation).toBe("hello");
    expect(body.messages[2].bodyLocale).toBeNull();
  });

  it("judges each reader by their own locale", async () => {
    asUser(99, "support");
    threadOf("de", [{ body_locale: "de" }, { body_locale: "en" }]);
    const body = await (await GET(req("GET"), params)).json();
    expect(body.messages[0].bodyLocale).toBeNull();
    expect(body.messages[1].bodyLocale).toBe("en");
  });
});
