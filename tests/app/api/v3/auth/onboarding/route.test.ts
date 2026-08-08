import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  makeCookieStore,
  makeHeaderStore,
  defaultSessionRow,
} from "../_test-harness";

/**
 * Route-level tests for POST /api/v3/auth/onboarding.
 *
 * Mocked at the network/database boundary only: the pg pool. getSession
 * runs for real against the mocked pool and a fake next/headers cookie jar.
 */

let sessionRow: Record<string, unknown> | null = null;
let onboardingUpdateCalls: unknown[][] = [];

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
  if (s.startsWith("DELETE FROM sessions WHERE expires_at"))
    return { rows: [] };
  if (s.includes("SELECT s.user_id"))
    return { rows: sessionRow ? [sessionRow] : [] };
  if (s.startsWith("SELECT key, value FROM system_settings"))
    return { rows: [] };
  if (s.startsWith("UPDATE users SET onboarding_completed = true")) {
    onboardingUpdateCalls.push(params);
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
const { POST } = await import("@/app/api/v3/auth/onboarding/route");

beforeEach(() => {
  mockQuery.mockClear();
  cookieState.clear();
  sessionRow = null;
  onboardingUpdateCalls = [];
  invalidateSettingsCache();
});

describe("POST /api/v3/auth/onboarding", () => {
  it("requires a session", async () => {
    const res = await POST();
    expect(res.status).toBe(401);
    expect(onboardingUpdateCalls).toHaveLength(0);
  });

  it("marks onboarding complete for the session's user", async () => {
    cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
    sessionRow = defaultSessionRow({ user_id: 9 });

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(onboardingUpdateCalls).toEqual([[9]]);
  });
});
