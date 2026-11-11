/**
 * Admin routes that read `await request.json()` and then destructured it
 * turned `null`, `[]` or a string body into a TypeError, and either a 500 the
 * route's own catch logged as a server fault or, outside a catch, an unhandled
 * throw. Ids taken straight from the path or the body reached Postgres as
 * "12abc" or 9999999999, which it rejects with a cast error: another 500.
 * Each of those is the caller's mistake and answers 400, and none reaches a
 * write.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
const mockConnect = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: () => mockConnect(),
  },
}));

const ADMIN = { id: 1, userId: 1, role: "super_admin", email: "a@example.com" };
vi.mock("@/lib/auth/authorization", () => ({
  requireAdmin: vi.fn(async () => ADMIN),
  requirePermission: vi.fn(async () => ADMIN),
  isSuperAdminRole: () => true,
  logAction: vi.fn(async () => undefined),
  logAuditAction: vi.fn(async () => undefined),
}));
vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "203.0.113.1"),
  getUserAgent: vi.fn(async () => "vitest"),
}));
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: vi.fn(async () => 50),
  getSettings: vi.fn(async () => ({})),
  invalidateSettingsCache: vi.fn(),
}));

const blockedData = await import("@/app/api/v3/admin/blocked-data/route");
const content = await import("@/app/api/v3/admin/content/route");
const features = await import("@/app/api/v3/admin/features/route");
const notifications = await import("@/app/api/v3/admin/notifications/route");
const notification =
  await import("@/app/api/v3/admin/notifications/[id]/route");
const teams = await import("@/app/api/v3/admin/teams/route");
const promotedTags =
  await import("@/app/api/v3/admin/engine-feedback/promoted-tags/route");
const queueCancel =
  await import("@/app/api/v3/admin/queue-status/cancel/route");

function raw(method: string, body: string, path = "/api/v3/admin/x") {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body,
  });
}

const WRITES = /^\s*(INSERT|UPDATE|DELETE)\b/i;
function wrote(): boolean {
  return mockQuery.mock.calls.some((c) => WRITES.test(String(c[0])));
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockConnect.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

const BAD_BODIES: [string, string][] = [
  ["malformed JSON", "{not json"],
  ["a JSON null", "null"],
  ["a JSON array", "[]"],
  ["a JSON string", '"purge"'],
];

const bodyRoutes: [string, (body: string) => Promise<Response>][] = [
  ["POST /admin/blocked-data", (b) => blockedData.POST(raw("POST", b))],
  ["POST /admin/content", (b) => content.POST(raw("POST", b))],
  ["POST /admin/features", (b) => features.POST(raw("POST", b))],
  ["POST /admin/notifications", (b) => notifications.POST(raw("POST", b))],
  [
    "PUT /admin/notifications/[id]",
    (b) =>
      notification.PUT(raw("PUT", b), { params: Promise.resolve({ id: "3" }) }),
  ],
  ["PATCH /admin/teams", (b) => teams.PATCH(raw("PATCH", b))],
  ["DELETE /admin/teams", (b) => teams.DELETE(raw("DELETE", b))],
];

describe("admin bodies that are not a JSON object", () => {
  for (const [route, call] of bodyRoutes) {
    for (const [label, body] of BAD_BODIES) {
      it(`${route} answers 400 for ${label} and writes nothing`, async () => {
        const res = await call(body);
        expect(res.status).toBe(400);
        expect(wrote()).toBe(false);
      });
    }
  }
});

const BAD_IDS = ["12abc", "1e3", "0x10", "1.5", "9999999999", "0", "-4"];

describe("admin ids that are not one row's id", () => {
  for (const id of BAD_IDS) {
    it(`PUT /admin/notifications/${id} answers 400`, async () => {
      const res = await notification.PUT(
        raw("PUT", JSON.stringify({ title: "t", message: "m" })),
        { params: Promise.resolve({ id }) },
      );
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it(`DELETE /admin/notifications/${id} answers 400`, async () => {
      const res = await notification.DELETE(raw("DELETE", ""), {
        params: Promise.resolve({ id }),
      });
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it(`DELETE /admin/engine-feedback/promoted-tags?id=${id} answers 400`, async () => {
      const res = await promotedTags.DELETE(
        new NextRequest(
          `http://localhost/api/v3/admin/engine-feedback/promoted-tags?id=${encodeURIComponent(id)}`,
          { method: "DELETE" },
        ),
      );
      expect(res.status).toBe(400);
      expect(wrote()).toBe(false);
    });

    it(`POST /admin/queue-status/cancel with scanId ${id} answers 400`, async () => {
      const res = await queueCancel.POST(
        raw("POST", JSON.stringify({ scanId: id })),
      );
      expect(res.status).toBe(400);
      expect(wrote()).toBe(false);
    });
  }

  it("refuses a leading zero, so one row has one spelling", async () => {
    const res = await promotedTags.DELETE(
      new NextRequest(
        "http://localhost/api/v3/admin/engine-feedback/promoted-tags?id=007",
        { method: "DELETE" },
      ),
    );
    expect(res.status).toBe(400);
  });

  for (const teamId of ["12abc", 1.5, 9999999999, 0, true]) {
    it(`PATCH /admin/teams answers 400 for teamId ${JSON.stringify(teamId)}`, async () => {
      const res = await teams.PATCH(
        raw("PATCH", JSON.stringify({ teamId, name: "Renamed" })),
      );
      expect(res.status).toBe(400);
      expect(wrote()).toBe(false);
    });

    it(`DELETE /admin/teams answers 400 for teamId ${JSON.stringify(teamId)}`, async () => {
      const res = await teams.DELETE(raw("DELETE", JSON.stringify({ teamId })));
      expect(res.status).toBe(400);
      expect(mockConnect).not.toHaveBeenCalled();
    });
  }

  it("still renames a team named by a valid id", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ name: "Old" }] });
    const res = await teams.PATCH(
      raw("PATCH", JSON.stringify({ teamId: 12, name: "Renamed" })),
    );
    expect(res.status).toBe(200);
    expect(
      mockQuery.mock.calls.some(
        (c) => /UPDATE teams SET name/.test(String(c[0])) && c[1][1] === 12,
      ),
    ).toBe(true);
  });
});

describe("admin security alert paging", () => {
  function list(offset: unknown) {
    return features.POST(
      raw(
        "POST",
        JSON.stringify({ section: "security_alerts", action: "list", offset }),
      ),
    );
  }

  for (const offset of [-1, 1.5, "abc", "10; DROP", 1e21, true]) {
    it(`answers 400 for offset ${JSON.stringify(offset)}`, async () => {
      const res = await list(offset);
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  }

  it("pages from a whole-number offset, and from none", async () => {
    expect((await list(40)).status).toBe(200);
    expect(mockQuery.mock.calls.at(-1)![1].at(-1)).toBe(40);
    expect((await list(undefined)).status).toBe(200);
    expect(mockQuery.mock.calls.at(-1)![1].at(-1)).toBe(0);
  });
});
