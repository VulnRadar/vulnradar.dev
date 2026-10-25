/**
 * Route tests for GET /api/v3/admin/contact-submissions, the staff view of the
 * contact form. The staff email became a pointer with no content, so this list
 * is where a message is actually read, and where a pointer that never arrived
 * (email_status = 'failed') is found.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockRequirePermission = vi.fn();
vi.mock("@/lib/auth/authorization", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
}));

const { GET } = await import("@/app/api/v3/admin/contact-submissions/route");
const { CONTACT_PAGE_SIZE } = await import("@/lib/support/contact-submissions");

function getRequest(query = "") {
  return new NextRequest(
    `http://localhost/api/v3/admin/contact-submissions${query}`,
    { method: "GET" },
  );
}

function rows(n: number, firstId = 500) {
  return Array.from({ length: n }, (_, i) => ({
    id: firstId - i,
    source: "contact",
    name: "Alex",
    email: "alex@example.com",
    subject: "Found a bug",
    category: "bug",
    message: "It breaks",
    email_status: "sent",
    email_error: null,
    handled_at: null,
    created_at: "2026-10-25T12:00:00.000Z",
  }));
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  mockRequirePermission.mockReset();
  mockRequirePermission.mockResolvedValue({ userId: 1, role: "support" });
});

describe("GET /api/v3/admin/contact-submissions", () => {
  it("403s without the manage-support permission, before reading anything", async () => {
    mockRequirePermission.mockResolvedValueOnce(null);
    const res = await GET(getRequest());
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("is gated on the same permission as the ticket inbox beside it", async () => {
    await GET(getRequest());
    expect(mockRequirePermission).toHaveBeenCalledWith(
      "manage_support_tickets",
    );
  });

  it("lists submissions newest first, with the send outcome and per-state counts", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            ...rows(1)[0],
            email_status: "failed",
            email_error: "550 5.7.0 Blocked by SpamAssassin",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { email_status: "sent", n: 40 },
          { email_status: "failed", n: 2 },
        ],
      });
    const res = await GET(getRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][0]).toContain("ORDER BY id DESC");
    expect(body.submissions[0].email_status).toBe("failed");
    expect(body.submissions[0].email_error).toContain("SpamAssassin");
    expect(body.counts).toEqual({ pending: 0, sent: 40, failed: 2 });
    expect(body.nextBefore).toBeNull();
  });

  it("never selects the submitter's IP address", async () => {
    await GET(getRequest());
    expect(mockQuery.mock.calls[0][0]).not.toContain("ip_address");
  });

  it("filters to one email state", async () => {
    await GET(getRequest("?status=failed"));
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("email_status = $1");
    expect(params[0]).toBe("failed");
  });

  it("ignores a state it does not know instead of putting it in SQL", async () => {
    await GET(getRequest("?status=failed%27%20OR%201=1"));
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).not.toContain("email_status =");
  });

  it("pages by id: one probe row says there is more, and is not returned", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: rows(CONTACT_PAGE_SIZE + 1) })
      .mockResolvedValueOnce({ rows: [] });
    const body = await (await GET(getRequest())).json();
    expect(body.submissions).toHaveLength(CONTACT_PAGE_SIZE);
    // The last id SHOWN: the next page is everything older than it.
    expect(body.nextBefore).toBe(500 - (CONTACT_PAGE_SIZE - 1));
    const params = mockQuery.mock.calls[0][1];
    expect(params[params.length - 1]).toBe(CONTACT_PAGE_SIZE + 1);
  });

  it("returns no cursor on the last page", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: rows(CONTACT_PAGE_SIZE) })
      .mockResolvedValueOnce({ rows: [] });
    const body = await (await GET(getRequest())).json();
    expect(body.nextBefore).toBeNull();
  });

  it("resumes below a cursor, and skips the counts on a later page", async () => {
    const res = await GET(getRequest("?before=450"));
    const body = await res.json();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("id < $1");
    expect(params[0]).toBe(450);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(body).not.toHaveProperty("counts");
  });

  it("400s a cursor that is not a positive integer", async () => {
    for (const bad of ["abc", "-4", "0"]) {
      const res = await GET(getRequest(`?before=${bad}`));
      expect(res.status).toBe(400);
    }
    expect(mockQuery).not.toHaveBeenCalled();
  });

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
