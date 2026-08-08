import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for session IP binding (checkSessionIpBinding / getSession) plus a
 * light regression check on createSession, which is what records the IP
 * this feature later compares against.
 *
 * Mocked at the database and network boundary: pool.query and
 * sendNotificationEmail. getClientIp/getUserAgent are mocked too (the
 * request headers they read aren't available outside a real request),
 * but ipsInSameSubnet is left real via importOriginal so the actual
 * subnet math is exercised, not a stand-in for it.
 */

type Row = Record<string, unknown>;

const queries: { sql: string; params: unknown[] }[] = [];
let sessionRow: Row | null = null;
let settingsRows: Row[] = [];

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  queries.push({ sql, params });
  const s = sql.trim();
  if (s.startsWith("DELETE FROM sessions WHERE expires_at")) {
    return { rows: [] };
  }
  if (s.includes("SELECT s.user_id")) {
    return { rows: sessionRow ? [sessionRow] : [] };
  }
  if (s.startsWith("SELECT key, value FROM system_settings")) {
    return { rows: settingsRows };
  }
  if (s.startsWith("DELETE FROM sessions WHERE id")) {
    return { rows: [] };
  }
  if (s.startsWith("INSERT INTO sessions")) {
    return { rows: [] };
  }
  if (s.startsWith("INSERT INTO security_alerts")) {
    return { rows: [] };
  }
  return { rows: [] };
});

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
  },
}));

const cookieState = new Map<string, string>();
const cookieStore = {
  get: vi.fn((name: string) => {
    const value = cookieState.get(name);
    return value === undefined ? undefined : { name, value };
  }),
  set: vi.fn((name: string, value: string) => {
    cookieState.set(name, value);
  }),
  delete: vi.fn((name: string) => {
    cookieState.delete(name);
  }),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

let currentIp = "unknown";
let currentUserAgent = "test-agent";

vi.mock("@/lib/api/request-utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/request-utils")>();
  return {
    ...actual,
    getClientIp: vi.fn(async () => currentIp),
    getUserAgent: vi.fn(async () => currentUserAgent),
  };
});

const mockSendNotificationEmail = vi.fn(async (_params: unknown) => {});
vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: (params: unknown) => mockSendNotificationEmail(params),
}));

const { getSession, createSession, checkSessionIpBinding, createUser } =
  await import("@/lib/auth/auth");
const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");
const { AUTH_SESSION_COOKIE_NAME } = await import("@/lib/config/constants");

function enableSettingsRow(enabled: boolean, ipv4 = 24, ipv6 = 48) {
  settingsRows = [
    { key: "SESSION_IP_BINDING_ENABLED", value: String(enabled) },
    { key: "SESSION_IP_BINDING_IPV4_PREFIX", value: String(ipv4) },
    { key: "SESSION_IP_BINDING_IPV6_PREFIX", value: String(ipv6) },
  ];
}

beforeEach(() => {
  mockQuery.mockClear();
  mockSendNotificationEmail.mockClear();
  cookieStore.get.mockClear();
  cookieStore.set.mockClear();
  cookieStore.delete.mockClear();
  queries.length = 0;
  cookieState.clear();
  sessionRow = null;
  settingsRows = []; // no rows -> every setting resolves to its shipped default (disabled)
  currentIp = "unknown";
  currentUserAgent = "test-agent";
  invalidateSettingsCache();
});

describe("checkSessionIpBinding", () => {
  const baseSession = { user_id: 1, email: "user@example.com" };

  it("passes silently when the feature is disabled (shipped default)", async () => {
    // settingsRows is empty -> resolver falls back to the shipped default,
    // which is false. See lib/config/config-values.ts.
    const ok = await checkSessionIpBinding("session-1", {
      ...baseSession,
      ip_address: "203.0.113.5",
    });
    expect(ok).toBe(true);
    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM sessions WHERE id"),
      expect.anything(),
    );
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
  });

  it("passes when enabled but no IP was recorded at session creation", async () => {
    enableSettingsRow(true);
    const ok = await checkSessionIpBinding("session-1", {
      ...baseSession,
      ip_address: null,
    });
    expect(ok).toBe(true);
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
  });

  it("passes when the current request's IP can't be determined", async () => {
    enableSettingsRow(true);
    currentIp = "unknown";
    const ok = await checkSessionIpBinding("session-1", {
      ...baseSession,
      ip_address: "203.0.113.5",
    });
    expect(ok).toBe(true);
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
  });

  it("passes silently for a same-subnet IP change (default /24)", async () => {
    enableSettingsRow(true);
    currentIp = "203.0.113.250"; // same /24 as below, different last octet
    const ok = await checkSessionIpBinding("session-1", {
      ...baseSession,
      ip_address: "203.0.113.5",
    });
    expect(ok).toBe(true);
    expect(
      queries.some((q) => q.sql.startsWith("DELETE FROM sessions WHERE id")),
    ).toBe(false);
    expect(mockSendNotificationEmail).not.toHaveBeenCalled();
  });

  it("ends the session and notifies the owner on a cross-subnet mismatch", async () => {
    enableSettingsRow(true);
    currentIp = "198.51.100.9"; // different /24 entirely
    currentUserAgent = "curl/8.0";

    const ok = await checkSessionIpBinding("session-1", {
      ...baseSession,
      ip_address: "203.0.113.5",
    });

    expect(ok).toBe(false);

    // Session row deleted -- same recoverable "log in again" path as an
    // expired session, never a permanent account lock.
    const deleteCall = queries.find((q) =>
      q.sql.startsWith("DELETE FROM sessions WHERE id"),
    );
    expect(deleteCall?.params).toEqual(["session-1"]);

    // Admin-visible security alert recorded.
    const alertCall = queries.find((q) =>
      q.sql.includes("INSERT INTO security_alerts"),
    );
    expect(alertCall).toBeTruthy();
    expect(alertCall?.params[0]).toBe(1); // user_id
    expect(alertCall?.sql).toContain("session_ip_mismatch");

    // Account owner notified by email.
    expect(mockSendNotificationEmail).toHaveBeenCalledTimes(1);
    const emailArgs = mockSendNotificationEmail.mock.calls[0][0] as {
      userId: number;
      userEmail: string;
      type: string;
    };
    expect(emailArgs.userId).toBe(1);
    expect(emailArgs.userEmail).toBe("user@example.com");
    expect(emailArgs.type).toBe("login_alerts");
  });

  it("respects an admin-configured tighter subnet (e.g. /32)", async () => {
    enableSettingsRow(true, 32, 128);
    currentIp = "203.0.113.6"; // one address off — same /24 but not /32
    const ok = await checkSessionIpBinding("session-1", {
      ...baseSession,
      ip_address: "203.0.113.5",
    });
    expect(ok).toBe(false);
  });
});

describe("getSession", () => {
  const futureExpiry = new Date(Date.now() + 60_000).toISOString();

  it("returns null when there is no session cookie", async () => {
    expect(await getSession()).toBeNull();
  });

  it("returns the user when the feature is off (default posture)", async () => {
    cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
    sessionRow = {
      user_id: 42,
      expires_at: futureExpiry,
      ip_address: "203.0.113.5",
      email: "user@example.com",
      name: "User",
      tos_accepted_at: null,
      disabled_at: null,
      role: "user",
    };
    currentIp = "8.8.8.8"; // wildly different network -- must not matter

    const session = await getSession();
    expect(session).toEqual({
      userId: 42,
      email: "user@example.com",
      name: "User",
      tosAcceptedAt: null,
      role: "user",
    });
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });

  it("signs the user out (like an expired session) on a cross-subnet mismatch", async () => {
    enableSettingsRow(true);
    cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
    sessionRow = {
      user_id: 42,
      expires_at: futureExpiry,
      ip_address: "203.0.113.5",
      email: "user@example.com",
      name: "User",
      tos_accepted_at: null,
      disabled_at: null,
      role: "user",
    };
    currentIp = "8.8.8.8";

    const session = await getSession();
    expect(session).toBeNull();
    expect(cookieStore.delete).toHaveBeenCalledWith(AUTH_SESSION_COOKIE_NAME);
    expect(
      queries.some((q) => q.sql.startsWith("DELETE FROM sessions WHERE id")),
    ).toBe(true);
  });
});

describe("createUser", () => {
  /**
   * super-admin bootstrap (item 5 of the super_admin feature): the INSERT
   * itself decides 'super_admin' vs 'user' via a CASE/NOT EXISTS subquery
   * evaluated by Postgres, not by any application-level branch. These
   * tests assert the exact SQL text carries that guard (a regression here
   * would silently break "the first-ever signup becomes super_admin")
   * and that createUser returns whatever role the database reports back,
   * rather than assuming one.
   */
  it("sends an INSERT with the super-admin bootstrap CASE/NOT EXISTS guard", async () => {
    await createUser("first@example.com", "password123", "First User");
    const insertCall = queries.find((q) => q.sql.includes("INSERT INTO users"));
    expect(insertCall).toBeTruthy();
    expect(insertCall!.sql).toContain(
      "CASE WHEN NOT EXISTS (SELECT 1 FROM users) THEN 'super_admin' ELSE 'user' END",
    );
    expect(insertCall!.params).toEqual([
      "first@example.com",
      expect.any(String),
      "First User",
    ]);
  }, 20000);

  it("returns the role reported back by the database (server-decided, not client-decided)", async () => {
    mockQuery.mockImplementationOnce(
      async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        return {
          rows: [
            {
              id: 1,
              email: "first@example.com",
              name: null,
              plan: "free",
              beta_access: false,
              role: "super_admin",
            },
          ],
        };
      },
    );
    const user = await createUser("first@example.com", "password123");
    expect(user.role).toBe("super_admin");
    expect(user.id).toBe(1);
  }, 20000);

  it("lowercases and trims the email before inserting", async () => {
    await createUser("  Second@Example.com  ", "password123");
    const insertCall = queries.find((q) => q.sql.includes("INSERT INTO users"));
    expect(insertCall!.params[0]).toBe("second@example.com");
  }, 20000);
});

describe("createSession", () => {
  it("records the IP and user agent for later comparison", async () => {
    cookieStore.set.mockClear();
    const id = await createSession(7, "203.0.113.5", "test-ua");
    expect(typeof id).toBe("string");

    const insertCall = queries.find((q) =>
      q.sql.startsWith("INSERT INTO sessions"),
    );
    expect(insertCall?.params).toEqual([
      id,
      7,
      expect.any(Date),
      "203.0.113.5",
      "test-ua",
    ]);
    expect(cookieStore.set).toHaveBeenCalledWith(
      AUTH_SESSION_COOKIE_NAME,
      id,
      expect.objectContaining({ httpOnly: true }),
    );
  });
});
