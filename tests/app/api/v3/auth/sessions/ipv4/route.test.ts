import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  makeCookieStore,
  makeHeaderStore,
  jsonRequest,
  defaultSessionRow,
} from "../../_test-harness";

/**
 * Route-level tests for POST /api/v3/auth/sessions/ipv4. Mocked at the
 * db/next-headers boundary only; getSession and verifyIpv4Token run for real.
 * The signing key must be set before the token module is imported.
 */

process.env.API_KEY_ENCRYPTION_KEY = "b".repeat(64);

let sessionRow: Record<string, unknown> | null = null;
let updateCalls: unknown[][] = [];

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
  if (s.includes("SELECT s.user_id"))
    return { rows: sessionRow ? [sessionRow] : [] };
  if (s.startsWith("SELECT key, value FROM system_settings"))
    return { rows: [] };
  if (s.startsWith("UPDATE sessions SET ipv4_address")) {
    updateCalls.push(params);
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
const { signIpv4Token } = await import("@/lib/auth/ipv4-echo-token");
const { hashSessionId } = await import("@/lib/auth/auth");
const { POST } = await import("@/app/api/v3/auth/sessions/ipv4/route");

const URL = "http://localhost/api/v3/auth/sessions/ipv4";

beforeEach(() => {
  mockQuery.mockClear();
  cookieState.clear();
  sessionRow = null;
  updateCalls = [];
  invalidateSettingsCache();
});

describe("POST /api/v3/auth/sessions/ipv4", () => {
  it("requires a session", async () => {
    const res = await POST(jsonRequest(URL, "POST", { token: "x" }));
    expect(res.status).toBe(401);
    expect(updateCalls).toHaveLength(0);
  });

  it("records the signed IPv4 onto the current session", async () => {
    cookieState.set(AUTH_SESSION_COOKIE_NAME, "sess-1");
    sessionRow = defaultSessionRow({ user_id: 42 });
    const token = signIpv4Token("203.0.113.9", Date.now());

    const res = await POST(jsonRequest(URL, "POST", { token }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.ip).toBe("203.0.113.9");
    // The UPDATE keys on the digest of the cookie, never the cookie itself
    // (AUDIT-012#auth-07).
    expect(updateCalls).toEqual([["203.0.113.9", hashSessionId("sess-1"), 42]]);
  });

  it("rejects a forged/invalid token without writing", async () => {
    cookieState.set(AUTH_SESSION_COOKIE_NAME, "sess-1");
    sessionRow = defaultSessionRow({ user_id: 42 });

    const res = await POST(jsonRequest(URL, "POST", { token: "not.a.token" }));
    expect(res.status).toBe(400);
    expect(updateCalls).toHaveLength(0);
  });

  it("rejects a validly-signed token that carries a non-IPv4 address", async () => {
    cookieState.set(AUTH_SESSION_COOKIE_NAME, "sess-1");
    sessionRow = defaultSessionRow({ user_id: 42 });
    // Signature is valid, but the payload is IPv6: the route must still refuse.
    const token = signIpv4Token("2001:db8::1", Date.now());

    const res = await POST(jsonRequest(URL, "POST", { token }));
    expect(res.status).toBe(400);
    expect(updateCalls).toHaveLength(0);
  });
});
