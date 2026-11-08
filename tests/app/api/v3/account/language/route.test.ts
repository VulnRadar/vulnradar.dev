/**
 * Route-level tests for /api/v3/account/language. The database and the cookie
 * jar are mocked.
 *
 * An impersonation session is a real session on the customer's account, so
 * choosing a language to reproduce their problem used to rewrite the language
 * their emails go out in, with no audit row: a persistent change from a
 * read-only support action.
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

const cookieState = new Map<string, string>();
const cookieStore = {
  get: (name: string) => {
    const value = cookieState.get(name);
    return value === undefined ? undefined : { name, value };
  },
  set: (name: string, value: string) => void cookieState.set(name, value),
};
vi.mock("next/headers", () => ({
  cookies: async () => cookieStore,
}));

const { PUT } = await import("@/app/api/v3/account/language/route");
const { LOCALE_COOKIE } = await import("@/lib/i18n/config");
const { NextRequest } = await import("next/server");

function putRequest(body: unknown) {
  return new NextRequest("http://localhost/api/v3/account/language", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function usersUpdates() {
  return mockQuery.mock.calls.filter(([sql]) =>
    String(sql).includes("UPDATE users"),
  );
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  mockGetSession.mockReset();
  cookieState.clear();
});

describe("PUT /api/v3/account/language", () => {
  it("saves the choice on the account and sets the cookie", async () => {
    mockGetSession.mockResolvedValue({ userId: 7 });

    const res = await PUT(putRequest({ locale: "ja" }));

    expect(res.status).toBe(200);
    expect(usersUpdates()).toHaveLength(1);
    expect(usersUpdates()[0][1]).toEqual(["ja", 7]);
    expect(cookieState.get(LOCALE_COOKIE)).toBe("ja");
  });

  it("during an impersonation sets only the cookie, leaving the customer's language", async () => {
    mockGetSession.mockResolvedValue({ userId: 7, impersonatedBy: 1 });

    const res = await PUT(putRequest({ locale: "ja" }));

    expect(res.status).toBe(200);
    expect(usersUpdates()).toHaveLength(0);
    expect(cookieState.get(LOCALE_COOKIE)).toBe("ja");
  });

  it("keeps a visitor's choice in the cookie", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await PUT(putRequest({ locale: "fr" }));

    expect(res.status).toBe(200);
    expect(usersUpdates()).toHaveLength(0);
    expect(cookieState.get(LOCALE_COOKIE)).toBe("fr");
  });

  it("refuses a language the site does not speak", async () => {
    mockGetSession.mockResolvedValue({ userId: 7 });

    const res = await PUT(putRequest({ locale: "tlh" }));

    expect(res.status).toBe(400);
    expect(usersUpdates()).toHaveLength(0);
    expect(cookieState.has(LOCALE_COOKIE)).toBe(false);
  });
});
