import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeCookieStore, makeHeaderStore } from "../_test-harness";

/**
 * Route-level tests for POST /api/v3/auth/logout.
 *
 * Mocked at the network/database boundary only: the pg pool. destroySession
 * (from lib/auth) runs for real against the mocked pool and a fake
 * next/headers cookie jar.
 *
 * Note: this route has no auth gate at all -- destroySession() simply
 * no-ops when there is no session cookie, and the route always returns 200.
 * There is no "auth required but absent" case to test here.
 */

let sessionDeleteCalls: unknown[][] = [];

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
  if (s.startsWith("DELETE FROM sessions WHERE expires_at"))
    return { rows: [] };
  if (s.startsWith("SELECT key, value FROM system_settings"))
    return { rows: [] };
  if (s.startsWith("DELETE FROM sessions WHERE id")) {
    sessionDeleteCalls.push(params);
    return { rows: [] };
  }
  return { rows: [] };
});

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
  },
}));

const { store: cookieStore, state: cookieState } = makeCookieStore();
const { store: headerStore } = makeHeaderStore();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
  headers: vi.fn(async () => headerStore),
}));

const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");
const { AUTH_SESSION_COOKIE_NAME } = await import("@/lib/config/constants");
const { hashSessionId } = await import("@/lib/auth/auth");
const { POST } = await import("@/app/api/v3/auth/logout/route");

beforeEach(() => {
  mockQuery.mockClear();
  cookieState.clear();
  sessionDeleteCalls = [];
  invalidateSettingsCache();
});

describe("POST /api/v3/auth/logout", () => {
  it("deletes the session row and clears the cookie when a session exists", async () => {
    cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toBeTruthy();
    // The DELETE keys on the digest of the cookie, never the cookie itself
    // (AUDIT-012#auth-07).
    expect(sessionDeleteCalls).toEqual([[hashSessionId("session-1")]]);
    expect(cookieState.has(AUTH_SESSION_COOKIE_NAME)).toBe(false);
  });

  it("still returns success when there is no session cookie, without touching the database", async () => {
    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toBeTruthy();
    expect(sessionDeleteCalls).toHaveLength(0);
  });

  // Signing out while impersonating used to end only the impersonation: the
  // admin's own session lived on for days, and its raw token stayed in the
  // imp_return_session cookie, where pasting it back gave full admin access.
  it("ends the admin's parked session too when signing out of an impersonation", async () => {
    cookieState.set(AUTH_SESSION_COOKIE_NAME, "imp-token");
    cookieState.set("imp_return_session", "admin-token");

    const res = await POST();

    expect(res.status).toBe(200);
    expect(sessionDeleteCalls).toEqual(
      expect.arrayContaining([
        [hashSessionId("imp-token")],
        [hashSessionId("admin-token")],
      ]),
    );
    // Keyed on digests only, never the raw tokens.
    expect(sessionDeleteCalls.flat()).not.toContain("admin-token");
    expect(cookieState.has(AUTH_SESSION_COOKIE_NAME)).toBe(false);
    expect(cookieState.has("imp_return_session")).toBe(false);
  });

  it("drops a parked admin token even when the impersonation cookie is already gone", async () => {
    cookieState.set("imp_return_session", "admin-token");

    await POST();

    expect(sessionDeleteCalls).toEqual([[hashSessionId("admin-token")]]);
    expect(cookieState.has("imp_return_session")).toBe(false);
  });
});
