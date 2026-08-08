import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  makeCookieStore,
  makeHeaderStore,
  defaultSessionRow,
} from "../_test-harness";

/**
 * Route-level tests for DELETE /api/v3/auth/sessions.
 *
 * Mocked at the network/database boundary only: the pg pool. getSession and
 * deleteAllSessions run for real against the mocked pool. The route also
 * clears the session cookie directly via next/headers cookies() (not
 * through destroySession()), so the fake cookie jar has to reflect that.
 */

let sessionRow: Record<string, unknown> | null = null;
let sessionsDeleteCalls: unknown[][] = [];

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
  if (s.startsWith("DELETE FROM sessions WHERE expires_at"))
    return { rows: [] };
  if (s.includes("SELECT s.user_id"))
    return { rows: sessionRow ? [sessionRow] : [] };
  if (s.startsWith("SELECT key, value FROM system_settings"))
    return { rows: [] };
  if (s.startsWith("DELETE FROM sessions WHERE user_id = $1")) {
    sessionsDeleteCalls.push(params);
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
const { DELETE } = await import("@/app/api/v3/auth/sessions/route");

beforeEach(() => {
  mockQuery.mockClear();
  cookieState.clear();
  sessionRow = null;
  sessionsDeleteCalls = [];
  invalidateSettingsCache();
});

describe("DELETE /api/v3/auth/sessions", () => {
  it("requires a session", async () => {
    const res = await DELETE();
    expect(res.status).toBe(401);
    expect(sessionsDeleteCalls).toHaveLength(0);
  });

  it("revokes every session for the user and clears the cookie", async () => {
    cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
    sessionRow = defaultSessionRow({ user_id: 33 });

    const res = await DELETE();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(sessionsDeleteCalls).toEqual([[33]]);
    // Cleared with an empty value (maxAge: 0), not merely left as-is.
    expect(cookieState.get(AUTH_SESSION_COOKIE_NAME)).toBe("");
  });
});
