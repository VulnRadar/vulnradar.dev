/**
 * What PATCH /api/v3/notifications does with a body that is not a JSON object
 * and an id that is not exactly a row id, and what both handlers do when a
 * dependency throws. `{not json` and `null` used to throw out of the handler,
 * and any number passed as an id, so 1.5 and 9999999999 reached Postgres and
 * came back as a 500.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockMarkRead = vi.fn();
const mockMarkAllRead = vi.fn();
const mockList = vi.fn();
vi.mock("@/lib/notifications/user-notifications", () => ({
  listUnreadUserNotifications: (...args: unknown[]) => mockList(...args),
  markUserNotificationRead: (...args: unknown[]) => mockMarkRead(...args),
  markAllUserNotificationsRead: (...args: unknown[]) =>
    mockMarkAllRead(...args),
}));

vi.mock("@/lib/logging/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logging/log")>()),
  logError: vi.fn(),
}));

// The route reaches no table itself, but withErrorHandling and readJsonObject
// live in lib/api/api-utils, which imports the pool.
vi.mock("@/lib/database/db", () => ({ default: { query: vi.fn() } }));

const { GET, PATCH } = await import("@/app/api/v3/notifications/route");

function rawRequest(body: string): Request {
  return new Request("http://localhost/api/v3/notifications", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body,
  });
}

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
  mockMarkRead.mockReset();
  mockMarkRead.mockResolvedValue(true);
  mockMarkAllRead.mockReset();
  mockList.mockReset();
  mockList.mockResolvedValue([]);
});

describe("PATCH /api/v3/notifications", () => {
  for (const body of ["{not json", "null", "[]", '"a string"', ""]) {
    it(`answers 400 to the body ${JSON.stringify(body)}`, async () => {
      const res = await PATCH(rawRequest(body));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toEqual(expect.any(String));
      expect(mockMarkRead).not.toHaveBeenCalled();
      expect(mockMarkAllRead).not.toHaveBeenCalled();
    });
  }

  for (const id of [
    9999999999,
    1.5,
    -1,
    "12abc",
    "1e3",
    "0x10",
    "9999999999",
    true,
  ]) {
    it(`answers 400 to the id ${JSON.stringify(id)}`, async () => {
      const res = await PATCH(rawRequest(JSON.stringify({ id })));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Invalid notification id.");
      expect(mockMarkRead).not.toHaveBeenCalled();
    });
  }

  it("still asks for an id that is missing", async () => {
    const res = await PATCH(rawRequest("{}"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("id is required.");
  });

  it("marks the parsed id read", async () => {
    const res = await PATCH(rawRequest(JSON.stringify({ id: 7 })));
    expect(res.status).toBe(200);
    expect(mockMarkRead).toHaveBeenCalledWith(42, 7);
  });
});

describe("a dependency that throws", () => {
  it("GET answers a JSON 500", async () => {
    mockGetSession.mockRejectedValue(new Error("session store down"));
    const res = await GET();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toEqual(expect.any(String));
  });

  it("PATCH answers a JSON 500", async () => {
    mockMarkRead.mockRejectedValue(new Error("pool exhausted"));
    const res = await PATCH(rawRequest(JSON.stringify({ id: 7 })));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toEqual(expect.any(String));
  });
});
