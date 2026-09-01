/**
 * Route-level tests for /api/v3/admin/content, the content-moderation
 * surface: GET lists cached host reputation and every scan that has ever had
 * a share link, POST purges a host or unlists/revokes a share.
 *
 * This route had no test at all, which mattered more than the usual coverage
 * gap: it is an admin mutation surface whose gate is MODERATE_CONTENT rather
 * than plain staff, so the two specialist roles that deliberately do NOT hold
 * it (ops, billing) have to stay locked out, and the GET returns every
 * share's owner email. requirePermission runs for real here; only getSession
 * and the database are faked.
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

const mockLogAction = vi.fn();
vi.mock("@/lib/auth/authorization", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/authorization")>();
  return {
    ...actual,
    logAction: (...args: unknown[]) => mockLogAction(...args),
  };
});

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
}));

const { GET, POST } = await import("@/app/api/v3/admin/content/route");

/**
 * totp_enabled: true so requirePermission's 2FA-enforcement check
 * short-circuits before it can reach getSetting("ENFORCE_STAFF_2FA") -- this
 * suite does not fake @/lib/config/runtime-config, and an unmocked call would
 * hit the real resolver against this same fake pool and eat a queued result.
 */
function queueRole(role: string | null) {
  mockQuery.mockResolvedValueOnce({
    rows: role ? [{ id: 1, role, totp_enabled: true }] : [],
  });
}

function getRequest(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/v3/admin/content?${query}`);
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/admin/content", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockLogAction.mockReset();
  mockGetSession.mockResolvedValue({ userId: 1 });
});

describe("/api/v3/admin/content: authorization", () => {
  it("GET requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET(getRequest("type=hosts"));
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("POST requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(postRequest({ action: "purge_host", host: "a.io" }));
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // ops and billing are the roles that exist precisely so an operator can
  // reach one admin tab without content-moderation power. Neither holds
  // MODERATE_CONTENT in ROLE_PERMISSION_MAP, so both must be refused here
  // even though both pass the plain staff gate other admin routes use.
  it.each(["ops", "billing", "support", "user"])(
    "GET refuses the %s role, which does not hold MODERATE_CONTENT",
    async (role) => {
      queueRole(role);
      const res = await GET(getRequest("type=hosts"));
      expect(res.status).toBe(401);
    },
  );

  it.each(["ops", "billing", "support", "user"])(
    "POST refuses the %s role, which does not hold MODERATE_CONTENT",
    async (role) => {
      queueRole(role);
      const res = await POST(
        postRequest({ action: "purge_host", host: "evil.test" }),
      );
      expect(res.status).toBe(401);
      expect(mockLogAction).not.toHaveBeenCalled();
    },
  );

  it.each(["moderator", "content_manager", "security_analyst", "admin"])(
    "GET admits the %s role, which does hold MODERATE_CONTENT",
    async (role) => {
      queueRole(role);
      mockQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await GET(getRequest("type=hosts"));
      expect(res.status).toBe(200);
    },
  );
});

describe("GET /api/v3/admin/content", () => {
  it("rejects a missing or unknown type rather than defaulting to one", async () => {
    queueRole("admin");
    const res = await GET(getRequest("type=everything"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "type must be 'hosts' or 'shares'",
    });
  });

  it("returns the host page with a derived totalPages", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "25" }] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ host: "evil.test", danger_score: 80 }],
    });
    const res = await GET(getRequest("type=hosts&page=1&limit=10"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      hosts: [{ host: "evil.test", danger_score: 80 }],
      page: 1,
      total: 25,
      totalPages: 3,
    });
  });

  it("pages the shares listing with LIMIT/OFFSET rather than slicing in JS", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await GET(getRequest("type=shares&page=3&limit=10"));
    const pageCall = mockQuery.mock.calls.at(-1);
    expect(String(pageCall?.[0])).toContain("LIMIT $1 OFFSET $2");
    expect(pageCall?.[1]).toEqual([10, 20]);
  });

  // A totalPages of 0 renders as "Page 1 of 0" in the admin table, so the
  // route floors it at 1 for an empty table.
  it("never reports zero pages for an empty table", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await GET(getRequest("type=shares"));
    await expect(res.json()).resolves.toMatchObject({
      total: 0,
      totalPages: 1,
    });
  });
});

describe("POST /api/v3/admin/content", () => {
  it("rejects an unknown action", async () => {
    queueRole("admin");
    const res = await POST(postRequest({ action: "nuke_everything" }));
    expect(res.status).toBe(400);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("purge_host requires a host", async () => {
    queueRole("admin");
    const res = await POST(postRequest({ action: "purge_host", host: "  " }));
    expect(res.status).toBe(400);
  });

  it("purge_host lowercases the host, reports whether a row went, and audit-logs", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ host: "a.test" }],
    });
    const res = await POST(
      postRequest({ action: "purge_host", host: "  A.TEST  " }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      deleted: true,
      host: "a.test",
    });
    expect(mockQuery.mock.calls.at(-1)?.[1]).toEqual(["a.test"]);
    expect(mockLogAction).toHaveBeenCalledWith(
      1,
      null,
      "purge_host_reputation",
      expect.stringContaining("a.test"),
      "127.0.0.1",
    );
  });

  it("purge_host reports deleted:false when the host was not cached", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await POST(
      postRequest({ action: "purge_host", host: "absent.test" }),
    );
    await expect(res.json()).resolves.toMatchObject({ deleted: false });
  });

  it.each(["unlist_share", "revoke_share"])(
    "%s requires an integer scanId",
    async (action) => {
      queueRole("admin");
      const res = await POST(postRequest({ action, scanId: "not-a-number" }));
      expect(res.status).toBe(400);
      expect(mockLogAction).not.toHaveBeenCalled();
    },
  );

  it.each(["unlist_share", "revoke_share"])(
    "%s 404s when the scan has no share link",
    async (action) => {
      queueRole("admin");
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const res = await POST(postRequest({ action, scanId: 7 }));
      expect(res.status).toBe(404);
      expect(mockLogAction).not.toHaveBeenCalled();
    },
  );

  // unlist leaves share_token alone: the link keeps working for anyone
  // holding it, it just stops appearing in the public directory. revoke
  // clears the token, which is what actually kills the link.
  it("unlist_share clears only the listing flag", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 7, url: "https://a.test" }],
    });
    const res = await POST(postRequest({ action: "unlist_share", scanId: 7 }));
    expect(res.status).toBe(200);
    const sql = String(mockQuery.mock.calls.at(-1)?.[0]);
    expect(sql).toContain("share_publicly_listed = false");
    expect(sql).not.toContain("share_token = NULL");
    expect(mockLogAction).toHaveBeenCalledWith(
      1,
      null,
      "unlist_public_share",
      expect.stringContaining("#7"),
      "127.0.0.1",
    );
  });

  it("revoke_share clears the token as well as the listing flag", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 7, url: "https://a.test" }],
    });
    const res = await POST(postRequest({ action: "revoke_share", scanId: 7 }));
    expect(res.status).toBe(200);
    const sql = String(mockQuery.mock.calls.at(-1)?.[0]);
    expect(sql).toContain("share_token = NULL");
    expect(sql).toContain("share_publicly_listed = false");
    expect(mockLogAction).toHaveBeenCalledWith(
      1,
      null,
      "revoke_public_share",
      expect.stringContaining("#7"),
      "127.0.0.1",
    );
  });

  it("turns a database failure into a 500 without leaking the error", async () => {
    queueRole("admin");
    mockQuery.mockRejectedValueOnce(new Error("relation does not exist"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const res = await POST(
      postRequest({ action: "purge_host", host: "a.test" }),
    );
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: "Internal server error",
    });
    consoleError.mockRestore();
  });
});
