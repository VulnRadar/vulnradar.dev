/**
 * What /api/v3/schedules does with a body that is not a JSON object, an id that
 * is not exactly a row id, and a dependency that throws. All three used to end
 * in a 500 with no JSON body: `await request.json()` threw on `{not json`,
 * "12abc" went to Postgres as an id, and nothing caught a throw.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

vi.mock("@/lib/config/runtime-config", async () => {
  const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");
  const read = (key: string) =>
    key === "BILLING_ENABLED"
      ? false
      : key.startsWith("FEATURE_")
        ? true
        : SETTINGS_REGISTRY[key as keyof typeof SETTINGS_REGISTRY]?.default;
  return {
    getSetting: async (key: string) => read(key),
    getSettings: async (keys: string[]) =>
      Object.fromEntries(keys.map((key) => [key, read(key)])),
  };
});

vi.mock("@/lib/logging/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logging/log")>()),
  logError: vi.fn(),
}));

const { GET, POST, PATCH, DELETE } =
  await import("@/app/api/v3/schedules/route");

const BAD_BODIES = ["{not json", "null", "[]", '"a string"', ""];
const BAD_IDS: unknown[] = [
  "9999999999",
  "12abc",
  "1e3",
  "0x10",
  "1.5",
  "0",
  "-1",
  9999999999,
  1.5,
  0,
  -1,
  true,
  {},
];

function rawRequest(method: string, body: string): NextRequest {
  return new NextRequest("http://localhost/api/v3/schedules", {
    method,
    headers: { "content-type": "application/json" },
    body,
  });
}

function jsonRequest(method: string, body: unknown): NextRequest {
  return rawRequest(method, JSON.stringify(body));
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42, email: "me@example.com" });
});

describe("a body that is not a JSON object", () => {
  const handlers: [string, (r: NextRequest) => Promise<Response>][] = [
    ["POST", POST],
    ["PATCH", PATCH],
    ["DELETE", DELETE],
  ];
  for (const [method, handler] of handlers) {
    for (const body of BAD_BODIES) {
      it(`${method} answers 400 to ${JSON.stringify(body)}`, async () => {
        const res = await handler(rawRequest(method, body));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toEqual(expect.any(String));
        expect(mockQuery).not.toHaveBeenCalled();
      });
    }
  }
});

describe("an id that is not exactly a row id", () => {
  for (const id of BAD_IDS) {
    it(`PATCH answers 400 to ${JSON.stringify(id)}`, async () => {
      const res = await PATCH(jsonRequest("PATCH", { id, active: false }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Invalid schedule id.");
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it(`DELETE answers 400 to ${JSON.stringify(id)}`, async () => {
      const res = await DELETE(jsonRequest("DELETE", { id }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Invalid schedule id.");
      expect(mockQuery).not.toHaveBeenCalled();
    });
  }

  for (const teamId of [9999999999, 1.5, 0, -1]) {
    it(`PATCH answers 400 to teamId ${teamId}`, async () => {
      const res = await PATCH(jsonRequest("PATCH", { id: 3, teamId }));
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  }

  it("DELETE still asks for an id that is missing", async () => {
    const res = await DELETE(jsonRequest("DELETE", {}));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("PATCH still takes the id as digits", async () => {
    const res = await PATCH(jsonRequest("PATCH", { id: "3", active: false }));
    expect(res.status).toBe(404);
    expect(mockQuery.mock.calls[0][1]).toEqual([3]);
  });
});

describe("a dependency that throws", () => {
  const calls: [string, () => Promise<Response>][] = [
    ["GET", () => GET()],
    ["POST", () => POST(jsonRequest("POST", { url: "https://example.com" }))],
    ["PATCH", () => PATCH(jsonRequest("PATCH", { id: 3, active: false }))],
    ["DELETE", () => DELETE(jsonRequest("DELETE", { id: 3 }))],
  ];
  for (const [label, call] of calls) {
    it(`${label} answers a JSON 500`, async () => {
      mockGetSession.mockRejectedValue(new Error("session store down"));
      const res = await call();
      expect(res.status).toBe(500);
      expect((await res.json()).error).toEqual(expect.any(String));
    });
  }
});
