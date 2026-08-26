/**
 * Route-level tests for PUT/DELETE /api/v3/admin/notifications/[id] (edit or
 * remove a site-wide notification). Same SEND_ANNOUNCEMENTS gate as the
 * collection route's POST, via requirePermission so ENFORCE_STAFF_2FA is
 * honored. Only getSession and the database are mocked.
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

const routeModule = await import("@/app/api/v3/admin/notifications/[id]/route");
const { PUT, DELETE } = routeModule;

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function putRequest(body: unknown): Request {
  return new Request("http://localhost/api/v3/admin/notifications/1", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteRequest(): Request {
  return new Request("http://localhost/api/v3/admin/notifications/1", {
    method: "DELETE",
  });
}

// requirePermission does its own SELECT id, role, totp_enabled FROM users.
// totp_enabled: true so passesTwoFactorEnforcement short-circuits before
// ever calling getSetting("ENFORCE_STAFF_2FA").
function withRole(role: string) {
  mockGetSession.mockResolvedValue({ userId: 1 });
  mockQuery.mockResolvedValueOnce({
    rows: [{ id: 1, role, totp_enabled: true }],
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockLogAction.mockReset();
});

describe("PUT /api/v3/admin/notifications/[id]", () => {
  it("rejects an unauthenticated caller", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await PUT(putRequest({ title: "t" }), ctx("1"));
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a moderator — SEND_ANNOUNCEMENTS is admin-only", async () => {
    withRole("moderator");
    const res = await PUT(putRequest({ title: "t" }), ctx("1"));
    expect(res.status).toBe(403);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("rejects a javascript: action_url", async () => {
    withRole("admin");
    const res = await PUT(
      putRequest({ action_url: "javascript:alert(1)" }),
      ctx("1"),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a javascript: action_url_2", async () => {
    withRole("admin");
    const res = await PUT(
      putRequest({ action_url_2: "javascript:alert(1)" }),
      ctx("1"),
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when the notification does not exist", async () => {
    withRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await PUT(putRequest({ title: "New title" }), ctx("999"));
    expect(res.status).toBe(404);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("updates the notification and audit-logs it", async () => {
    withRole("admin");
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, title: "Updated title" }],
    });
    const res = await PUT(putRequest({ title: "Updated title" }), ctx("1"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.notification.title).toBe("Updated title");
    expect(mockLogAction).toHaveBeenCalledWith(
      1,
      null,
      "notification_updated",
      expect.stringContaining("Updated title"),
      "127.0.0.1",
    );
  });
});

describe("DELETE /api/v3/admin/notifications/[id]", () => {
  it("rejects an unauthenticated caller", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await DELETE(deleteRequest(), ctx("1"));
    expect(res.status).toBe(403);
  });

  it("rejects a moderator", async () => {
    withRole("moderator");
    const res = await DELETE(deleteRequest(), ctx("1"));
    expect(res.status).toBe(403);
  });

  it("returns 404 when the notification does not exist", async () => {
    withRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [] }); // title lookup: not found
    mockQuery.mockResolvedValueOnce({ rows: [] }); // delete: no rows
    const res = await DELETE(deleteRequest(), ctx("999"));
    expect(res.status).toBe(404);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("deletes the notification and audit-logs it", async () => {
    withRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [{ title: "Bye" }] }); // title lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // delete
    const res = await DELETE(deleteRequest(), ctx("1"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockLogAction).toHaveBeenCalledWith(
      1,
      null,
      "notification_deleted",
      expect.stringContaining("Bye"),
      "127.0.0.1",
    );
  });
});

describe("module shape", () => {
  it("does not export GET or POST (those live on the collection route)", () => {
    const mod = routeModule as unknown as Record<string, unknown>;
    expect(mod.GET).toBeUndefined();
    expect(mod.POST).toBeUndefined();
  });
});
