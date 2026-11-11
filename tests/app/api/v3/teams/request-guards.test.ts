/**
 * What the team routes do with a body that is not a JSON object, an id that is
 * not exactly a row id, an invite address that could never receive mail, and a
 * dependency that throws.
 *
 * Each of these used to reach `await request.json()` or Postgres unchecked:
 * `{not json` and `null` threw before the handler looked at a field, "12abc"
 * and 9999999999 went to the database as ids, and an invite to "not-an-email"
 * was written and mailed. Every one answered a 500 with no JSON body, or did
 * the wrong thing quietly. They are the client's mistakes, so they are 400s.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: vi.fn(),
  },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

vi.mock("@/lib/teams/feature-gate", () => ({
  teamsDisabledResponse: async () => null,
}));

vi.mock("@/lib/config/runtime-config", async () => {
  const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");
  const read = (key: string) =>
    key === "BILLING_ENABLED"
      ? false
      : SETTINGS_REGISTRY[key as keyof typeof SETTINGS_REGISTRY]?.default;
  return {
    getSetting: async (key: string) => read(key),
    getSettings: async (keys: string[]) =>
      Object.fromEntries(keys.map((key) => [key, read(key)])),
  };
});

vi.mock("@/lib/rate-limiting/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limiting/rate-limit")>()),
  checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
}));

vi.mock("@/lib/logging/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logging/log")>()),
  logError: vi.fn(),
}));

const teams = await import("@/app/api/v3/teams/route");
const members = await import("@/app/api/v3/teams/members/route");
const acceptInvite = await import("@/app/api/v3/teams/accept-invite/route");
const invitations = await import("@/app/api/v3/teams/invitations/route");
const memberScans = await import("@/app/api/v3/teams/member-scans/route");
const teammates = await import("@/app/api/v3/teams/teammates/route");
const avatar = await import("@/app/api/v3/teams/avatar/[teamId]/route");

type BodyHandler = (request: NextRequest) => Promise<Response>;

const BAD_BODIES = ["{not json", "null", "[]", '"a string"', ""];
const BAD_IDS = ["9999999999", "12abc", "1e3", "0x10", "1.5", "0", "-1"];

function rawRequest(method: string, body: string, url = "teams"): NextRequest {
  return new NextRequest(`http://localhost/api/v3/${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body,
  });
}

function jsonRequest(method: string, body: unknown, url = "teams") {
  return rawRequest(method, JSON.stringify(body), url);
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42, email: "me@example.com" });
});

const BODY_ROUTES: [string, BodyHandler, string][] = [
  ["POST /teams", teams.POST, "POST"],
  ["PATCH /teams", teams.PATCH, "PATCH"],
  ["DELETE /teams", teams.DELETE, "DELETE"],
  ["POST /teams/members", members.POST, "POST"],
  ["PATCH /teams/members", members.PATCH, "PATCH"],
  ["DELETE /teams/members", members.DELETE, "DELETE"],
  ["POST /teams/accept-invite", acceptInvite.POST, "POST"],
  ["DELETE /teams/invitations", invitations.DELETE, "DELETE"],
];

describe("a body that is not a JSON object", () => {
  for (const [label, handler, method] of BODY_ROUTES) {
    for (const body of BAD_BODIES) {
      it(`${label} answers 400 to ${JSON.stringify(body)}`, async () => {
        const res = await handler(rawRequest(method, body));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toEqual(expect.any(String));
        expect(mockQuery).not.toHaveBeenCalled();
      });
    }
  }
});

describe("an id that is not exactly a row id", () => {
  const cases: [string, (raw: unknown) => Promise<Response>][] = [
    [
      "PATCH /teams teamId",
      (raw) => teams.PATCH(jsonRequest("PATCH", { teamId: raw, name: "Acme" })),
    ],
    [
      "DELETE /teams teamId",
      (raw) => teams.DELETE(jsonRequest("DELETE", { teamId: raw })),
    ],
    [
      "POST /teams/members teamId",
      (raw) =>
        members.POST(
          jsonRequest("POST", { teamId: raw, email: "new@example.com" }),
        ),
    ],
    [
      "PATCH /teams/members userId",
      (raw) =>
        members.PATCH(
          jsonRequest("PATCH", { teamId: 5, userId: raw, role: "viewer" }),
        ),
    ],
    [
      "DELETE /teams/members inviteId",
      (raw) =>
        members.DELETE(jsonRequest("DELETE", { teamId: 5, inviteId: raw })),
    ],
    [
      "POST /teams/accept-invite inviteId",
      (raw) => acceptInvite.POST(jsonRequest("POST", { inviteId: raw })),
    ],
    [
      "DELETE /teams/invitations inviteId",
      (raw) => invitations.DELETE(jsonRequest("DELETE", { inviteId: raw })),
    ],
    [
      "GET /teams/member-scans userId",
      (raw) =>
        memberScans.GET(
          new NextRequest(
            `http://localhost/api/v3/teams/member-scans?teamId=5&userId=${encodeURIComponent(String(raw))}`,
          ),
        ),
    ],
  ];

  for (const [label, call] of cases) {
    for (const raw of [...BAD_IDS, 9999999999, 1.5]) {
      it(`${label} answers 400 to ${JSON.stringify(raw)}`, async () => {
        const res = await call(raw);
        expect(res.status).toBe(400);
        expect(mockQuery).not.toHaveBeenCalled();
      });
    }
  }

  it("names the invite id it refused", async () => {
    const res = await invitations.DELETE(
      jsonRequest("DELETE", { inviteId: "12abc" }),
    );
    expect((await res.json()).error).toBe("Invalid invite id.");
  });

  it("refuses an invite token that is not a string", async () => {
    const res = await acceptInvite.POST(
      jsonRequest("POST", { token: { $ne: "" } }),
    );
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  for (const raw of BAD_IDS) {
    it(`GET /teams/avatar answers 404 to ${raw}`, async () => {
      const res = await avatar.GET(
        new NextRequest(`http://localhost/api/v3/teams/avatar/${raw}`),
        { params: Promise.resolve({ teamId: raw }) },
      );
      expect(res.status).toBe(404);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  }
});

describe("the address on a team invite", () => {
  const bad: unknown[] = [
    "not-an-email",
    "a@b",
    "a b@example.com",
    "two@@example.com",
    "@example.com",
    "someone@.example.com",
    "x".repeat(250) + "@example.com",
    5,
    { email: "a@example.com" },
  ];
  for (const email of bad) {
    it(`refuses ${JSON.stringify(email).slice(0, 40)}`, async () => {
      const res = await members.POST(
        jsonRequest("POST", { teamId: 5, email, role: "viewer" }),
      );
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  }

  it("accepts a real address with surrounding spaces and capitals", async () => {
    // The membership lookup answers "not a member", which is far enough to
    // prove the address got past validation.
    const res = await members.POST(
      jsonRequest("POST", {
        teamId: 5,
        email: "  New.Person@Example.com ",
        role: "viewer",
      }),
    );
    expect(res.status).toBe(403);
    expect(mockQuery).toHaveBeenCalled();
  });
});

describe("a dependency that throws", () => {
  const calls: [string, () => Promise<Response>][] = [
    ["GET /teams", () => teams.GET()],
    ["POST /teams", () => teams.POST(jsonRequest("POST", { name: "Acme" }))],
    [
      "PATCH /teams",
      () => teams.PATCH(jsonRequest("PATCH", { teamId: 5, name: "Acme" })),
    ],
    ["DELETE /teams", () => teams.DELETE(jsonRequest("DELETE", { teamId: 5 }))],
    [
      "POST /teams/accept-invite",
      () => acceptInvite.POST(jsonRequest("POST", { inviteId: 5 })),
    ],
    ["GET /teams/invitations", () => invitations.GET()],
    [
      "DELETE /teams/invitations",
      () => invitations.DELETE(jsonRequest("DELETE", { inviteId: 5 })),
    ],
    [
      "GET /teams/member-scans",
      () =>
        memberScans.GET(
          new NextRequest(
            "http://localhost/api/v3/teams/member-scans?teamId=5&userId=6",
          ),
        ),
    ],
    ["GET /teams/teammates", () => teammates.GET()],
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
