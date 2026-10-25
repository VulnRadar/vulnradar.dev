/**
 * Route tests for GET /api/v3/admin/support-tickets (staff inbox).
 *
 * The pool is faked, so these read the SQL and its parameters. What the SQL
 * does (the cursor comparison, the escaped ILIKE) is proven against a real
 * database in tests/integration/admin-ticket-list.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockRequirePermission = vi.fn();
vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: () => mockRequirePermission(),
}));

const { GET } = await import("@/app/api/v3/admin/support-tickets/route");
const { encodeTicketCursor, ADMIN_TICKET_PAGE_SIZE } =
  await import("@/lib/support/admin-ticket-list");

function getRequest(query = "") {
  return new NextRequest(
    `http://localhost/api/v3/admin/support-tickets${query}`,
    { method: "GET" },
  );
}

function ticketRows(n: number, firstId = 100) {
  return Array.from({ length: n }, (_, i) => ({
    id: firstId - i,
    subject: `Ticket ${firstId - i}`,
    status: "open",
    owner_email: "a@b.c",
    cursor_ts: `2026-10-25 12:00:${String(59 - i).padStart(2, "0")}.123456+00`,
  }));
}

beforeEach(() => {
  mockQuery.mockReset();
  mockRequirePermission.mockReset();
  mockRequirePermission.mockResolvedValue({ userId: 1, role: "support" });
  mockQuery.mockResolvedValue({ rows: [] });
});

describe("GET /api/v3/admin/support-tickets", () => {
  it("403s without the manage-support permission", async () => {
    mockRequirePermission.mockResolvedValueOnce(null);
    const res = await GET(getRequest());
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns the active queue plus per-status counts by default", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { id: 1, subject: "Help", status: "open", owner_email: "a@b.c" },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { status: "open", n: 3, mine: 1 },
          { status: "resolved", n: 5, mine: 2 },
        ],
      });
    const res = await GET(getRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.tickets).toHaveLength(1);
    expect(body.counts).toEqual({ open: 3, resolved: 5 });
    // Only ACTIVE tickets count as "mine": a resolved one assigned to the
    // caller is history, not work waiting on them.
    expect(body.mine).toBe(1);
    expect(body.nextCursor).toBeNull();
    // Default hides resolved/closed.
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("t.status = ANY($1::text[])");
    expect(params[0]).toEqual(["open", "awaiting_staff", "awaiting_user"]);
  });

  it("filters to a single status when asked", async () => {
    await GET(getRequest("?status=resolved"));
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("WHERE t.status = $1");
    expect(params[0]).toBe("resolved");
  });

  it("returns everything when status=all", async () => {
    await GET(getRequest("?status=all"));
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).not.toContain("t.status = ");
    // The only WHEREs left belong to the two per-row subselects.
    expect(sql).not.toMatch(/\n\s+WHERE /);
  });

  it("falls back to the active queue for a status it does not know", async () => {
    await GET(getRequest("?status=anything"));
    expect(mockQuery.mock.calls[0][0]).toContain("t.status = ANY($1::text[])");
  });

  it("asks for the caller's own assignments with mine=1, never somebody else's", async () => {
    mockRequirePermission.mockResolvedValue({ userId: 42, role: "support" });
    await GET(getRequest("?mine=1&status=all"));
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("t.assigned_to = $1");
    expect(params[0]).toBe(42);
  });

  it("ignores any other mine value instead of widening to everyone", async () => {
    await GET(getRequest("?mine=true&status=all"));
    expect(mockQuery.mock.calls[0][0]).not.toContain("t.assigned_to =");
  });

  it("counts the caller's assignments in the same pass as the status counts", async () => {
    mockRequirePermission.mockResolvedValue({ userId: 42, role: "support" });
    await GET(getRequest());
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain("COUNT(*) FILTER (WHERE assigned_to = $1)");
    expect(params).toEqual([42]);
  });
});

describe("GET /api/v3/admin/support-tickets search", () => {
  it("matches subject or owner email, with the term bound rather than concatenated", async () => {
    await GET(getRequest("?q=refund"));
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("t.subject ILIKE");
    expect(sql).toContain("u.email ILIKE");
    expect(sql).not.toContain("refund");
    expect(params).toContain("%refund%");
  });

  it("escapes LIKE metacharacters so a % or _ in the box is a literal", async () => {
    await GET(getRequest(`?q=${encodeURIComponent("100%_off\\")}`));
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("ESCAPE '\\'");
    expect(params).toContain("%100\\%\\_off\\\\%");
  });

  it("finds a ticket by its number, with or without the #", async () => {
    await GET(getRequest(`?q=${encodeURIComponent("#412")}`));
    let [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("t.id = $");
    expect(params).toContain(412);

    mockQuery.mockClear();
    await GET(getRequest("?q=412"));
    [sql, params] = mockQuery.mock.calls[0];
    expect(params).toContain(412);
  });

  it("does not treat prose as a ticket number", async () => {
    await GET(getRequest("?q=ticket 412"));
    expect(mockQuery.mock.calls[0][0]).not.toContain("t.id =");
  });

  it("caps the term so a pasted wall of text is not a pattern", async () => {
    await GET(getRequest(`?q=${"a".repeat(500)}`));
    const like = mockQuery.mock.calls[0][1].find(
      (p: unknown) => typeof p === "string" && p.startsWith("%a"),
    );
    expect(like).toBe(`%${"a".repeat(100)}%`);
  });

  it("ignores a blank search", async () => {
    await GET(getRequest("?q=%20%20"));
    expect(mockQuery.mock.calls[0][0]).not.toContain("ILIKE");
  });
});

describe("GET /api/v3/admin/support-tickets pagination", () => {
  it("orders by activity with the id as a tiebreak, so a page boundary is stable", async () => {
    await GET(getRequest());
    expect(mockQuery.mock.calls[0][0]).toContain(
      "ORDER BY t.last_message_at DESC, t.id DESC",
    );
  });

  it("asks for one more row than a page, and uses it only to know there is another page", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: ticketRows(ADMIN_TICKET_PAGE_SIZE + 1) })
      .mockResolvedValueOnce({ rows: [] });
    const res = await GET(getRequest());
    const body = await res.json();
    const params = mockQuery.mock.calls[0][1];
    expect(params[params.length - 1]).toBe(ADMIN_TICKET_PAGE_SIZE + 1);
    expect(body.tickets).toHaveLength(ADMIN_TICKET_PAGE_SIZE);
    expect(body.nextCursor).toEqual(expect.any(String));
    // The probe row is not leaked, and neither is the cursor text.
    expect(body.tickets[0]).not.toHaveProperty("cursor_ts");
  });

  it("returns no cursor on the last page", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: ticketRows(ADMIN_TICKET_PAGE_SIZE) })
      .mockResolvedValueOnce({ rows: [] });
    const body = await (await GET(getRequest())).json();
    expect(body.tickets).toHaveLength(ADMIN_TICKET_PAGE_SIZE);
    expect(body.nextCursor).toBeNull();
  });

  it("builds the cursor from the last ticket shown, at the precision the column has", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: ticketRows(ADMIN_TICKET_PAGE_SIZE + 1) })
      .mockResolvedValueOnce({ rows: [] });
    const body = await (await GET(getRequest())).json();
    const lastShown = ADMIN_TICKET_PAGE_SIZE - 1;
    expect(body.nextCursor).toBe(
      encodeTicketCursor({
        ts: `2026-10-25 12:00:${String(59 - lastShown).padStart(2, "0")}.123456+00`,
        id: 100 - lastShown,
      }),
    );
  });

  it("resumes after a cursor with a row-value comparison against the ORDER BY pair", async () => {
    const before = encodeTicketCursor({
      ts: "2026-10-25 12:00:10.123456+00",
      id: 51,
    });
    await GET(getRequest(`?before=${before}`));
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("(t.last_message_at, t.id) < ($");
    expect(params).toContain("2026-10-25 12:00:10.123456+00");
    expect(params).toContain(51);
  });

  it("skips the counts query on a page past the first", async () => {
    const before = encodeTicketCursor({ ts: "2026-10-25 12:00:10+00", id: 5 });
    const res = await GET(getRequest(`?before=${before}`));
    const body = await res.json();
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(body).not.toHaveProperty("counts");
  });

  it("400s a cursor it did not issue, rather than putting it in SQL", async () => {
    for (const bad of [
      "garbage",
      Buffer.from(JSON.stringify(["now()); DROP TABLE x;--", 1])).toString(
        "base64url",
      ),
      Buffer.from(
        JSON.stringify(["2026-10-25 12:00:10+00", "1 OR 1=1"]),
      ).toString("base64url"),
      Buffer.from(JSON.stringify({ ts: "x" })).toString("base64url"),
    ]) {
      const res = await GET(getRequest(`?before=${bad}`));
      expect(res.status).toBe(400);
    }
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("withErrorHandling", () => {
  it("answers a database failure with a 500", async () => {
    mockQuery.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await GET(getRequest());
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
  });
});
