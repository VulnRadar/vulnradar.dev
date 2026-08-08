/**
 * Route-level tests for GET/POST /api/v3/admin/notifications (site-wide
 * bell/banner notifications). Gated by hasStaffPermission (real, from
 * lib/auth/permissions-client.ts) against VIEW_USERS (GET) and
 * SEND_ANNOUNCEMENTS (POST). Only getSession and the database are mocked.
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

const routeModule = await import("@/app/api/v3/admin/notifications/route");
const { GET, POST } = routeModule;

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/v3/admin/notifications", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function withRole(role: string) {
  mockGetSession.mockResolvedValue({ userId: 1, role });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockLogAction.mockReset();
});

describe("GET /api/v3/admin/notifications", () => {
  it("rejects an unauthenticated caller", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("rejects a plain user (no staff permissions at all)", async () => {
    withRole("user");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("allows a support-tier caller to view (VIEW_USERS)", async () => {
    withRole("support");
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, title: "Hi" }] });
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.notifications).toHaveLength(1);
  });
});

describe("POST /api/v3/admin/notifications", () => {
  it("rejects an unauthenticated caller", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(postRequest({ title: "t", message: "m" }));
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects support (lacks SEND_ANNOUNCEMENTS)", async () => {
    withRole("support");
    const res = await POST(postRequest({ title: "t", message: "m" }));
    expect(res.status).toBe(401);
  });

  it("rejects a moderator — SEND_ANNOUNCEMENTS is admin-only even though moderator has many other staff permissions", async () => {
    withRole("moderator");
    const res = await POST(postRequest({ title: "t", message: "m" }));
    expect(res.status).toBe(401);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("allows an admin to create a notification and audit-logs it", async () => {
    withRole("admin");
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, title: "Maintenance", type: "bell" }],
    });
    const res = await POST(
      postRequest({ title: "Maintenance", message: "Downtime tonight" }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.notification.id).toBe(1);
    expect(mockLogAction).toHaveBeenCalledWith(
      1,
      null,
      "notification_created",
      expect.stringContaining("Maintenance"),
      "127.0.0.1",
    );
  });

  it("requires a title and message", async () => {
    withRole("admin");
    const res = await POST(postRequest({ title: "t" }));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a javascript: action_url (XSS guard)", async () => {
    withRole("admin");
    const res = await POST(
      postRequest({
        title: "t",
        message: "m",
        action_url: "javascript:alert(1)",
      }),
    );
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a protocol-relative action_url", async () => {
    withRole("admin");
    const res = await POST(
      postRequest({ title: "t", message: "m", action_url: "//evil.com/x" }),
    );
    expect(res.status).toBe(400);
  });

  it("accepts an https:// action_url", async () => {
    withRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 2 }] });
    const res = await POST(
      postRequest({
        title: "t",
        message: "m",
        action_url: "https://example.com/x",
      }),
    );
    expect(res.status).toBe(200);
  });

  it("accepts a root-relative action_url", async () => {
    withRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 3 }] });
    const res = await POST(
      postRequest({ title: "t", message: "m", action_url: "/dashboard" }),
    );
    expect(res.status).toBe(200);
  });
});

describe("module shape", () => {
  it("does not export PUT or DELETE (those live on the [id] sub-route)", () => {
    const mod = routeModule as unknown as Record<string, unknown>;
    expect(mod.PUT).toBeUndefined();
    expect(mod.DELETE).toBeUndefined();
  });
});
